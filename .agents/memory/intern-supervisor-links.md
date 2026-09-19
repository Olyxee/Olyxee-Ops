---
name: Intern supervisor links
description: The external people database uses multiple formats for intern-to-manager reporting relationships.
---

For permission checks, resolve an intern's supervisor by matching the account ID, normalized supervisor email, or normalized supervisor name independently. Anchor the signed-in Manager by their canonical external account ID, with normalized email as a fallback.

**Why:** Some active intern records contain only a supervisor name, while others use an account ID or email, and legacy records can contain conflicting populated fields. Treating email or name only as fallbacks when the account ID is empty still rejects valid Manager assignments.

**How to apply:** Any feature that scopes interns to a Manager—task assignment, reviews, people lists, or reporting—must use the same three-format resolution and require an active Manager and active, non-archived intern.