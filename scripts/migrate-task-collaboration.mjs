import pg from "pg";

if (!process.env.OPS_DATABASE_URL) throw new Error("OPS_DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: process.env.OPS_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });

await pool.query(`
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS start_date date;
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS deliverables text;
  ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
  ALTER TABLE public.tasks ADD CONSTRAINT tasks_priority_check
    CHECK (priority IN ('Critical','High','Medium','Low','Normal','Urgent'));
  CREATE TABLE IF NOT EXISTS public.task_departments (
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    department_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, department_id)
  );
  CREATE INDEX IF NOT EXISTS task_departments_department_idx ON public.task_departments(department_id);
  CREATE TABLE IF NOT EXISTS public.task_assignees (
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    assignee_external_id text NOT NULL,
    assignment_role text NOT NULL DEFAULT 'assignee' CHECK (assignment_role IN ('assignee','lead')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, assignee_external_id)
  );
  CREATE INDEX IF NOT EXISTS task_assignees_person_idx ON public.task_assignees(assignee_external_id);
  CREATE UNIQUE INDEX IF NOT EXISTS task_assignees_one_lead_idx
    ON public.task_assignees(task_id) WHERE assignment_role = 'lead';
  INSERT INTO public.task_departments (task_id, department_id)
    SELECT id, department FROM public.tasks
    WHERE nullif(trim(department), '') IS NOT NULL
    ON CONFLICT DO NOTHING;
  INSERT INTO public.task_assignees (task_id, assignee_external_id, assignment_role)
    SELECT id, assignee_external_id, 'assignee' FROM public.tasks
    WHERE nullif(trim(assignee_external_id), '') IS NOT NULL
    ON CONFLICT DO NOTHING;
`);
console.log("Task collaboration schema and backfill are ready.");
await pool.end();