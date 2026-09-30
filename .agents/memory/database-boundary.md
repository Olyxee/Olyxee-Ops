---
name: Database boundary
description: Defines which data belongs in the Ops database versus the external staff database.
---

Olyxee Ops application data and staff data must remain in separate databases. The app database stores authentication links, operational state, settings, and asset metadata. The external Supabase database remains the authority for people.

**Why:** The existing connected Supabase database was supplied only for employee and intern records. The user explicitly rejected using it as the general Ops database.

**How to apply:** Use the main application database for every non-person domain. Read people, departments, and reporting relationships from the external database only; do not create Ops tables there.

Department directory edits are intentionally directory-only: renaming, deleting, or changing the listed lead must not automatically reassign staff or rewrite tasks and objectives.

**Why:** The user chose to preserve linked staff and work when Superadmins manage department entries; cross-database cascading changes would have unwanted consequences.

**How to apply:** Make those consequences explicit in editing and deletion controls. Treat the displayed lead as directory metadata, not a staff-reporting reassignment.