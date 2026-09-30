import assert from "node:assert/strict";
import test from "node:test";
import { feedbackConversation, isManagerFeedback } from "./feedback-conversation.mjs";

const feedback = { id: "feedback-a", authorRole: "Manager", authorName: "Test Manager", type: "Review feedback", message: "Please add validation.", createdAt: "2026-09-30T10:00:00Z" };
const task = { updates: [feedback], activityLog: [] };
const response = (id, feedbackId, status, responderId, createdAt) => ({
  update: { id, authorId: "ops-user-id", authorRole: "Member", type: "Feedback response", message: `Response: ${status}`, createdAt },
  activity: { id: `activity-${id}`, action: "Feedback response recorded", metadata: { feedbackId, status, responderId, updateId: id }, createdAt },
});

test("manager comments are guidance; intern responses do not become new feedback cards", () => {
  for (const authorRole of ["Manager", "Admin", "Superadmin", "Super Admin"]) {
    assert.ok(isManagerFeedback({ ...feedback, authorRole, type: "General comment" }));
  }
  assert.ok(!isManagerFeedback({ ...feedback, authorRole: "Member" }));
  assert.ok(!isManagerFeedback({ ...feedback, type: "Feedback response" }));
});

test("a specific manager message begins an open conversation", () => {
  const result = feedbackConversation(task, feedback.id, "intern-a");
  assert.equal(result.status, "Open");
  assert.deepEqual(result.messages.map(item => item.id), [feedback.id]);
});

test("saved responses are ordered and the latest status survives reloading task data", () => {
  const first = response("response-1", feedback.id, "In progress", "intern-a", "2026-09-30T11:00:00Z");
  const last = response("response-2", feedback.id, "Resolved", "intern-a", "2026-09-30T12:00:00Z");
  const result = feedbackConversation({ updates: [last.update, feedback, first.update], activityLog: [last.activity, first.activity] }, feedback.id, "intern-a");
  assert.equal(result.status, "Resolved");
  assert.deepEqual(result.messages.map(item => item.id), [feedback.id, first.update.id, last.update.id]);
});

test("another feedback message and another assignee cannot resolve the viewer's feedback", () => {
  const unrelated = response("unrelated", "feedback-b", "Resolved", "intern-a", "2026-09-30T12:00:00Z");
  const colleague = response("colleague", feedback.id, "Resolved", "intern-b", "2026-09-30T12:00:00Z");
  const result = feedbackConversation({ updates: [feedback, unrelated.update, colleague.update], activityLog: [unrelated.activity, colleague.activity] }, feedback.id, "intern-a");
  assert.equal(result.status, "Open");
  assert.deepEqual(result.messages.map(item => item.id), [feedback.id, colleague.update.id]);
});

test("resolved feedback can return to in progress without rewriting history", () => {
  const resolved = response("done", feedback.id, "Resolved", "intern-a", "2026-09-30T11:00:00Z");
  const reopened = response("reopened", feedback.id, "In progress", "intern-a", "2026-09-30T12:00:00Z");
  const result = feedbackConversation({ updates: [feedback, resolved.update, reopened.update], activityLog: [resolved.activity, reopened.activity] }, feedback.id, "intern-a");
  assert.equal(result.status, "In progress");
  assert.equal(result.messages.length, 3);
});

test("missing or non-manager messages cannot be opened as manager feedback", () => {
  assert.equal(feedbackConversation(task, "missing", "intern-a").feedback, null);
  assert.equal(feedbackConversation({ updates: [{ ...feedback, authorRole: "Member" }] }, feedback.id, "intern-a").messages.length, 0);
});