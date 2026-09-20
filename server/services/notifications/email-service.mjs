import crypto from "node:crypto";

const EMAIL_TYPES = new Set([
  "user.created",
  "task.assigned",
  "task.progress_updated",
  "task.submitted",
  "task.changes_requested",
  "task.approved",
  "task.help_requested",
  "task.due_soon",
  "task.overdue",
  "internship.ending_soon",
  "weekly_review.ready",
]);

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

export function emailConfiguration() {
  return {
    enabled: String(process.env.EMAIL_ENABLED || "false").toLowerCase() === "true",
    apiKey: process.env.RESEND_API_KEY || "",
    from: process.env.EMAIL_FROM || "",
    replyTo: process.env.EMAIL_REPLY_TO || "",
    appUrl: String(process.env.OPS_APP_URL || "").replace(/\/+$/, ""),
  };
}

export function validateEmailConfiguration({ production = false } = {}) {
  const config = emailConfiguration();
  const missing = ["from", "replyTo", "appUrl"].filter((key) => !config[key]);
  if (config.enabled && !config.apiKey) missing.push("apiKey");
  if (production && !config.enabled) {
    throw new Error("EMAIL_ENABLED must be true in production. Disable delivery only in development or test environments.");
  }
  if (production && config.enabled && missing.length) {
    throw new Error(`Email configuration is incomplete: ${missing.join(", ")}`);
  }
  return { ...config, missing };
}

export function taskUrl(taskId) {
  return `${emailConfiguration().appUrl}/?task=${encodeURIComponent(taskId)}`;
}

export function renderTransactionalEmail({ title, intro, details = [], ctaLabel, ctaUrl }) {
  const rows = details.filter((item) => item?.label && item?.value);
  const text = [
    title,
    "",
    intro,
    "",
    ...rows.map(({ label, value }) => `${label}: ${value}`),
    "",
    `${ctaLabel}: ${ctaUrl}`,
    "",
    "This is an automated operational notification from Olyxee Ops.",
  ].join("\n");
  const htmlRows = rows.map(({ label, value }) => `
    <tr>
      <td style="padding:9px 12px;color:#777;font-size:12px;border-bottom:1px solid #eee">${escapeHtml(label)}</td>
      <td style="padding:9px 12px;color:#171717;font-size:12px;font-weight:600;border-bottom:1px solid #eee">${escapeHtml(value)}</td>
    </tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#171717">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:32px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto;background:#fff;border:1px solid #ddd;border-radius:14px;overflow:hidden">
        <tr><td style="padding:22px 24px;border-bottom:1px solid #e5e5e5;font-size:17px;font-weight:800">Olyxee <span style="color:#666">Ops</span></td></tr>
        <tr><td style="padding:28px 24px">
          <h1 style="margin:0 0 12px;font-size:23px;line-height:1.25">${escapeHtml(title)}</h1>
          <p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.6">${escapeHtml(intro)}</p>
          ${htmlRows ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border:1px solid #eee;border-radius:10px;overflow:hidden">${htmlRows}</table>` : ""}
          <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#171717;color:#fff;text-decoration:none;font-size:13px;font-weight:700">${escapeHtml(ctaLabel)}</a>
        </td></tr>
        <tr><td style="padding:18px 24px;background:#fafafa;color:#888;font-size:11px;line-height:1.5">This is an automated operational notification from Olyxee Ops.</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  return { html, text };
}

export async function queueTransactionalEmail(client, {
  type,
  recipient,
  subject,
  title = subject,
  intro,
  details,
  ctaLabel,
  ctaUrl,
  recipientUserId = null,
  relatedTaskId = null,
  relatedInternshipId = null,
  deduplicationKey,
}) {
  if (!EMAIL_TYPES.has(type)) throw new Error(`Unsupported email event: ${type}`);
  if (!validEmail(recipient)) return { queued: false, reason: "invalid_recipient" };
  if (!deduplicationKey) throw new Error("Email deduplication key is required.");
  const rendered = renderTransactionalEmail({ title, intro, details, ctaLabel, ctaUrl });
  const result = await client.query(`
    INSERT INTO public.email_notifications
      (type, recipient_email, recipient_user_id, related_task_id, related_internship_id,
       subject, html_body, text_body, cta_url, deduplication_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (deduplication_key) DO NOTHING
    RETURNING id
  `, [
    type, recipient.trim().toLowerCase(), recipientUserId, relatedTaskId,
    relatedInternshipId, subject, rendered.html, rendered.text, ctaUrl, deduplicationKey,
  ]);
  return { queued: Boolean(result.rowCount), id: result.rows[0]?.id };
}

export async function deliverEmailNotification(pool, id) {
  const config = validateEmailConfiguration({ production: process.env.NODE_ENV === "production" });
  const claimed = await pool.query(`
    UPDATE public.email_notifications
    SET status='PROCESSING', processing_started_at=now(), updated_at=now()
    WHERE id=$1
      AND (
        status IN ('PENDING','FAILED')
        OR (status='PROCESSING' AND processing_started_at < now() - interval '10 minutes')
      )
      AND retry_count < 3
    RETURNING *
  `, [id]);
  const email = claimed.rows[0];
  if (!email) return { delivered: false, reason: "not_claimable" };
  if (!config.enabled) {
    await pool.query(`
      UPDATE public.email_notifications
      SET status='DISABLED', processing_started_at=NULL, failure_reason='Email delivery disabled by configuration', updated_at=now()
      WHERE id=$1
    `, [id]);
    return { delivered: false, reason: "disabled" };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.deduplication_key,
      },
      body: JSON.stringify({
        from: config.from,
        to: [email.recipient_email],
        reply_to: config.replyTo,
        subject: email.subject,
        html: email.html_body,
        text: email.text_body,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Resend rejected request (${response.status})`);
    await pool.query(`
      UPDATE public.email_notifications
      SET status='SENT', provider_message_id=$2, sent_at=now(), processing_started_at=NULL, failure_reason=NULL, updated_at=now()
      WHERE id=$1
    `, [id, payload.id || null]);
    return { delivered: true, providerMessageId: payload.id || null };
  } catch (error) {
    const safeReason = error instanceof Error ? error.message.slice(0, 300) : "Email provider unavailable";
    await pool.query(`
      UPDATE public.email_notifications
      SET status='FAILED', processing_started_at=NULL, failure_reason=$2, retry_count=retry_count+1, updated_at=now()
      WHERE id=$1
    `, [id, safeReason]);
    console.error("Transactional email failed:", id, safeReason);
    return { delivered: false, reason: "provider_failure" };
  }
}

export async function processPendingEmails(pool, { limit = 25 } = {}) {
  const pending = await pool.query(`
    SELECT id FROM public.email_notifications
    WHERE (
      status IN ('PENDING','FAILED')
      OR (status='PROCESSING' AND processing_started_at < now() - interval '10 minutes')
    ) AND retry_count < 3
    ORDER BY created_at
    LIMIT $1
  `, [Math.min(100, Math.max(1, limit))]);
  const results = [];
  for (const row of pending.rows) results.push(await deliverEmailNotification(pool, row.id));
  return results;
}

export function verifyResendWebhook(rawBody, headers, secret) {
  if (!secret) return false;
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signatureHeader = headers["svix-signature"];
  if (!id || !timestamp || !signatureHeader) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const expected = crypto.createHmac("sha256", Buffer.from(key, "base64"))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  return signatureHeader.split(" ").some((entry) => {
    const candidate = entry.includes(",") ? entry.split(",")[1] : entry.replace(/^v1,/, "");
    if (!candidate) return false;
    const left = Buffer.from(candidate);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
}