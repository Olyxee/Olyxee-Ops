---
name: Staff data access
description: Security boundary for exposing live staff records from the connected external database.
---

Expose only aggregate staff metrics while the app uses selectable demo identities. Do not return person-level live records such as names or emails until requests are protected by verified authentication and role-based authorization.

**Why:** Demo identity selection does not prove who the visitor is, so a person-level API would expose private staff data to anyone with app access.

**How to apply:** Aggregate counts can be read from the connected database for testing. Require real sign-in and server-side authorization before adding live staff-directory endpoints.