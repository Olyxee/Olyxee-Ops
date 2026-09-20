import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { handleResendWebhook } from "./resend-webhook.mjs";

const secret = `whsec_${Buffer.from("webhook-test-secret").toString("base64")}`;

function signedRequest(event, overrides = {}) {
  const rawBody = typeof event === "string" ? event : JSON.stringify(event);
  const id = overrides.id || `evt_${crypto.randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.slice(6), "base64");
  const signature = crypto.createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  return {
    rawBody,
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${overrides.signature || signature}`,
    },
    secret,
  };
}

function event(type, extra = {}) {
  return { type, data: { email_id: "resend-message-1", ...extra } };
}

const silentLogger = { info() {}, warn() {}, error() {} };

test("valid delivered event updates the matching notification", async () => {
  let parameters;
  const database = { query: async (_sql, values) => {
    parameters = values;
    return { rows: [{ found: true, accepted: true, matched: true }] };
  } };
  const result = await handleResendWebhook({
    ...signedRequest(event("email.delivered")),
    database,
    logger: silentLogger,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.matched, true);
  assert.equal(parameters[3], "DELIVERED");
  assert.equal(parameters[4], true);
});

test("valid bounced event saves only the safe bounce reason", async () => {
  let parameters;
  const database = { query: async (_sql, values) => {
    parameters = values;
    return { rows: [{ found: true, accepted: true, matched: true }] };
  } };
  const result = await handleResendWebhook({
    ...signedRequest(event("email.bounced", { bounce: { message: "Mailbox unavailable" } })),
    database,
    logger: silentLogger,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(parameters[3], "BOUNCED");
  assert.equal(parameters[5], "Mailbox unavailable");
});

test("invalid and missing signatures are rejected without database access", async () => {
  let calls = 0;
  const database = { query: async () => { calls += 1; } };
  const invalid = await handleResendWebhook({
    ...signedRequest(event("email.delivered"), { signature: "invalid" }),
    database,
    logger: silentLogger,
  });
  const missing = await handleResendWebhook({
    rawBody: JSON.stringify(event("email.delivered")),
    headers: {},
    secret,
    database,
    logger: silentLogger,
  });
  assert.equal(invalid.statusCode, 401);
  assert.equal(missing.statusCode, 401);
  assert.equal(calls, 0);
});

test("unknown message IDs are retried and duplicate events return success", async () => {
  const unknown = await handleResendWebhook({
    ...signedRequest(event("email.delivered")),
    database: { query: async () => ({ rows: [{ found: false, accepted: false, matched: false }] }) },
    logger: silentLogger,
  });
  const duplicate = await handleResendWebhook({
    ...signedRequest(event("email.delivered")),
    database: { query: async () => ({ rows: [{ found: true, accepted: false, matched: false }] }) },
    logger: silentLogger,
  });
  assert.equal(unknown.statusCode, 503);
  assert.deepEqual(duplicate.body, { ok: true, duplicate: true });
});

test("unsupported events are ignored without database access", async () => {
  let calls = 0;
  const result = await handleResendWebhook({
    ...signedRequest(event("contact.created")),
    database: { query: async () => { calls += 1; } },
    logger: silentLogger,
  });
  assert.deepEqual(result.body, { ok: true, ignored: true });
  assert.equal(calls, 0);
});

test("malformed signed payload returns 400", async () => {
  const result = await handleResendWebhook({
    ...signedRequest("{not-json"),
    database: { query: async () => assert.fail("database should not be called") },
    logger: silentLogger,
  });
  assert.equal(result.statusCode, 400);
});

test("database failures return 503 so Resend can retry", async () => {
  const result = await handleResendWebhook({
    ...signedRequest(event("email.failed", { failed: { reason: "reached_daily_quota" } })),
    database: { query: async () => { throw new Error("offline"); } },
    logger: silentLogger,
  });
  assert.equal(result.statusCode, 503);
});