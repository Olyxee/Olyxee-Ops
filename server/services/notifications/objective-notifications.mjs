export function canonicalNoticeUserId(account, externalPerson) {
  if (externalPerson?.external_id) return String(externalPerson.external_id);
  if (account?.id) return `account-${account.id}`;
  return null;
}

export function buildObjectiveBlockerNotices({ objectives, recipientUserId, actorName, time, randomId }) {
  if (!recipientUserId) return [];
  return objectives.map((objective) => ({
    id: randomId(),
    userId: recipientUserId,
    title: "Weekly objective blocked",
    body: `${actorName} reported a blocker on ${objective.title}: ${String(objective.blockerMessage).trim().slice(0, 1000)}`,
    read: false,
    time,
  }));
}