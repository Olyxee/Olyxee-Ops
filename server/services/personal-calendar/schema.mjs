// The CEO's personal calendar and agenda. Ops database only. Additive and idempotent.
// Every row belongs to exactly one account (owner_user_id) and is only ever read or written by that account.

export const PERSONAL_CALENDAR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS public.personal_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.ops_users(id),
  kind text NOT NULL DEFAULT 'meeting' CHECK (kind IN ('meeting','important_date','deadline','follow_up','reminder')),
  title text NOT NULL,
  event_date date NOT NULL,
  start_time text CHECK (start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text CHECK (end_time IS NULL OR end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  location text NOT NULL DEFAULT '',
  detail text NOT NULL DEFAULT '',
  reminder_minutes integer CHECK (reminder_minutes IS NULL OR reminder_minutes IN (0,5,15,30,60,1440)),
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time IS NULL OR start_time IS NOT NULL),
  CHECK (end_time IS NULL OR end_time >= start_time)
);
CREATE INDEX IF NOT EXISTS personal_calendar_owner_date_idx ON public.personal_calendar_events (owner_user_id, event_date);

-- Who has a personal calendar besides the CEO. The CEO grants and revokes it; each person only ever sees their own events.
CREATE TABLE IF NOT EXISTS public.personal_calendar_access (
  user_id uuid PRIMARY KEY REFERENCES public.ops_users(id),
  granted_by uuid REFERENCES public.ops_users(id),
  granted_at timestamptz NOT NULL DEFAULT now()
);
`;

export const PERSONAL_EVENT_KINDS = Object.freeze(["meeting", "important_date", "deadline", "follow_up", "reminder"]);
export const REMINDER_CHOICES = Object.freeze([0, 5, 15, 30, 60, 1440]);
