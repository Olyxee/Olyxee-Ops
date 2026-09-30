import assert from "node:assert/strict";
import test from "node:test";
import {
  FeedbackResponseError,
  persistFeedbackResponse,
} from "./feedback-responses.mjs";

function setup({
  feedback = {
    id: "feedback-1",
    task_id: "task-1",
    author_role: " Manager ",
    update_type: " Review   Feedback ",
  },
  assigneeIds = ["intern-7"],
} = {}) {
  const queries = [];
  let updateId = "response-1";
  const client = {
    async query(sql, values = []) {
      const normalizedSql = sql.replace(/\s+/g, " ").trim();
      queries.push({ sql: normalizedSql, values });
      if (normalizedSql.startsWith("SELECT id, task_id, author_role")) {
        return { rows: feedback ? [feedback] : [] };
      }
      if (normalizedSql.startsWith("INSERT INTO public.task_updates")) {
        return {
          rows: [{
            id: updateId,
            author_user_id: "user-7",
            author_name: "Intern Seven",
            author_role: "Member",
            update_type: values[4],
            message: values[5],
            created_at: "2026-04-01T12:00:00.000Z",
          }],
        };
      }
      if (normalizedSql.startsWith("INSERT INTO public.task_activity")) {
        return {
          rows: [{
            id: "activity-1",
            actor_name: "Intern Seven",
            action: values[3],
            metadata: JSON.parse(values[4]),
            created_at: "2026-04-01T12:00:01.000Z",
          }],
        };
      }
      return { rows: [] };
    },
  };
  const notifications = [];
  const notifyTaskManagers = async (...args) => notifications.push(args);
  const args = {
    client,
    task: { id: "task-1", title: "Prepare monthly report" },
    feedbackId: "feedback-1",
    status: "In progress",
    identity: { userId: "user-7", externalId: "intern-7", name: "Intern Seven", role: "Member" },
    assigneeIds,
    notifyTaskManagers,
  };
  return { args, client, queries, notifications };
}

test("persists an assigned member's feedback response and matching activity atomically", async () => {
  const { args, queries, notifications } = setup();
  args.status = "In progress";
  args.message = "I’ll start on the requested revisions.";
  const result = await persistFeedbackResponse(args);

  assert.deepEqual(result, {
    update: {
      id: "response-1",
      authorId: "user-7",
      authorName: "Intern Seven",
      authorRole: "Member",
      type: "Feedback response",
      message: "I’ll start on the requested revisions.",
      createdAt: "2026-04-01T12:00:00.000Z",
    },
    activity: {
      id: "activity-1",
      actorName: "Intern Seven",
      action: "Feedback response recorded",
      metadata: {
        feedbackId: "feedback-1",
        status: "In progress",
        responderId: "intern-7",
        updateId: "response-1",
      },
      createdAt: "2026-04-01T12:00:01.000Z",
    },
  });
  assert.deepEqual(queries.map(({ sql }) => sql === "BEGIN" ? "BEGIN" : sql === "COMMIT" ? "COMMIT" : null).filter(Boolean), ["BEGIN", "COMMIT"]);
  assert.equal(queries.some(({ sql }) => /UPDATE\s+public\.tasks/i.test(sql)), false);
  assert.equal(queries.some(({ sql }) => /submitted_at|completed_at|approval/i.test(sql)), false);
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0].slice(1), [
    args.task,
    "Feedback updated",
    "Intern Seven marked feedback in progress on “Prepare monthly report”.",
  ]);
});

test("uses status-specific defaults for blank replies", async () => {
  for (const [status, message, expected] of [
    ["In progress", "", "I’m working on this feedback."],
    ["Resolved", "   ", "I’ve resolved this feedback."],
  ]) {
    const { args, queries } = setup();
    args.status = status;
    args.message = message;
    await persistFeedbackResponse(args);
    const updateInsert = queries.find(({ sql }) => sql.startsWith("INSERT INTO public.task_updates"));
    assert.equal(updateInsert.values[5], expected);
  }
});

test("rejects feedback for a different task and rolls back without inserting", async () => {
  const { args, queries } = setup({ feedback: { id: "feedback-1", task_id: "task-other", author_role: "Manager", update_type: "Review feedback" } });
  await assert.rejects(
    persistFeedbackResponse(args),
    (error) => error instanceof FeedbackResponseError && error.statusCode === 404,
  );
  assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO")), false);
  assert.equal(queries.at(-1).sql, "ROLLBACK");
});

test("accepts manager-authored general comments and Changes Requested guidance", async () => {
  for (const updateType of ["General comment", "Changes Requested"]) {
    const { args, queries } = setup({
      feedback: { id: "feedback-1", task_id: "task-1", author_role: " ADMIN ", update_type: updateType },
    });
    await persistFeedbackResponse(args);
    assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO public.task_updates")), true);
    assert.equal(queries.at(-1).sql, "COMMIT");
  }
});

test("rejects Member-authored comments and manager-authored feedback response rows", async () => {
  for (const feedback of [
    { id: "feedback-1", task_id: "task-1", author_role: "Member", update_type: "General comment" },
    { id: "feedback-1", task_id: "task-1", author_role: "Superadmin", update_type: "Feedback response" },
  ]) {
    const { args, queries } = setup({ feedback });
    await assert.rejects(
      persistFeedbackResponse(args),
      (error) => error instanceof FeedbackResponseError && error.statusCode === 400,
    );
    assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO")), false);
    assert.equal(queries.at(-1).sql, "ROLLBACK");
  }
});

test("rejects non-manager feedback, invalid statuses, and non-assignees", async () => {
  const nonManager = setup({
    feedback: { id: "feedback-1", task_id: "task-1", author_role: "Member", update_type: "Review feedback" },
  });
  await assert.rejects(
    persistFeedbackResponse(nonManager.args),
    (error) => error instanceof FeedbackResponseError && error.statusCode === 400,
  );

  const invalidStatus = setup();
  invalidStatus.args.status = "Completed";
  await assert.rejects(
    persistFeedbackResponse(invalidStatus.args),
    (error) => error instanceof FeedbackResponseError && error.statusCode === 400,
  );
  assert.equal(invalidStatus.queries.length, 0);

  const nonAssignee = setup({ assigneeIds: ["intern-other"] });
  await assert.rejects(
    persistFeedbackResponse(nonAssignee.args),
    (error) => error instanceof FeedbackResponseError && error.statusCode === 403,
  );
  assert.equal(nonAssignee.queries.length, 0);
});