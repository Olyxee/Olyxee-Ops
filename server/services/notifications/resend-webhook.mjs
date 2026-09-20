import { verifyResendWebhook } from "./email-service.mjs";

const EVENT_STATUSES = Object.freeze({
  "email.delivered": "DELIVERED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.delivery_delayed": "DELAYED",
  "email.failed": "FAILED",
});

const TRANSITION_PREDICATES = Object.freeze({
  DELIVERED: "status NOT IN ('BOUNCED','COMPLAINED','FAILED')",
  BOUNCED: "status <> 'COMPLAINED'",
  COMPLAINED: "true",
  DELAYED: "status IN ('SENT','PROCESSING','DELAYED')",
  FAILED: "status NOT IN ('DELIVERED','BOUNCED','COMPLAINED')",
});

function safeFailureReason(event) {
  const value = event?.data?.bounce?.message
    || event?.data?.failed?.reason
    || event?.data?.reason
    || "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, 500) || null;
}

export async function handleResendWebhook({
  rawBody,
  headers,
  secret,
  database,
  logger = console,
}) {
  if (!verifyResendWebhook(rawBody, headers, secret)) {
    return { statusCode: 401, body: { error: "Invalid webhook signature." } };
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: { error: "Invalid webhook payload." } };
  }

  const type = String(event?.type || "");
  const status = EVENT_STATUSES[type];
  logger.info?.(`Resend webhook received: ${type || "unknown"}`);
  if (!status) {
    return { statusCode: 200, body: { ok: true, ignored: true } };
  }

  const providerMessageId = String(event?.data?.email_id || event?.data?.id || "").trim();
  if (!providerMessageId) {
    return { statusCode: 400, body: { error: "Webhook message ID is missing." } };
  }
  if (!database) {
    return { statusCode: 503, body: { error: "Email delivery log is unavailable." } };
  }

  const eventId = String(headers["svix-id"] || "").trim();
  const failureReason = ["BOUNCED", "FAILED"].includes(status) ? safeFailureReason(event) : null;
  const deliveredAt = status === "DELIVERED";
  const transitionPredicate = TRANSITION_PREDICATES[status];

  try {
    const result = await database.query(`
      WITH matching_email AS (
        SELECT id
        FROM public.email_notifications
        WHERE provider_message_id=$3
      ),
      inserted_event AS (
        INSERT INTO public.email_webhook_events
          (event_id, event_type, provider_message_id)
        SELECT $1, $2, $3
        WHERE EXISTS (SELECT 1 FROM matching_email)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      ),
      updated_email AS (
        UPDATE public.email_notifications
        SET status=$4,
            delivered_at=CASE WHEN $5 THEN coalesce(delivered_at, now()) ELSE delivered_at END,
            failure_reason=CASE WHEN $4 IN ('BOUNCED','FAILED') THEN $6 ELSE failure_reason END,
            updated_at=now()
        WHERE provider_message_id=$3
          AND EXISTS (SELECT 1 FROM inserted_event)
          AND ${transitionPredicate}
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM matching_email) AS found,
        EXISTS (SELECT 1 FROM inserted_event) AS accepted,
        EXISTS (SELECT 1 FROM updated_email) AS matched
    `, [eventId, type, providerMessageId, status, deliveredAt, failureReason]);
    const found = Boolean(result.rows[0]?.found);
    const accepted = Boolean(result.rows[0]?.accepted);
    const matched = Boolean(result.rows[0]?.matched);
    if (!found) {
      logger.warn?.(`Resend webhook message not found yet: ${providerMessageId}`);
      return { statusCode: 503, body: { error: "Email delivery record is not ready." } };
    }
    if (!accepted) return { statusCode: 200, body: { ok: true, duplicate: true } };
    if (!matched) {
      logger.warn?.(`Resend webhook message not matched or status unchanged: ${providerMessageId}`);
      return { statusCode: 200, body: { ok: true, matched: false } };
    }
    logger.info?.(`Email delivery status updated: ${providerMessageId} → ${status}`);
    return { statusCode: 200, body: { ok: true, matched: true } };
  } catch (error) {
    logger.error?.("Resend webhook database update failed.");
    return { statusCode: 503, body: { error: "Email delivery update is temporarily unavailable." } };
  }
}