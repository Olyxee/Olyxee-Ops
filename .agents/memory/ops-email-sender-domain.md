---
name: Ops email sender domain
description: Why Olyxee Ops transactional email uses the dedicated verified subdomain.
---

Olyxee Ops transactional messages must use a sender on `ops.olyxee.com`; do not switch them to the root `olyxee.com` domain without separately verifying it in the same Resend account.

**Why:** The root domain supports another website’s email setup and was not verified in the Ops Resend account. Resend rejected Ops messages with 403 until the dedicated subdomain was verified and used as the sender. The user confirmed task-assignment delivery worked with this arrangement.

**How to apply:** Keep Ops sender configuration on the dedicated subdomain. DNS or provider changes should remain scoped to `ops.olyxee.com` unless the user explicitly intends to modify root-domain mail.