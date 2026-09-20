import pg from "pg";
import bcrypt from "bcryptjs";

const baseUrl = process.env.TASK_TEST_BASE_URL || "http://127.0.0.1:5000";
const ops = new pg.Pool({ connectionString: process.env.OPS_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const people = new pg.Pool({ connectionString: process.env.EXTERNAL_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const suffix = crypto.randomUUID().slice(0, 8);
const password = `Workflow-${crypto.randomUUID()}!`;
const managerEmail = `workflow-manager-${suffix}@example.test`;
const internEmail = `workflow-intern-${suffix}@example.test`;
const collaboratorEmail = `workflow-collaborator-${suffix}@example.test`;
let managerAccountId;
let internId;
let collaboratorId;
let taskId;

async function api(path, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${payload.error || response.status}`);
  return { payload, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function expectFailure(path, options, status) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: { Cookie: options.cookie, "Content-Type": "application/json" },
    body: JSON.stringify(options.body),
  });
  if (response.status !== status) throw new Error(`${options.method} ${path}: expected ${status}, received ${response.status}`);
}

try {
  const passwordHash = await bcrypt.hash(password, 10);
  const manager = await people.query(`
    INSERT INTO public.workspace_accounts
      (email, display_name, manage_interns, manage_projects, active, department)
    VALUES ($1, 'Workflow Manager', true, true, true, 'Engineering')
    RETURNING id
  `, [managerEmail]);
  managerAccountId = manager.rows[0].id;
  const intern = await people.query(`
    INSERT INTO public.interns
      (intern_number, full_name, email, department, employment_status, supervisor_name, supervisor_email, supervisor_account_id)
    VALUES ($1, 'Workflow Intern', $2, 'Engineering', 'Active', 'Workflow Manager', $3, $4)
    RETURNING id
  `, [`TEST-${suffix}`, internEmail, managerEmail, managerAccountId]);
  internId = intern.rows[0].id;
  const collaborator = await people.query(`
    INSERT INTO public.interns
      (intern_number, full_name, email, department, employment_status, supervisor_name, supervisor_email, supervisor_account_id)
    VALUES ($1, 'Workflow Collaborator', $2, 'Data & Security', 'Active', 'Workflow Manager', $3, $4)
    RETURNING id
  `, [`TEST-COLLAB-${suffix}`, collaboratorEmail, managerEmail, managerAccountId]);
  collaboratorId = collaborator.rows[0].id;
  await ops.query(`
    INSERT INTO public.ops_users (email, password_hash, display_name, role, active)
    VALUES
      ($1,$2,'Workflow Manager','Manager',true),
      ($3,$2,'Workflow Intern','Member',true),
      ($4,$2,'Workflow Collaborator','Member',true)
  `, [managerEmail, passwordHash, internEmail, collaboratorEmail]);

  const managerLogin = await api("/api/auth/login", { method: "POST", body: { email: managerEmail, password } });
  const managerCookie = managerLogin.cookie;
  const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const created = await api("/api/tasks", {
    cookie: managerCookie,
    method: "POST",
    body: {
      title: "Workflow persistence check",
      description: "Temporary automated regression task",
      project: "Workflow verification",
      githubUrl: "https://github.com/olyxee/workflow-verification",
      departmentIds: ["Engineering", "Data & Security"],
      assigneeIds: [`intern-${internId}`, `intern-${collaboratorId}`],
      taskLeadId: `intern-${collaboratorId}`,
      priority: "Normal",
      startDate: new Date().toISOString().slice(0, 10),
      deliverables: "A verified shared task workflow.",
      due,
    },
  });
  taskId = created.payload.task.id;
  if (created.payload.task.departmentIds?.length !== 2 || created.payload.task.assigneeIds?.length !== 2 || created.payload.task.taskLeadId !== `intern-${collaboratorId}`) {
    throw new Error("Multi-department collaboration fields were not persisted.");
  }
  await expectFailure(`/api/tasks/${taskId}`, { cookie: managerCookie, method: "PATCH", body: { status: "In Progress" } }, 403);
  const managerTasks = await api("/api/tasks", { cookie: managerCookie });
  if (!managerTasks.payload.tasks.some((task) => task.id === taskId)) throw new Error("Manager cannot reload the created task.");

  const internLogin = await api("/api/auth/login", { method: "POST", body: { email: internEmail, password } });
  const internCookie = internLogin.cookie;
  const collaboratorLogin = await api("/api/auth/login", { method: "POST", body: { email: collaboratorEmail, password } });
  const collaboratorCookie = collaboratorLogin.cookie;
  const internTasks = await api("/api/tasks", { cookie: internCookie });
  if (!internTasks.payload.tasks.some((task) => task.id === taskId)) throw new Error("Intern cannot see the assigned task.");
  const collaboratorTasks = await api("/api/tasks", { cookie: collaboratorCookie });
  if (!collaboratorTasks.payload.tasks.some((task) => task.id === taskId)) throw new Error("Secondary assignee cannot see the shared task.");
  await api(`/api/tasks/${taskId}`, { cookie: collaboratorCookie, method: "PATCH", body: { status: "In Progress" } });
  await expectFailure(`/api/tasks/${taskId}`, { cookie: internCookie, method: "PATCH", body: { status: "Submitted for Review" } }, 400);
  const checklist = await api(`/api/tasks/${taskId}/checklist`, { cookie: internCookie, method: "POST", body: { text: "Verify persistence" } });
  await api(`/api/tasks/${taskId}/checklist/${checklist.payload.item.id}`, { cookie: internCookie, method: "PATCH", body: { completed: true, comment: "Verified the shared task workflow." } });
  await api(`/api/tasks/${taskId}/updates`, { cookie: internCookie, method: "POST", body: { type: "Progress update", message: "Persistence verified." } });
  await api(`/api/tasks/${taskId}/evidence`, { cookie: internCookie, method: "POST", body: { label: "Verification", url: "https://example.com/evidence" } });
  await api(`/api/tasks/${taskId}/submit`, { cookie: collaboratorCookie, method: "POST", body: { summary: "Work complete with checklist and evidence." } });

  const reviewList = await api("/api/tasks", { cookie: managerCookie });
  const submitted = reviewList.payload.tasks.find((task) => task.id === taskId);
  if (submitted?.status !== "Submitted for Review") throw new Error("Manager cannot see the submitted state.");
  await api(`/api/tasks/${taskId}`, { cookie: managerCookie, method: "PATCH", body: { status: "Changes Requested", feedback: "Please verify the final result." } });
  await api(`/api/tasks/${taskId}`, { cookie: internCookie, method: "PATCH", body: { status: "In Progress" } });
  await api(`/api/tasks/${taskId}/submit`, { cookie: internCookie, method: "POST", body: { summary: "Requested changes completed." } });
  await api(`/api/tasks/${taskId}`, { cookie: managerCookie, method: "PATCH", body: { status: "Completed", feedback: "Verified and approved." } });

  const finalInternList = await api("/api/tasks", { cookie: internCookie });
  const completed = finalInternList.payload.tasks.find((task) => task.id === taskId);
  if (completed?.status !== "Completed") throw new Error("Completed state did not persist for the Intern.");
  if (!completed.checklist?.[0]?.completed || !completed.evidence?.length || !completed.updates?.length || !completed.activityLog?.length) {
    throw new Error("Task workspace records did not persist.");
  }
  await expectFailure(`/api/tasks/${taskId}`, { cookie: collaboratorCookie, method: "DELETE", body: {} }, 403);
  const deleted = await fetch(`${baseUrl}/api/tasks/${taskId}`, { method: "DELETE", headers: { Cookie: managerCookie } });
  if (deleted.status !== 204) throw new Error(`Manager task deletion expected 204, received ${deleted.status}`);
  const afterDelete = await api("/api/tasks", { cookie: managerCookie });
  if (afterDelete.payload.tasks.some((task) => task.id === taskId)) throw new Error("Deleted task still contributes to the task dataset.");
  taskId = undefined;
  console.log("Manager/Intern task workflow persistence passed.");
} finally {
  if (taskId) await ops.query("DELETE FROM public.tasks WHERE id = $1", [taskId]).catch(() => {});
  await ops.query("DELETE FROM public.ops_users WHERE email = ANY($1)", [[managerEmail, internEmail, collaboratorEmail]]).catch(() => {});
  if (collaboratorId) await people.query("DELETE FROM public.interns WHERE id = $1", [collaboratorId]).catch(() => {});
  if (internId) await people.query("DELETE FROM public.interns WHERE id = $1", [internId]).catch(() => {});
  if (managerAccountId) await people.query("DELETE FROM public.workspace_accounts WHERE id = $1", [managerAccountId]).catch(() => {});
  await Promise.all([ops.end(), people.end()]);
}