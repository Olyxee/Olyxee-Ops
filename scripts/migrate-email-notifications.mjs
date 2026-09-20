import pg from "pg";

if (!process.env.OPS_DATABASE_URL) throw new Error("OPS_DATABASE_URL is required.");
const value = new URL(process.env.OPS_DATABASE_URL);
if (value.hostname.includes("pooler.supabase.com") && value.port === "5432") value.port = "6543";
const pool = new pg.Pool({ connectionString: value.toString(), ssl: { rejectUnauthorized: false }, max: 1 });

await pool.query(`
  CREATE TABLE IF NOT EXISTS public.email_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type text NOT NULL,
    recipient_email text NOT NULL,
    recipient_user_id uuid REFERENCES public.ops_users(id) ON DELETE SET NULL,
    related_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
    related_internship_id text,
    subject text NOT NULL,
    html_body text NOT NULL,
    text_body text NOT NULL,
    cta_url text NOT NULL,
    provider text NOT NULL DEFAULT 'resend',
    provider_message_id text,
    status text NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','DISABLED','DELIVERED','BOUNCED','COMPLAINED')),
    failure_reason text,
    deduplication_key text NOT NULL UNIQUE,
    retry_count integer NOT NULL DEFAULT 0,
    processing_started_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE public.email_notifications ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
  CREATE INDEX IF NOT EXISTS email_notifications_status_idx
    ON public.email_notifications(status, created_at);
  CREATE INDEX IF NOT EXISTS email_notifications_task_idx
    ON public.email_notifications(related_task_id);

  CREATE TABLE IF NOT EXISTS public.account_setup_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.ops_users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS account_setup_tokens_user_idx ON public.account_setup_tokens(user_id);
`);

console.log("Email notification schema is ready.");
await pool.end();