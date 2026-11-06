// Organisational model schema (Ops database only). Idempotent.
// Person references are the stable People-database ids exposed by the app: "account-<n>" and "intern-<n>".
// Titles, reporting relationships and permissions are deliberately separate tables.

export const ORG_CAPABILITIES = Object.freeze([
  "org.view_all",       // see the complete organisational structure (read only)
  "org.propose",        // propose organisational changes for approval
  "org.approve",        // apply titles, reporting lines, leads and approve proposals
  "org.delegate",       // grant and revoke organisational capabilities
  "intern.administer",  // internship administration (never implied by supervising interns)
  "delivery.view",      // review delivery and execution, optionally scoped to one department
]);

export const UNSET_TITLE = "Title not set";

export const RELATIONSHIP_TYPES = Object.freeze(["reports_to", "intern_supervisor", "functional_lead"]);

export const ORG_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS public.org_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.org_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.org_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_departments_name_idx ON public.org_departments (lower(name)) WHERE active;

-- Functions (the new name for departments). Same table and stable ids, so every existing reference keeps working.
-- A function has no parent; a specialisation sits inside one function. legacy_keys are the old free-text
-- department names this unit answers to, so tasks, people and objectives stored by name keep resolving after a rename.
ALTER TABLE public.org_departments ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.org_departments(id);
ALTER TABLE public.org_departments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'function';
ALTER TABLE public.org_departments ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.org_departments ADD COLUMN IF NOT EXISTS legacy_keys text[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_departments_kind_check') THEN
    ALTER TABLE public.org_departments ADD CONSTRAINT org_departments_kind_check
      CHECK (kind IN ('function','specialisation') AND (kind = 'function') = (parent_id IS NULL) AND parent_id IS DISTINCT FROM id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.org_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_positions_title_idx ON public.org_positions (lower(title)) WHERE active;

CREATE TABLE IF NOT EXISTS public.org_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  actor_user_id uuid REFERENCES public.ops_users(id),
  actor_name text NOT NULL,
  proposal_id uuid,
  reason text NOT NULL DEFAULT '',
  subject_refs text[] NOT NULL DEFAULT '{}',
  before jsonb NOT NULL DEFAULT '{}'::jsonb,
  after jsonb NOT NULL DEFAULT '{}'::jsonb,
  version_after bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_changes_subject_idx ON public.org_changes USING gin (subject_refs);
CREATE INDEX IF NOT EXISTS org_changes_created_idx ON public.org_changes (created_at DESC);

CREATE TABLE IF NOT EXISTS public.org_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_ref text NOT NULL,
  title text NOT NULL,
  position_id uuid REFERENCES public.org_positions(id),
  department_id uuid REFERENCES public.org_departments(id),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  change_id uuid REFERENCES public.org_changes(id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_assignments_current_idx ON public.org_assignments (person_ref) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS org_assignments_person_idx ON public.org_assignments (person_ref, effective_from);

-- subject_ref is the person who is managed / supervised / led; manager_ref is the manager / supervisor / lead.
CREATE TABLE IF NOT EXISTS public.org_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('reports_to','intern_supervisor','functional_lead')),
  subject_ref text NOT NULL,
  manager_ref text NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  change_id uuid REFERENCES public.org_changes(id),
  CHECK (subject_ref <> manager_ref),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_rel_one_reports_to_idx ON public.org_relationships (subject_ref) WHERE type = 'reports_to' AND effective_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS org_rel_one_supervisor_idx ON public.org_relationships (subject_ref) WHERE type = 'intern_supervisor' AND effective_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS org_rel_functional_idx ON public.org_relationships (subject_ref, manager_ref) WHERE type = 'functional_lead' AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS org_rel_manager_idx ON public.org_relationships (manager_ref) WHERE effective_to IS NULL;

CREATE TABLE IF NOT EXISTS public.org_department_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.org_departments(id),
  person_ref text NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  change_id uuid REFERENCES public.org_changes(id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_department_lead_current_idx ON public.org_department_leads (department_id) WHERE effective_to IS NULL;

-- Products / initiatives (Orgni, Aiviate, Olyxee Logistics...). They run across functions; each has exactly one
-- accountable owner at a time, kept as history.
CREATE TABLE IF NOT EXISTS public.org_initiatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_initiatives_name_idx ON public.org_initiatives (lower(name)) WHERE active;
CREATE TABLE IF NOT EXISTS public.org_initiative_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL REFERENCES public.org_initiatives(id),
  owner_ref text NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  change_id uuid REFERENCES public.org_changes(id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_initiative_owner_current_idx ON public.org_initiative_owners (initiative_id) WHERE effective_to IS NULL;

CREATE TABLE IF NOT EXISTS public.org_identity_links (
  superseded_ref text PRIMARY KEY,
  canonical_ref text NOT NULL,
  reason text NOT NULL DEFAULT '',
  confirmed_by uuid REFERENCES public.ops_users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (superseded_ref <> canonical_ref)
);

CREATE TABLE IF NOT EXISTS public.org_chart_exclusions (
  person_ref text PRIMARY KEY,
  reason text NOT NULL,
  set_by uuid REFERENCES public.ops_users(id),
  set_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.ops_users(id),
  capability text NOT NULL CHECK (capability IN ('org.view_all','org.propose','org.approve','org.delegate','intern.administer','delivery.view')),
  scope_department_id uuid REFERENCES public.org_departments(id),
  granted_by uuid REFERENCES public.ops_users(id),
  granted_via text NOT NULL DEFAULT 'delegation',
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.ops_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_capabilities_current_idx
  ON public.org_capabilities (user_id, capability, coalesce(scope_department_id::text, '')) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.org_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_by uuid NOT NULL REFERENCES public.ops_users(id),
  proposed_by_name text NOT NULL,
  payload jsonb NOT NULL,
  base_version bigint NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  decided_by uuid REFERENCES public.ops_users(id),
  decided_at timestamptz,
  decision_note text,
  applied_change_id uuid REFERENCES public.org_changes(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_proposals_status_idx ON public.org_proposals (status, created_at DESC);

-- History is append-only: closed rows cannot change, nothing is deleted, change records are immutable.
CREATE OR REPLACE FUNCTION public.org_guard_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Organisational history cannot be deleted (%).', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'org_changes' THEN
    RAISE EXCEPTION 'Organisational change records are immutable.';
  END IF;
  IF OLD.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'Closed organisational history cannot be modified (%).', TG_TABLE_NAME;
  END IF;
  IF to_jsonb(NEW) - 'effective_to' IS DISTINCT FROM to_jsonb(OLD) - 'effective_to' THEN
    RAISE EXCEPTION 'Only effective_to can be set on organisational history (%).', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_assignments','org_relationships','org_department_leads','org_initiative_owners','org_changes'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_guard') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.org_guard_history()', t || '_guard', t);
    END IF;
  END LOOP;
END $$;
`;

export const ORG_DROP_SQL = `
DROP TABLE IF EXISTS public.org_initiative_owners, public.org_initiatives, public.org_proposals, public.org_capabilities, public.org_chart_exclusions,
  public.org_identity_links, public.org_department_leads, public.org_relationships,
  public.org_assignments, public.org_changes, public.org_positions, public.org_departments, public.org_state CASCADE;
DROP FUNCTION IF EXISTS public.org_guard_history();
`;
