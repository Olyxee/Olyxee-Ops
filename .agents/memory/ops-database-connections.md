---
name: Ops database connection limit
description: Why the Ops database pool must leave connection headroom for sessions and maintenance.
---

Keep the shared Ops application/session PostgreSQL pool small and avoid opening unnecessary concurrent clients.

**Why:** The session-mode database enforces a low client cap; exhausting it breaks session persistence and causes otherwise valid saves or deletes to fail.

**How to apply:** When changing database access or adding pools, account for the existing session store and leave headroom for maintenance connections and workflow restarts.