---
name: Department delivery baseline
description: User-requested semantics for department delivery health charts when there is no activity.
---

Show the department delivery chart even when there are no linked tasks. With no recorded progress, the line stays low at zero and is red; green upward movement should represent actual improvement. Do not create decorative fluctuations to imitate the reference image.

**Why:** The user specifically rejected the empty chart for inactive departments and supplied a line-chart reference. A visible zero baseline communicates inactivity more clearly than an absent chart, while invented activity would misrepresent delivery.

**How to apply:** Use the same no-progress treatment in Superadmin and Manager department detail. Treat creation or comments alone as insufficient to claim delivery improvement; retain recorded task events for real rises and setbacks.