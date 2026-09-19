import express from "express";
import pg from "pg";

const app = express();
const port = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === "production";

const pool = process.env.EXTERNAL_DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.EXTERNAL_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, databaseConfigured: Boolean(pool) });
});

app.get("/api/staff-summary", async (_request, response) => {
  if (!pool) {
    return response.status(503).json({ error: "Database connection is not configured." });
  }

  try {
    const result = await pool.query(`
      SELECT
        (
          SELECT count(*)::int
          FROM public.interns
          WHERE lower(coalesce(employment_status, '')) = 'active'
        ) AS active_interns,
        (
          SELECT count(*)::int
          FROM public.interns
          WHERE lower(coalesce(employment_status, '')) = 'completed'
        ) AS completed_interns,
        (
          SELECT count(*)::int
          FROM public.workspace_accounts
          WHERE active = true
            AND (manage_interns = true OR manage_projects = true)
        ) AS managers,
        (
          SELECT count(*)::int
          FROM public.workspace_accounts
          WHERE active = true
        ) AS active_accounts,
        (
          SELECT count(DISTINCT department)::int
          FROM public.interns
          WHERE lower(coalesce(employment_status, '')) = 'active'
            AND nullif(trim(department), '') IS NOT NULL
        ) AS departments
    `);

    const summary = result.rows[0];
    response.set("Cache-Control", "private, max-age=30");
    return response.json({
      connected: true,
      source: "Supabase",
      activePeople: summary.active_interns + summary.active_accounts,
      activeInterns: summary.active_interns,
      completedInterns: summary.completed_interns,
      managers: summary.managers,
      departments: summary.departments,
    });
  } catch (error) {
    console.error("Staff summary query failed:", error instanceof Error ? error.message : "Unknown error");
    return response.status(503).json({ error: "Live staff summary is temporarily unavailable." });
  }
});

app.get("/api/people", async (_request, response) => {
  if (!pool) {
    return response.status(503).json({ error: "Database connection is not configured." });
  }

  try {
    const [internResult, accountResult] = await Promise.all([
      pool.query(`
        SELECT
          id,
          full_name,
          email,
          department,
          employment_status,
          supervisor_name,
          supervisor_email
        FROM public.interns
        WHERE archived_at IS NULL
        ORDER BY
          CASE WHEN lower(coalesce(employment_status, '')) = 'active' THEN 0 ELSE 1 END,
          full_name
      `),
      pool.query(`
        SELECT
          id,
          email,
          display_name,
          manage_interns,
          manage_projects,
          active
        FROM public.workspace_accounts
        ORDER BY active DESC, display_name
      `),
    ]);

    const managerIds = new Map();
    for (const account of accountResult.rows) {
      managerIds.set(String(account.email || "").toLowerCase(), `account-${account.id}`);
      managerIds.set(String(account.display_name || "").toLowerCase(), `account-${account.id}`);
    }

    const managers = accountResult.rows.map((account) => {
      const matchingIntern = internResult.rows.find((intern) =>
        String(intern.supervisor_email || "").toLowerCase() === String(account.email || "").toLowerCase()
        || String(intern.supervisor_name || "").toLowerCase() === String(account.display_name || "").toLowerCase()
      );
      const isManager = account.manage_interns || account.manage_projects;
      return {
        id: `account-${account.id}`,
        name: account.display_name || account.email,
        email: account.email,
        employmentType: "Employee",
        accessRole: isManager ? "Manager" : "Member",
        accountStatus: account.active ? "Active" : "Suspended",
        department: matchingIntern?.department || "Operations",
        role: isManager ? "Manager" : "Member",
        active: Boolean(account.active),
        source: "Supabase",
      };
    });

    const interns = internResult.rows.map((intern) => {
      const active = String(intern.employment_status || "").toLowerCase() === "active";
      const supervisorKey = String(intern.supervisor_email || intern.supervisor_name || "").toLowerCase();
      return {
        id: `intern-${intern.id}`,
        name: intern.full_name,
        email: intern.email || "",
        employmentType: "Intern",
        accessRole: "Member",
        accountStatus: active ? "Active" : "Suspended",
        department: intern.department || "Unassigned",
        reportsTo: managerIds.get(supervisorKey),
        role: "Intern",
        active,
        source: "Supabase",
        employmentStatus: intern.employment_status || "Unknown",
        supervisorName: intern.supervisor_name || "",
      };
    });

    response.set("Cache-Control", "private, max-age=30");
    return response.json({ connected: true, source: "Supabase", people: [...managers, ...interns] });
  } catch (error) {
    console.error("People query failed:", error instanceof Error ? error.message : "Unknown error");
    return response.status(503).json({ error: "Live people records are temporarily unavailable." });
  }
});

if (isProduction) {
  const { default: path } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(root, "dist")));
  app.use((_request, response) => response.sendFile(path.join(root, "dist", "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, allowedHosts: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(port, "0.0.0.0", () => {
  console.log(`Olyxee Ops listening on port ${port}`);
});
