import express from "express";
import pg from "pg";
import cors from "cors";
import multer from "multer";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { createClerkClient } from "@clerk/backend";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { Client as ObjectStorageClient } from "@replit/object-storage";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./server/clerkProxyMiddleware.mjs";

const app = express();
const port = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === "production";

const peoplePool = process.env.EXTERNAL_DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.EXTERNAL_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;
const appPool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const clerkClient = process.env.CLERK_SECRET_KEY ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }) : null;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowed = file.mimetype.startsWith("image/") || ["application/pdf", "text/plain"].includes(file.mimetype);
    callback(allowed ? null : new Error("Unsupported file type."), allowed);
  },
});
const stateKeys = new Set(["tasks", "projects", "audit", "notices", "objectives", "staff-statuses"]);

app.disable("x-powered-by");
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(
  clerkMiddleware((request) => ({
    publishableKey: publishableKeyFromHost(getClerkProxyHost(request) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
  })),
);

const requireAuth = (request, response, next) => {
  const auth = getAuth(request);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) return response.status(401).json({ error: "Unauthorized" });
  request.clerkUserId = userId;
  return next();
};

async function resolveExternalPerson(email) {
  if (!peoplePool) return null;
  const result = await peoplePool.query(`
    SELECT * FROM (
      SELECT
        'account-' || id::text AS external_id,
        coalesce(display_name, email) AS name,
        email,
        'Employee' AS employment_type,
        CASE WHEN manage_interns OR manage_projects THEN 'Manager' ELSE 'Member' END AS access_role,
        'Operations' AS department,
        active
      FROM public.workspace_accounts
      WHERE lower(email) = lower($1)
      UNION ALL
      SELECT
        'intern-' || id::text,
        full_name,
        email,
        'Intern',
        'Member',
        coalesce(nullif(trim(department), ''), 'Unassigned'),
        lower(coalesce(employment_status, '')) = 'active'
      FROM public.interns
      WHERE lower(email) = lower($1) AND archived_at IS NULL
    ) person
    LIMIT 1
  `, [email]);
  return result.rows[0] || null;
}

