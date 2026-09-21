import assert from "node:assert/strict";
import test from "node:test";
import { redeemAccountSetupToken, upsertAccountForSetup } from "./account-setup.mjs";

test("resending account setup preserves an existing password hash", async () => {
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: "user-1", role: "Member" }] };
    },
  };

  const result = await upsertAccountForSetup(client, {
    email: "person@example.com",
    passwordHash: "new-password-hash",
    displayName: "Example Person",
    role: "Member",
  });

  assert.equal(result.rows[0].id, "user-1");
  assert.doesNotMatch(calls[0].sql, /password_hash\s*=\s*EXCLUDED\.password_hash/i);
  assert.deepEqual(calls[0].values, [
    "person@example.com",
    "new-password-hash",
    "Example Person",
    "Member",
  ]);
});

test("only a currently valid setup token can replace the password", async () => {
  const updates = [];
  const client = {
    query: async (sql, values) => {
      if (/SELECT id, user_id/.test(sql)) {
        return values[0] === "new-token-hash"
          ? { rowCount: 1, rows: [{ id: "token-2", user_id: "user-1" }] }
          : { rowCount: 0, rows: [] };
      }
      updates.push({ sql, values });
      return { rowCount: 1, rows: [] };
    },
  };

  const oldToken = await redeemAccountSetupToken(client, {
    tokenHash: "old-token-hash",
    passwordHash: "must-not-be-used",
  });
  assert.equal(oldToken, null);
  assert.equal(updates.length, 0);

  const newestToken = await redeemAccountSetupToken(client, {
    tokenHash: "new-token-hash",
    passwordHash: "chosen-password-hash",
  });
  assert.equal(newestToken.id, "token-2");
  assert.match(updates[0].sql, /UPDATE public\.ops_users SET password_hash/i);
  assert.deepEqual(updates[0].values, ["chosen-password-hash", "user-1"]);
  assert.match(updates[1].sql, /UPDATE public\.account_setup_tokens SET used_at=now\(\)/i);
  assert.deepEqual(updates[1].values, ["token-2"]);
});