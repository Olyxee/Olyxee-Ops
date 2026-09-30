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
const { InternTaskDetail } = await vite.ssrLoadModule("/src/App.tsx");
const task = {
  id: "test-task",
  title: "Build the account settings page",
  due: "2026-10-05",
  description: "Add a settings page where users can update their name and profile photo.\nUse the existing profile API and show a clear message after saving.",
  project: "Ops workspace",
  department: "Engineering",
  status: "Not Started",
  priority: "High",
  assignee: "test-intern",
  githubUrl: "https://github.com/example/ops-workspace",
  checklist: [{ id: "check-1", text: "Connect the profile API", completed: false }],
  updates: [],
};
const props = {
  user: { id: "test-intern", name: "Test Intern", employmentType: "Intern" },
  team: [],
  onBack: () => {},
  update: async () => {},
  refresh: async () => {},
  flash: () => {},
};
const render = (patch = {}, extra = {}) => renderToStaticMarkup(
  React.createElement(InternTaskDetail, { ...props, task: { ...task, ...patch }, ...extra }),
);

test("a new task shows only its brief, due date, repo and Start working", () => {
  const html = render();
  for (const text of [task.title, "Due date", "Task brief", task.description.split("\n")[0], task.githubUrl, "Start working"]) {
    assert.ok(html.includes(text), `Missing ${text}`);
  }
  for (const text of ["Checklist", "Submit for review", "I need help", "Next action", "High priority", "Engineering"]) {
    assert.ok(!html.includes(text), `Unexpected initial content: ${text}`);
  }
  assert.equal((html.match(/Due date/g) || []).length, 1);
  assert.equal((html.match(/<button/g) || []).length, 2); // Back and Start working.
});

test("in-progress tasks retain submission and a collapsed checklist", () => {
  const html = render({ status: "In Progress" });
  assert.ok(html.includes("Submit completed work"));
  assert.ok(html.includes("I need help"));
  assert.match(html, /<details class="intern-work-section intern-simple-checklist">/);
  assert.ok(!html.includes("Start working"));
});

test("empty checklists do not add an empty section", () => {
  assert.ok(!render({ status: "In Progress", checklist: [] }).includes("Checklist"));
});

test("review feedback and continuation remain available", () => {
  const html = render({ status: "Changes Requested", updates: [
    { id: "feedback-1", type: "Review feedback", authorName: "Manager", message: "Please add validation." },
  ] });
  assert.ok(html.includes("Please add validation."));
  assert.ok(html.includes("Continue working"));
  assert.ok(!html.includes("Submit completed work"));
});

test("blocked tasks show their reason and can resume", () => {
  const html = render({ status: "Blocked", blockerReason: "Waiting for repository access." });
  assert.ok(html.includes("Waiting for repository access."));
  assert.ok(html.includes("Resume working"));
});

test("submitted, completed and cancelled tasks cannot be started again", () => {
  for (const status of ["Submitted for Review", "Completed", "Cancelled"]) {
    const html = render({ status });
    assert.ok(!html.includes("Start working"));
    assert.ok(!html.includes("Submit completed work"));
    assert.ok(!html.includes("I need help"));
  }
  assert.ok(render({ status: "Submitted for Review" }).includes("Sent for review."));
});

test("the project repository is available when the task has no repo", () => {
  const url = "https://github.com/example/project-repository";
  assert.ok(render({ githubUrl: "" }, { repositoryUrl: url }).includes(`href="${url}"`));
});

test("missing brief and repo are stated clearly, and unsafe repo URLs are not linked", () => {
  const html = render({ description: "", githubUrl: "" });
  assert.ok(html.includes("No task brief was provided."));
  assert.ok(html.includes("No repository link provided."));
  assert.ok(!render({ githubUrl: "javascript:alert(1)" }).includes('href="javascript:'));
});

test("expected outcomes stay in the brief without repeating identical text", () => {
  assert.ok(render({ deliverables: "A working profile form." }).includes("A working profile form."));
  const html = render({ description: "A working profile form.", deliverables: "A working profile form." });
  assert.equal((html.match(/A working profile form\./g) || []).length, 1);
});

if (process.argv.includes("--preview")) {
  const html = render();
  await mkdir(".local/validation", { recursive: true });
  await writeFile(".local/validation/intern-task-detail.html", `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Intern task detail — component validation</title>
${["task-detail", "index", "icloud", "responsive", "intern-task-detail"].map(name => `<link rel="stylesheet" href="/src/${name}.css">`).join("\n")}
<style>body{background:#fff!important} .validation-grid{display:grid;grid-template-columns:minmax(0,740px) 340px;gap:50px;padding:28px;align-items:start}.validation-label{font-size:10px;color:#808780;margin:0 0 20px}.validation-grid>.app{display:block;min-height:0;width:100%;background:#fff!important;background-image:none!important} .validation-grid>.app .intern-task-simple{width:100%}.validation-grid .workspace-section{padding:24px}</style>
</head><body><div class="validation-grid"><div class="app workspace-shell"><p class="validation-label">Desktop · real component, test data</p><div class="workspace-section">${html}</div></div><div class="app workspace-shell"><p class="validation-label">Mobile width · real component, test data</p><div class="workspace-section">${html}</div></div></div></body></html>`);
}