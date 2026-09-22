---
name: Intern supervisor links
description: The external people database uses multiple formats for intern-to-manager reporting relationships.
---

For permission checks, resolve an intern's supervisor by matching the account ID, normalized supervisor email, or normalized supervisor name independently. When all stored links are blank or stale, use the active Manager for the intern's official department as the display fallback. Anchor the signed-in Manager by their canonical external account ID, with normalized email as a fallback.

**Why:** Some intern records contain only a supervisor name, others use an account ID or email, and legacy records can contain conflicting or entirely blank supervisor fields. Treating email or name only as fallbacks when the account ID is empty still rejects valid Manager assignments.

**How to apply:** Any feature that scopes interns to a Manager—task assignment, reviews, people lists, or reporting—must use the same three-format resolution. Department fallback is suitable for display and repair, but explicit stored links still govern permission checks. For task assignment, a non-archived report is active when either the People record or their Ops account is active.