async function getAppAccount(clerkUserId) {
  if (!appPool || !clerkClient) throw new Error("Application database or authentication is not configured.");
  const existing = await appPool.query("SELECT * FROM app_accounts WHERE clerk_user_id = $1", [clerkUserId]);
  if (existing.rows[0]) return existing.rows[0];

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const primaryEmail = clerkUser.emailAddresses.find((item) => item.id === clerkUser.primaryEmailAddressId)?.emailAddress
    || clerkUser.emailAddresses[0]?.emailAddress;
  if (!primaryEmail) throw new Error("Your login does not have an email address.");

  const [person, grantResult] = await Promise.all([
    resolveExternalPerson(primaryEmail),
    appPool.query("SELECT app_role FROM app_access_grants WHERE lower(email) = lower($1) AND active = true", [primaryEmail]),
  ]);
  const grant = grantResult.rows[0];
  if (!person && !grant) {
    const error = new Error("No matching person record was found.");
    error.statusCode = 403;
    throw error;
  }

  const appRole = grant?.app_role || person.access_role;
  const inserted = await appPool.query(`
    INSERT INTO app_accounts (clerk_user_id, email, external_person_id, app_role)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [clerkUserId, primaryEmail.toLowerCase(), person?.external_id || null, appRole]);
  return inserted.rows[0];
}

const requireAccount = async (request, response, next) => {
  try {
    request.appAccount = await getAppAccount(request.clerkUserId);
    return next();
  } catch (error) {
    return response.status(error.statusCode || 503).json({ error: error.message || "Account unavailable." });
  }
};

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, appDatabaseConfigured: Boolean(appPool), peopleDatabaseConfigured: Boolean(peoplePool), authConfigured: Boolean(clerkClient) });
});

app.get("/api/me", requireAuth, requireAccount, async (request, response) => {
  const account = request.appAccount;
  const clerkUser = await clerkClient.users.getUser(request.clerkUserId);
  const person = await resolveExternalPerson(account.email);
  const profile = account.profile_data || {};
  return response.json({
    id: person?.external_id || `account-${account.id}`,
    name: person?.name || [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || account.email,
    email: account.email,
    employmentType: person?.employment_type || "Employee",
    accessRole: account.app_role,
    accountStatus: account.active ? "Active" : "Suspended",
    department: person?.department || "Operations",
    role: account.app_role === "Superadmin" ? "Super Admin" : account.app_role,
    active: account.active,
    avatarUrl: profile.avatarUrl,
    contactDetails: profile.contactDetails,
    githubUsername: profile.githubUsername,
  });
});

app.patch("/api/me/profile", requireAuth, requireAccount, async (request, response) => {
  const allowed = {
    avatarUrl: typeof request.body.avatarUrl === "string" ? request.body.avatarUrl.slice(0, 500) : undefined,
    contactDetails: typeof request.body.contactDetails === "string" ? request.body.contactDetails.slice(0, 100) : undefined,
    githubUsername: typeof request.body.githubUsername === "string" ? request.body.githubUsername.slice(0, 40) : undefined,
  };
  const result = await appPool.query(`
    UPDATE app_accounts
    SET profile_data = $1::jsonb, updated_at = now()
    WHERE id = $2
    RETURNING profile_data
  `, [JSON.stringify(allowed), request.appAccount.id]);
  return response.json(result.rows[0].profile_data);
});

app.get("/api/staff-summary", requireAuth, requireAccount, async (_request, response) => {
  if (!peoplePool) {
    return response.status(503).json({ error: "Database connection is not configured." });
  }

  try {
    const result = await peoplePool.query(`
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

app.get("/api/people", requireAuth, requireAccount, async (request, response) => {
  if (!peoplePool) {
    return response.status(503).json({ error: "Database connection is not configured." });
  }

  try {
    const [internResult, accountResult] = await Promise.all([
      peoplePool.query(`
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
      peoplePool.query(`
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
    const people = [...managers, ...interns];
    const role = request.appAccount.app_role;
    const ownEmail = String(request.appAccount.email).toLowerCase();
    const current = people.find((person) => String(person.email).toLowerCase() === ownEmail);
    const visiblePeople = ["Superadmin", "Admin"].includes(role)
      ? people
      : role === "Manager"
        ? people.filter((person) => person.id === current?.id || person.reportsTo === current?.id)
        : people.filter((person) => person.id === current?.id);
    return response.json({ connected: true, source: "Supabase", people: visiblePeople });
  } catch (error) {
    console.error("People query failed:", error instanceof Error ? error.message : "Unknown error");
    return response.status(503).json({ error: "Live people records are temporarily unavailable." });
  }
});

app.get("/api/state/:key", requireAuth, requireAccount, async (request, response) => {
  if (!stateKeys.has(request.params.key)) return response.status(404).json({ error: "Unknown state collection." });
  const result = await appPool.query("SELECT state_value FROM workspace_state WHERE state_key = $1", [request.params.key]);
  if (!result.rows[0]) return response.status(404).json({ error: "State collection has not been initialized." });
  return response.json({ value: result.rows[0].state_value });
});

app.put("/api/state/:key", requireAuth, requireAccount, async (request, response) => {
  if (!stateKeys.has(request.params.key)) return response.status(404).json({ error: "Unknown state collection." });
  if (!["Superadmin", "Admin", "Manager", "Member"].includes(request.appAccount.app_role)) return response.status(403).json({ error: "Forbidden" });
  await appPool.query(`
    INSERT INTO workspace_state (state_key, state_value, updated_by)
    VALUES ($1, $2::jsonb, $3)
    ON CONFLICT (state_key) DO UPDATE
    SET state_value = EXCLUDED.state_value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `, [request.params.key, JSON.stringify(request.body.value), request.appAccount.id]);
  return response.json({ ok: true });
});

app.post("/api/assets", requireAuth, requireAccount, upload.single("file"), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: "A file is required." });
  const kind = String(request.body.kind || "");
  if (!["profile", "project_logo", "document", "image"].includes(kind)) return response.status(400).json({ error: "Invalid asset kind." });
  const extension = request.file.originalname.includes(".") ? `.${request.file.originalname.split(".").pop().replace(/[^a-z0-9]/gi, "").toLowerCase()}` : "";
  const objectKey = `olyxee/${request.appAccount.id}/${crypto.randomUUID()}${extension}`;
  let objectStorage;
  try {
    objectStorage = new ObjectStorageClient();
  } catch {
    return response.status(503).json({ error: "App Storage has not been configured yet." });
  }
  const uploaded = await objectStorage.uploadFromBytes(objectKey, request.file.buffer, { compress: false });
  if (!uploaded.ok) return response.status(503).json({ error: "File storage is temporarily unavailable." });
  const result = await appPool.query(`
    INSERT INTO app_assets (owner_account_id, external_person_id, asset_kind, object_key, original_filename, mime_type, byte_size)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [request.appAccount.id, request.appAccount.external_person_id, kind, objectKey, request.file.originalname, request.file.mimetype, request.file.size]);
  return response.status(201).json({ id: result.rows[0].id, url: `/api/assets/${result.rows[0].id}` });
});

app.get("/api/assets/:id", requireAuth, requireAccount, async (request, response) => {
  const result = await appPool.query("SELECT object_key, mime_type, original_filename FROM app_assets WHERE id = $1", [request.params.id]);
  const asset = result.rows[0];
  if (!asset) return response.status(404).json({ error: "Asset not found." });
  response.type(asset.mime_type);
  response.set("Cache-Control", "private, max-age=3600");
  response.set("Content-Disposition", `inline; filename="${asset.original_filename.replace(/"/g, "")}"`);
  const objectStorage = new ObjectStorageClient();
  return objectStorage.downloadAsStream(asset.object_key).pipe(response);
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
