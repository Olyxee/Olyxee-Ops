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

Explicit person assignment from a department page is a separate, intentional staff operation; it should change only the target person's staff department and the required intern supervisor relationship. Do not use a full-profile update for this action or let job-title classification override the saved official department.

**Why:** The user wants Superadmins to add people directly from the department detail page while retaining the directory-only behavior for department metadata edits. Full-profile writes can unintentionally change account status or other fields.

**How to apply:** Confirm transfers visibly, write to the people database through a narrow authorized operation, and refresh the roster from its authoritative source.