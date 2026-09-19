import pg from "pg";

if (!process.env.EXTERNAL_DATABASE_URL) throw new Error("EXTERNAL_DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: process.env.EXTERNAL_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
await pool.query(`
  ALTER TABLE public.interns
    ADD COLUMN IF NOT EXISTS supervisor_account_id bigint REFERENCES public.workspace_accounts(id);
  UPDATE public.interns i
  SET supervisor_account_id = manager.id
  FROM public.workspace_accounts manager
  WHERE i.supervisor_account_id IS NULL
    AND nullif(trim(i.supervisor_email), '') IS NOT NULL
    AND lower(i.supervisor_email) = lower(manager.email);
  CREATE INDEX IF NOT EXISTS interns_supervisor_account_idx ON public.interns(supervisor_account_id);
`);
console.log("People reporting relationships are ready.");
await pool.end();