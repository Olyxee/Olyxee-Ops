export const FEEDBACK_RESPONSE_STATUSES = ["In progress", "Resolved"];

export function isManagerFeedback(update) {
  const role = String(update.authorRole || "").replace(/\s+/g, "").toLowerCase();
  return ["manager", "admin", "superadmin"].includes(role)
    && String(update.type || "").replace(/\s+/g, "").toLowerCase() !== "feedbackresponse";
}

export function feedbackConversation(task, feedbackId, viewerId) {
  const feedback = (task.updates || []).find(update => update.id === feedbackId && isManagerFeedback(update));
  if (!feedback) return { feedback: null, status: "Open", messages: [] };
  const responses = (task.activityLog || [])
    .filter(activity => activity.action === "Feedback response recorded"
      && activity.metadata?.feedbackId === feedbackId
      && FEEDBACK_RESPONSE_STATUSES.includes(activity.metadata?.status))
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const byUpdate = new Map(responses.map(activity => [activity.metadata.updateId, activity]));
  const ownResponses = responses.filter(activity => activity.metadata.responderId === viewerId);
  const messages = [
    { ...feedback, isFeedback: true },
    ...(task.updates || []).filter(update => byUpdate.has(update.id)).map(update => ({
      ...update,
      status: byUpdate.get(update.id).metadata.status,
      responderId: byUpdate.get(update.id).metadata.responderId,
      isFeedback: false,
    })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return { feedback, status: ownResponses.at(-1)?.metadata.status || "Open", messages };
}