---
name: Completed objective removal
description: Permission and preservation rule for weekly review cleanup.
---

Only Superadmins may delete weekly objectives from Weekly Review, in any status (updated 2026-10-14; previously completed-only). Removal must not delete or alter linked projects, tasks, or task progress.

**Why:** The user wanted completed objectives cleared out without losing the work and history associated with them. Active objectives are not part of that cleanup.

**How to apply:** Keep removal scoped to the objectives collection and enforce the Superadmin role on the server, not only in the UI. Keep linked project and task data independent of the objective lifecycle.