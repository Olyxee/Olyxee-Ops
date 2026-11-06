import { queueTransactionalEmail } from "../notifications/email-service.mjs";

/** Queues an email for everyone touched by a confirmed org change (the person, old/new managers, new leads). */
export function createOrgNotifier({ appPool, loadPeople, appUrl }) {
  return async function notifyOrgChange({ result, actor }) {
    const people = new Map((await loadPeople()).map((person) => [person.ref, person]));
    const subject = people.get(result.subjectRef);
    const details = [
      { label: "Person", value: subject?.name || result.subjectRef },
      ...result.summary.map((line) => ({ label: "Change", value: line })),
      { label: "Approved by", value: actor.name },
    ];
    for (const ref of result.affectedRefs) {
      const person = people.get(ref);
      if (!person?.email || !person.active) continue;
      const isSubject = ref === result.subjectRef;
      const account = await appPool.query("SELECT id FROM public.ops_users WHERE lower(email) = lower($1) AND active = true LIMIT 1", [person.email]);
      if (account.rows[0]?.id === actor.userId) continue; // the approver already knows
      await queueTransactionalEmail(appPool, {
        type: "org.role_changed",
        recipient: person.email,
        recipientUserId: account.rows[0]?.id ?? null,
        subject: isSubject ? "Your role or reporting line was updated" : `Team update: ${subject?.name || "a team member"}`,
        intro: isSubject ? "An update was made to your role or reporting line in Olyxee Ops." : "A change was made to a team you work with in Olyxee Ops.",
        details,
        ctaLabel: "Open Olyxee Ops",
        ctaUrl: appUrl,
        deduplicationKey: `org-change:${result.changeId}:${ref}`,
      });
    }
  };
}
