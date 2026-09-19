---
name: Staff data access
description: Security boundary for exposing live staff records from the connected external database.
---

The user explicitly chose to show person-level Supabase staff records in the Superadmin People view for testing, despite the current selectable demo identities. Treat this as a testing setup, not a production-ready privacy boundary.

**Why:** Demo identity selection does not prove who the visitor is, but the user specifically requested replacement of the demo directory with live records after this limitation was explained.

**How to apply:** Keep the live directory restricted to the Superadmin interface during testing. Before production use, require real sign-in and server-side role authorization for the person-level API.