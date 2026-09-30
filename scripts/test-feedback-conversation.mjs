import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const vite = await createServer({
  configFile: false,
  cacheDir: ".local/validation/vite-cache",
  plugins: [react()],
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
after(() => vite.close());
const { default: FeedbackConversation } = await vite.ssrLoadModule("/src/FeedbackConversation.tsx");
const feedback = { id: "feedback-1", authorId: "manager-id", authorName: "Test Manager", authorRole: "Manager", type: "Review feedback", message: "The settings page looks good. Please add validation for the profile name and a clear error message when an upload fails.", createdAt: "2026-09-30T10:00:00Z" };
const task = { id: "test-task", title: "Build the account settings page", project: "Ops workspace", githubUrl: "https://github.com/example/ops-workspace", status: "Changes Requested", updates: [feedback], activityLog: [] };
const props = { task, feedbackId: feedback.id, user: { id: "test-intern", name: "Test Intern" }, onBack: () => {}, refresh: async () => {} };
const render = (patch = {}, extra = {}) => renderToStaticMarkup(React.createElement(FeedbackConversation, { ...props, task: { ...task, ...patch }, ...extra }));
const repliedTask = status => ({
  updates: [...task.updates, { id: "response-1", authorId: "internal-user-id", authorName: "Test Intern", authorRole: "Member", type: "Feedback response", message: status === "Resolved" ? "Added validation and tested the upload failure message." : "I’m adding validation and testing the upload error.", createdAt: "2026-09-30T11:00:00Z" }],
  activityLog: [{ id: "activity-1", actorName: "Test Intern", action: "Feedback response recorded", metadata: { feedbackId: feedback.id, status, responderId: "test-intern", updateId: "response-1" }, createdAt: "2026-09-30T11:00:00Z" }],
});

test("feedback opens as a conversation with the actual manager message and two response actions", () => {
  const html = render();
  for (const text of [task.title, feedback.message, feedback.authorName, "Project GitHub", "In progress", "Resolved", "Your reply", "Back to Home"]) assert.ok(html.includes(text), `Missing ${text}`);
  assert.match(html, /aria-label="Feedback conversation"/);
  assert.ok(!html.includes("Start working"));
  assert.ok(!html.includes("Submit completed work"));
  assert.equal((html.match(/<button/g) || []).length, 3);
});

test("project repository takes precedence over a task-specific URL", () => {
  const url = "https://github.com/example/project";
  const html = render({}, { repositoryUrl: url });
  assert.ok(html.includes(`href="${url}"`));
  assert.ok(!html.includes(`href="${task.githubUrl}"`));
});

test("unsafe or missing repository URLs are not linked", () => {
  assert.ok(render({ githubUrl: "" }).includes("No GitHub link provided"));
  assert.ok(!render({ githubUrl: "javascript:alert(1)" }).includes('href="javascript:'));
});

test("saved in-progress replies appear on the intern's side with the matching selected action", () => {
  const html = render(repliedTask("In progress"));
  assert.match(html, /class="feedback-message mine"/);
  assert.ok(html.includes("I’m adding validation"));
  assert.match(html, /aria-pressed="true" disabled="">In progress/);
});

test("resolved feedback retains conversation history and a way to reopen it", () => {
  const html = render(repliedTask("Resolved"));
  assert.ok(html.includes(feedback.message));
  assert.ok(html.includes("Added validation and tested"));
  assert.ok(html.includes("feedback-response-state resolved"));
  assert.match(html, /aria-pressed="false">In progress/);
  assert.ok(html.includes("Task approval stays with your manager."));
});

test("completed tasks can acknowledge feedback without presenting task approval actions", () => {
  const html = render({ status: "Completed" });
  assert.ok(html.includes(">In progress</button>"));
  assert.ok(html.includes("Resolved"));
  assert.ok(!html.includes("Approve work"));
});

test("deleted or unrelated feedback has no response buttons", () => {
  const html = render({}, { feedbackId: "missing" });
  assert.ok(html.includes("This feedback is no longer available."));
  assert.ok(!html.includes(">Resolved<"));
});

if (process.argv.includes("--preview")) {
  await mkdir(".local/validation", { recursive: true });
  const styles = ["index", "icloud", "responsive", "feedback-conversation"].map(name => `<link rel="stylesheet" href="/src/${name}.css">`).join("\n");
  const css = "<style>body{background:#fff!important;margin:0}.app{display:block!important;min-height:0!important;width:100%!important;background:#fff!important;background-image:none!important}.workspace-section{padding:24px!important;box-shadow:none!important}.validation-label{color:#8a938b;font:10px system-ui;margin:0 0 20px}.validation-grid{display:grid;grid-template-columns:minmax(0,740px) 340px;gap:40px;padding:24px}.validation-grid iframe{width:340px;height:920px;border:1px solid #e5e9e6;border-radius:12px}</style>";
  await writeFile(".local/validation/feedback-conversation-mobile.html", `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}${css}</head><body><div class="app workspace-shell"><div class="workspace-section">${render()}</div></div></body></html>`);
  await writeFile(".local/validation/feedback-conversation.html", `<!doctype html><html><head><meta charset="utf-8"><title>Feedback conversation — component validation</title>${styles}${css}</head><body><div class="validation-grid"><div><p class="validation-label">Desktop · actual component, explicit test data</p><div class="app workspace-shell"><div class="workspace-section">${render(repliedTask("In progress"))}</div></div></div><div><p class="validation-label">Mobile · 340px viewport, explicit test data</p><iframe title="Mobile feedback conversation" src="/.local/validation/feedback-conversation-mobile.html"></iframe></div></div></body></html>`);
}