---
name: Vercel cron limit
description: Deployment constraint for the scheduled-email endpoint on the current Vercel project.
---

The Vercel project serving the Ops app currently accepts only daily cron schedules. Keep scheduled-email processing at no more than once per day unless the project capability changes.

**Why:** A more frequent cron expression causes Vercel to reject the entire deployment before the build starts, leaving production pinned to an older commit with only a generic failed status in GitHub.

**How to apply:** When editing the Vercel cron configuration, use a daily expression and verify the deployment reaches the build queue. The current daily time is 06:00 UTC, which is 08:00 in Johannesburg.