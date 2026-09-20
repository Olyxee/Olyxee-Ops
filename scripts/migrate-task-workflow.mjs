import pg from "pg";

if (!process.env.OPS_DATABASE_URL) throw new Error("OPS_DATABASE_URL is required.");

const pool = new pg.Pool({
  connectionString: process.env.OPS_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS public.tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_number bigserial UNIQUE,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    project text NOT NULL,
    department text NOT NULL,
    creator_user_id uuid NOT NULL REFERENCES public.ops_users(id),
    creator_external_id text NOT NULL,
    assignee_external_id text,
    priority text NOT NULL CHECK (priority IN ('Critical','High','Medium','Low')),
    status text NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started','In Progress','Blocked','Submitted for Review','Changes Requested','Completed','Cancelled')),
    due_date date NOT NULL,
    blocker_reason text,
    submitted_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS github_url text;
  CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON public.tasks(assignee_external_id);
  CREATE INDEX IF NOT EXISTS tasks_creator_idx ON public.tasks(creator_user_id);
  CREATE INDEX IF NOT EXISTS tasks_department_idx ON public.tasks(department);

  CREATE TABLE IF NOT EXISTS public.task_checklist_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    text text NOT NULL,
    completed boolean NOT NULL DEFAULT false,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS public.task_updates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    author_user_id uuid NOT NULL REFERENCES public.ops_users(id),
    author_name text NOT NULL,
    author_role text NOT NULL,
    update_type text NOT NULL,
    message text NOT NULL,
    link_url text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS public.task_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    submitted_by uuid NOT NULL REFERENCES public.ops_users(id),
    label text NOT NULL,
    url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS public.task_activity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    actor_user_id uuid NOT NULL REFERENCES public.ops_users(id),
    actor_name text NOT NULL,
    action text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`);

console.log("Task workflow schema is ready.");
await pool.end();