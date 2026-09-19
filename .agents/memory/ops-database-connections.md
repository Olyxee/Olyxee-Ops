---
name: Ops database connection limit
description: Why the Ops database pool must leave connection headroom for sessions and maintenance.
---

Keep the shared Ops application/session PostgreSQL pool small, and use transaction mode for Supabase pooler connections.

**Why:** The session-mode database enforces a low client cap; exhausting it breaks session persistence and causes otherwise valid saves or deletes to fail. Transaction mode avoids consuming scarce persistent client slots.

**How to apply:** Keep the pool small and preserve transaction-scoped work on one checked-out client. For Supabase pooler URLs, route the Ops pool through transaction mode; never retry saturated session-mode clients in a loop.