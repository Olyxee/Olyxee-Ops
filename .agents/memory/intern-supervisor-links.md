---
name: Intern supervisor links
description: The external people database uses multiple formats for intern-to-manager reporting relationships.
---

Resolve an intern's supervisor using the account ID first, then normalized supervisor email, then normalized supervisor name. Convert every successful match to the manager's canonical external account ID before applying permissions.

**Why:** Some active intern records contain only a supervisor name, while others use a supervisor account ID or email. Permission checks that recognize fewer formats reject valid Manager assignments even when the UI shows the intern.

**How to apply:** Any feature that scopes interns to a Manager—task assignment, reviews, people lists, or reporting—must use the same three-format resolution and require an active Manager and active, non-archived intern.