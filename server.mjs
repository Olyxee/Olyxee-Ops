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
