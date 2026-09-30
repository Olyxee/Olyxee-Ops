---
name: Department delivery baseline
description: User-requested semantics for department delivery health charts when there is no activity.
---

Show the department chart even when there are no linked tasks. With no recorded activity, the line stays low at zero and is red. Real task assignments receive a small activity lift; starting work, evidence, submissions and completion receive larger delivery lifts. Unassigned task creation and comments alone do not move the line.

**Why:** The user rejected empty charts and invented fluctuations, but explicitly expects a manager creating a task and assigning it to an intern to move the chart up a little. Assignment is genuine workflow activity, not completed work; distinguish its small contribution from delivery.

**How to apply:** Apply assignment credit once per task event, not per assignee. Metadata-only edits must not earn credit. Use dated events across Manager and Intern home charts and department detail, and refresh the chart's time cutoff when task data changes. Keep completed-task weekly rankings separate and completion-only.