import { useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check } from "lucide-react";
import Github from "./GithubIcon";
import type { Task, TaskActivity, TaskUpdate, User } from "./data";
import { feedbackConversation } from "../shared/feedback-conversation.mjs";

type FeedbackResponseStatus = "In progress" | "Resolved";
type SavedResponse = { update: TaskUpdate; activity: TaskActivity };

export default function FeedbackConversation({ task, feedbackId, user, repositoryUrl, onBack, refresh }: {
  task: Task;
  feedbackId: string;
  user: User;
  repositoryUrl?: string;
  onBack: () => void;
  refresh: () => Promise<void>;
}) {
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState<FeedbackResponseStatus | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<SavedResponse[]>([]);
  const thread = useMemo(() => feedbackConversation({
    ...task,
    updates: [...(task.updates || []), ...saved.map(item => item.update).filter(update => !(task.updates || []).some(item => item.id === update.id))],
    activityLog: [...(task.activityLog || []), ...saved.map(item => item.activity).filter(activity => !(task.activityLog || []).some(item => item.id === activity.id))],
  }, feedbackId, user.id), [task, feedbackId, user.id, saved]);
  const repo = repositoryUrl || task.githubUrl || "";
  const repoAvailable = /^https?:\/\/\S+$/i.test(repo);

  const respond = async (status: FeedbackResponseStatus) => {
    if (saving || (thread.status === status && !reply.trim())) return;
    setSaving(status);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/feedback/${encodeURIComponent(feedbackId)}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, message: reply.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your response.");
      if (!result.update?.id || !result.activity?.id) throw new Error("Your response could not be confirmed. Refresh before trying again.");
      setSaved(current => [...current, { update: result.update, activity: result.activity }]);
      setReply("");
      try { await refresh(); }
      catch { setError("Your response is saved, but the conversation could not refresh. Try reloading the page."); }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your response. Please try again.");
    } finally { setSaving(null); }
  };

  return <div className="feedback-conversation">
    <button className="feedback-back" type="button" onClick={onBack}><ArrowLeft size={15} /> Back to Home</button>
    {!thread.feedback ? <p className="feedback-unavailable">This feedback is no longer available.</p> : <>
      <header className="feedback-conversation-head">
        <div><span className="feedback-conversation-label">Manager feedback</span><h1>{task.title}</h1><p>{task.project}</p></div>
        <span className={`feedback-response-state ${thread.status === "Resolved" ? "resolved" : thread.status === "In progress" ? "in-progress" : "open"}`}>{thread.status === "Open" ? "Awaiting response" : thread.status}</span>
      </header>
      <div className="feedback-project-link">
        {repoAvailable ? <a href={repo} target="_blank" rel="noopener noreferrer"><Github size={15} /><span>Project GitHub</span><ArrowUpRight size={14} /></a> : <span>No GitHub link provided for this project.</span>}
      </div>
      <ol className="feedback-thread" aria-label="Feedback conversation" aria-live="polite" aria-relevant="additions">
        {thread.messages.map(message => {
          const mine = !message.isFeedback && message.responderId === user.id;
          return <li key={message.id} className={mine ? "feedback-message mine" : "feedback-message"}>
            <div className="feedback-message-meta"><strong>{mine ? "You" : message.authorName}</strong><span>{message.authorRole}</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div>
            <div className="feedback-message-body"><p>{message.message}</p>{message.linkUrl && /^https?:\/\/\S+$/i.test(message.linkUrl) && <a href={message.linkUrl} target="_blank" rel="noopener noreferrer">Supporting link <ArrowUpRight size={12} /></a>}{message.status && <span className={`feedback-message-status ${message.status === "Resolved" ? "resolved" : ""}`}>{message.status === "Resolved" && <Check size={12} />}{message.status}</span>}</div>
          </li>;
        })}
      </ol>
      <section className="feedback-response-composer" aria-label="Respond to feedback">
        <label htmlFor="feedback-reply">Your reply <span>Optional</span></label>
        <textarea id="feedback-reply" className="textarea" rows={3} maxLength={3000} value={reply} disabled={Boolean(saving)} onChange={event => setReply(event.target.value)} placeholder="Add a short update for your manager…" />
        {error && <p className="feedback-save-error" role="alert">{error}</p>}
        <div className="feedback-response-actions">
          <button className="btn" type="button" aria-pressed={thread.status === "In progress"} disabled={Boolean(saving) || (thread.status === "In progress" && !reply.trim())} onClick={() => void respond("In progress")}>{saving === "In progress" ? "Saving…" : "In progress"}</button>
          <button className="btn primary" type="button" aria-pressed={thread.status === "Resolved"} disabled={Boolean(saving) || (thread.status === "Resolved" && !reply.trim())} onClick={() => void respond("Resolved")}><Check size={14} />{saving === "Resolved" ? "Saving…" : "Resolved"}</button>
        </div>
        <p className="feedback-approval-note">These actions update the feedback only. Task approval stays with your manager.</p>
      </section>
    </>}
  </div>;
}