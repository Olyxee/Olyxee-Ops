const RESPONSE_TYPE = "Feedback response";
const RESPONSE_ACTION = "Feedback response recorded";

export class FeedbackResponseError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "FeedbackResponseError";
    this.statusCode = statusCode;
  }
}

function normalized(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function responseMessage(status, message) {
  if (message !== undefined && message !== null && typeof message !== "string") {
    throw new FeedbackResponseError("Reply must be text.");
  }
  if (typeof message === "string" && message.length > 3000) {
    throw new FeedbackResponseError("Reply must be 3000 characters or fewer.");
  }
  const suppliedMessage = typeof message === "string" ? message.trim() : "";
  if (suppliedMessage) return suppliedMessage;
  return status === "Resolved"
    ? "I’ve resolved this feedback."
    : "I’m working on this feedback.";
}

export async function persistFeedbackResponse({
  client,
  task,
  feedbackId,
  status,
  message,
  identity,
  assigneeIds,
  notifyTaskManagers,
}) {
  if (!["In progress", "Resolved"].includes(status)) {
    throw new FeedbackResponseError("Choose In progress or Resolved.");
  }
  if (!Array.isArray(assigneeIds) || !assigneeIds.includes(identity?.externalId)) {
    throw new FeedbackResponseError("Only an assigned task member can respond to feedback.", 403);
  }
  const reply = responseMessage(status, message);

  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const feedbackResult = await client.query(`
      SELECT id, task_id, author_role, update_type
      FROM public.task_updates
      WHERE id = $1
      FOR SHARE
    `, [feedbackId]);
    const feedback = feedbackResult.rows[0];
    if (!feedback || String(feedback.task_id) !== String(task.id)) {
      throw new FeedbackResponseError("Feedback not found for this task.", 404);
    }
    const managerRole = ["manager", "admin", "superadmin"].includes(normalized(feedback.author_role));
    if (!managerRole || normalized(feedback.update_type) === "feedbackresponse") {
      throw new FeedbackResponseError("Only manager review feedback can receive a response.", 400);
    }

    const updateResult = await client.query(`
      INSERT INTO public.task_updates
        (task_id, author_user_id, author_name, author_role, update_type, message)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, author_user_id, author_name, author_role, update_type, message, created_at
    `, [task.id, identity.userId, identity.name, identity.role, RESPONSE_TYPE, reply]);
    const update = updateResult.rows[0];
    const metadata = {
      feedbackId,
      status,
      responderId: identity.externalId,
      updateId: update.id,
    };
    const activityResult = await client.query(`
      INSERT INTO public.task_activity
        (task_id, actor_user_id, actor_name, action, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING id, actor_name, action, metadata, created_at
    `, [task.id, identity.userId, identity.name, RESPONSE_ACTION, JSON.stringify(metadata)]);
    const activity = activityResult.rows[0];

    await notifyTaskManagers(
      client,
      task,
      "Feedback updated",
      `${identity.name} marked feedback ${status.toLowerCase()} on “${task.title}”.`,
    );
    await client.query("COMMIT");
    transactionStarted = false;

    return {
      update: {
        id: update.id,
        authorId: update.author_user_id,
        authorName: update.author_name,
        authorRole: update.author_role,
        type: RESPONSE_TYPE,
        message: update.message,
        createdAt: update.created_at,
      },
      activity: {
        id: activity.id,
        actorName: activity.actor_name,
        action: RESPONSE_ACTION,
        metadata: activity.metadata,
        createdAt: activity.created_at,
      },
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original validation or persistence error.
      }
    }
    throw error;
  }
}