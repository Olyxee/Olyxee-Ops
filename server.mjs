import express from "express";
import pg from "pg";
import multer from "multer";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { Client as ObjectStorageClient } from "@replit/object-storage";
import {
  OFFICIAL_DEPARTMENTS,
  UNASSIGNED_DEPARTMENT,
  isOfficialDepartment,
  resolveDepartment,
} from "./shared/departments.mjs";

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
const appPool = process.env.OPS_DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.OPS_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowed = file.mimetype.startsWith("image/") || ["application/pdf", "text/plain"].includes(file.mimetype);
    callback(allowed ? null : new Error("Unsupported file type."), allowed);
  },
});
const stateKeys = new Set(["tasks", "projects", "audit", "notices", "objectives", "staff-statuses", "departments"]);
const loginAttempts = new Map();
const dummyPasswordHash = await bcrypt.hash(crypto.randomUUID(), 12);

const validateDepartment = (value, { allowUnassigned = true } = {}) => {
  const department = String(value || "").trim();
  if (isOfficialDepartment(department)) return department;
  if (allowUnassigned && (!department || department === UNASSIGNED_DEPARTMENT)) return UNASSIGNED_DEPARTMENT;
  return null;
};

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
if (appPool) {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required when Ops authentication is enabled.");
  const PgSession = connectPgSimple(session);
  app.set("trust proxy", 1);
  app.use(session({
    store: new PgSession({ pool: appPool, tableName: "ops_sessions", createTableIfMissing: false }),
    name: "olyxee.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }));
}

const requireAuth = (request, response, next) => {
  const userId = request.session?.userId;
  if (!userId) return response.status(401).json({ error: "Unauthorized" });
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

async function getAppAccount(userId) {
  if (!appPool) throw new Error("Application database is not configured.");
  const result = await appPool.query(`
    SELECT id, email, display_name, role AS app_role, active, profile_data
    FROM public.ops_users
    WHERE id = $1
  `, [userId]);
  if (!result.rows[0]?.active) {
    const error = new Error("Account is unavailable.");
    error.statusCode = 403;
    throw error;
  }
  return result.rows[0];
}

const requireAccount = async (request, response, next) => {
  try {
    request.appAccount = await getAppAccount(request.session.userId);
    return next();
  } catch (error) {
    return response.status(error.statusCode || 503).json({ error: error.message || "Account unavailable." });
  }
};

const requireAdmin = (request, response, next) => {
  if (!["Superadmin", "Admin"].includes(request.appAccount?.app_role)) {
    return response.status(403).json({ error: "Forbidden" });
  }
  return next();
};

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, appDatabaseConfigured: Boolean(appPool), peopleDatabaseConfigured: Boolean(peoplePool), authConfigured: Boolean(appPool && process.env.SESSION_SECRET) });
});

app.get("/api/auth/session", (request, response) => {
  return response.json({ authenticated: Boolean(request.session?.userId) });
});

app.post("/api/auth/login", async (request, response) => {
  if (!appPool) return response.status(503).json({ error: "Ops database is not configured." });
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  if (!email || !password) return response.status(400).json({ error: "Email and password are required." });
  const attemptKey = `${request.ip || "unknown"}:${email}`;
  const now = Date.now();
  const attempts = loginAttempts.get(attemptKey);
  if (attempts?.blockedUntil > now) {
    return response.status(429).json({ error: "Too many sign-in attempts. Try again later." });
  }
  const result = await appPool.query(`
    SELECT id, password_hash, active
    FROM public.ops_users
    WHERE email = $1
  `, [email]);
  const account = result.rows[0];
  const valid = await bcrypt.compare(password, account?.password_hash || dummyPasswordHash);
  if (!account?.active || !valid) {
    const count = (attempts?.count || 0) + 1;
    loginAttempts.set(attemptKey, {
      count,
      blockedUntil: count >= 5 ? now + 15 * 60 * 1000 : 0,
    });
    return response.status(401).json({ error: "Invalid email or password." });
  }
  loginAttempts.delete(attemptKey);
  await new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
  request.session.userId = account.id;
  await new Promise((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()));
  return response.json({ ok: true });
});

app.post("/api/auth/logout", (request, response) => {
  if (!request.session) return response.json({ ok: true });
  request.session.destroy((error) => {
    if (error) return response.status(503).json({ error: "Could not end the session." });
    response.clearCookie("olyxee.sid");
    return response.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, requireAccount, async (request, response) => {
  const account = request.appAccount;
  const person = await resolveExternalPerson(account.email);
  const profile = account.profile_data || {};
  return response.json({
    id: person?.external_id || `account-${account.id}`,
    name: profile.displayName || person?.name || account.display_name || account.email,
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
    displayName: typeof request.body.displayName === "string" ? request.body.displayName.trim().slice(0, 160) : undefined,
    avatarUrl: typeof request.body.avatarUrl === "string" ? request.body.avatarUrl.slice(0, 500000) : undefined,
    contactDetails: typeof request.body.contactDetails === "string" ? request.body.contactDetails.slice(0, 100) : undefined,
    githubUsername: typeof request.body.githubUsername === "string" ? request.body.githubUsername.slice(0, 40) : undefined,
  };
  const result = await appPool.query(`
    UPDATE public.ops_users
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
    const [internResult, accountResult, opsAccountResult] = await Promise.all([
      peoplePool.query(`
        SELECT
          id,
          full_name,
          email,
          position,
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
      appPool.query(`
        SELECT email, role, active, profile_data
        FROM public.ops_users
      `),
    ]);
    const opsAccounts = new Map(opsAccountResult.rows.map((account) => [String(account.email).toLowerCase(), account]));

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
      const opsAccount = opsAccounts.get(String(account.email || "").toLowerCase());
      const opsProfile = opsAccount?.profile_data || {};
      return {
        id: `account-${account.id}`,
        name: opsProfile.displayName || account.display_name || account.email,
        email: account.email,
        employmentType: "Employee",
        accessRole: opsAccount?.role || (isManager ? "Manager" : "Member"),
        accountStatus: opsAccount ? (opsAccount.active ? "Active" : "Suspended") : "Pending",
        department: matchingIntern?.department || "Operations",
        position: isManager ? "Department Manager" : "Team Member",
        role: isManager ? "Manager" : "Member",
        avatarUrl: opsProfile.avatarUrl,
        contactDetails: opsProfile.contactDetails,
        githubUsername: opsProfile.githubUsername,
        active: Boolean(account.active),
        hasOpsAccess: Boolean(opsAccount),
        opsRole: opsAccount?.role,
        opsActive: opsAccount?.active,
        source: "Supabase",
      };
    });

    const interns = internResult.rows.map((intern) => {
      const active = String(intern.employment_status || "").toLowerCase() === "active";
      const supervisorKey = String(intern.supervisor_email || intern.supervisor_name || "").toLowerCase();
      const opsAccount = opsAccounts.get(String(intern.email || "").toLowerCase());
      const opsProfile = opsAccount?.profile_data || {};
      return {
        id: `intern-${intern.id}`,
        name: opsProfile.displayName || intern.full_name,
        email: intern.email || "",
        employmentType: "Intern",
        accessRole: opsAccount?.role || "Member",
        accountStatus: opsAccount ? (opsAccount.active ? "Active" : "Suspended") : "Pending",
        department: resolveDepartment(intern).department,
        position: intern.position || "Intern",
        reportsTo: managerIds.get(supervisorKey),
        role: "Intern",
        avatarUrl: opsProfile.avatarUrl,
        contactDetails: opsProfile.contactDetails,
        githubUsername: opsProfile.githubUsername,
        active,
        hasOpsAccess: Boolean(opsAccount),
        opsRole: opsAccount?.role,
        opsActive: opsAccount?.active,
        source: "Supabase",
        employmentStatus: intern.employment_status || "Unknown",
        supervisorName: intern.supervisor_name || "",
        departmentReviewRequired: resolveDepartment(intern).reviewRequired,
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

app.post("/api/people", requireAuth, requireAccount, async (request, response) => {
  if (!peoplePool) return response.status(503).json({ error: "People database is not configured." });
  const appRole = request.appAccount.app_role;
  if (!["Superadmin", "Admin", "Manager"].includes(appRole)) {
    return response.status(403).json({ error: "Forbidden" });
  }

  const name = String(request.body.name || "").trim().slice(0, 160);
  const email = String(request.body.email || "").trim().toLowerCase().slice(0, 254);
  const department = validateDepartment(request.body.department);
  const employmentType = String(request.body.employmentType || "");
  const accessRole = String(request.body.accessRole || "");
  const accountStatus = String(request.body.accountStatus || "");
  let reportsTo = String(request.body.reportsTo || "");
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: "A valid name and email are required." });
  }
  if (!["Employee", "Intern"].includes(employmentType)) {
    return response.status(400).json({ error: "Choose Employee or Intern." });
  }
  if (employmentType === "Intern" && !department) {
    return response.status(400).json({ error: "Choose an official department or Unassigned." });
  }
  if (appRole === "Manager" && employmentType !== "Intern") {
    return response.status(403).json({ error: "Managers can only add interns in their own team." });
  }

  try {
    const duplicate = await peoplePool.query(`
      SELECT 1 FROM public.workspace_accounts WHERE lower(email) = lower($1)
      UNION ALL
      SELECT 1 FROM public.interns WHERE archived_at IS NULL AND lower(email) = lower($1)
      LIMIT 1
    `, [email]);
    if (duplicate.rowCount) return response.status(409).json({ error: "A person with this email already exists." });

    if (employmentType === "Employee") {
      if (!["Superadmin", "Admin"].includes(appRole)) {
        return response.status(403).json({ error: "Only administrators can add employees." });
      }
      const result = await peoplePool.query(`
        INSERT INTO public.workspace_accounts
          (email, display_name, manage_interns, manage_projects, active, created_by)
        VALUES ($1, $2, $3, $3, $4, $5)
        RETURNING id
      `, [email, name, accessRole === "Manager", accountStatus === "Active", request.appAccount.email]);
      return response.status(201).json({ ok: true, id: `account-${result.rows[0].id}` });
    }

    if (appRole === "Manager") {
      const manager = await peoplePool.query(`
        SELECT id, email, display_name
        FROM public.workspace_accounts
        WHERE lower(email) = lower($1) AND active = true
        LIMIT 1
      `, [request.appAccount.email]);
      if (!manager.rowCount) return response.status(403).json({ error: "Your manager record was not found." });
      reportsTo = `account-${manager.rows[0].id}`;
    }

    let supervisorName = "";
    let supervisorEmail = "";
    if (reportsTo) {
      const managerMatch = /^account-(\d+)$/.exec(reportsTo);
      if (!managerMatch) return response.status(400).json({ error: "Invalid manager selection." });
      const manager = await peoplePool.query(`
        SELECT display_name, email
        FROM public.workspace_accounts
        WHERE id = $1 AND active = true
      `, [Number(managerMatch[1])]);
      if (!manager.rowCount) return response.status(400).json({ error: "Selected manager is unavailable." });
      supervisorName = manager.rows[0].display_name || manager.rows[0].email;
      supervisorEmail = manager.rows[0].email;
    }

    const result = await peoplePool.query(`
      INSERT INTO public.interns
        (intern_number, full_name, email, department, employment_status, supervisor_name, supervisor_email)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      `OPS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      name,
      email,
      appRole === "Manager" ? validateDepartment(request.body.department || request.appAccount.department) : department,
      accountStatus === "Active" ? "Active" : "Inactive",
      supervisorName,
      supervisorEmail,
    ]);
    return response.status(201).json({ ok: true, id: `intern-${result.rows[0].id}` });
  } catch (error) {
    console.error("Person creation failed:", error instanceof Error ? error.message : "Unknown error");
    return response.status(500).json({ error: "Could not add this person." });
  }
});

app.patch("/api/people/:id", requireAuth, requireAccount, async (request, response) => {
  if (!peoplePool) return response.status(503).json({ error: "People database is not configured." });
  const appRole = request.appAccount.app_role;
  if (!["Superadmin", "Admin", "Manager"].includes(appRole)) {
    return response.status(403).json({ error: "Forbidden" });
  }

  const match = /^(intern|account)-(\d+)$/.exec(request.params.id);
  if (!match) return response.status(400).json({ error: "Invalid person identifier." });
  const [, kind, rawId] = match;
  const id = Number(rawId);
  const name = String(request.body.name || "").trim().slice(0, 160);
  const email = String(request.body.email || "").trim().toLowerCase().slice(0, 254);
  const department = validateDepartment(request.body.department);
  const accessRole = String(request.body.accessRole || "");
  const accountStatus = String(request.body.accountStatus || "");
  const reportsTo = String(request.body.reportsTo || "");
  if (!name || !email) return response.status(400).json({ error: "Name and email are required." });
  if (kind === "intern" && !department) {
    return response.status(400).json({ error: "Choose an official department or Unassigned." });
  }

  try {
    if (kind === "account") {
      if (!["Superadmin", "Admin"].includes(appRole)) {
        return response.status(403).json({ error: "Only administrators can manage employee accounts." });
      }
      if (!["Manager", "Member"].includes(accessRole)) {
        return response.status(400).json({ error: "Employee access role must be Manager or Member." });
      }
      const result = await peoplePool.query(`
        UPDATE public.workspace_accounts
        SET display_name = $1,
            email = $2,
            manage_interns = $3,
            manage_projects = $3,
            active = $4,
            updated_at = now()
        WHERE id = $5
        RETURNING id
      `, [name, email, accessRole === "Manager", accountStatus === "Active", id]);
      if (!result.rowCount) return response.status(404).json({ error: "Employee account not found." });
      return response.json({ ok: true });
    }

    if (appRole === "Manager") {
      const manager = await peoplePool.query(`
        SELECT email, display_name
        FROM public.workspace_accounts
        WHERE lower(email) = lower($1)
        LIMIT 1
      `, [request.appAccount.email]);
      const managerRecord = manager.rows[0];
      if (!managerRecord) return response.status(403).json({ error: "Manager record was not found." });
      const ownership = await peoplePool.query(`
        SELECT 1
        FROM public.interns
        WHERE id = $1
          AND archived_at IS NULL
          AND (
            lower(supervisor_email) = lower($2)
            OR lower(supervisor_name) = lower($3)
          )
      `, [id, managerRecord.email, managerRecord.display_name]);
      if (!ownership.rowCount) return response.status(403).json({ error: "You can only manage your direct reports." });
    }

    let supervisorName = "";
    let supervisorEmail = "";
    if (reportsTo) {
      const managerMatch = /^account-(\d+)$/.exec(reportsTo);
      if (!managerMatch) return response.status(400).json({ error: "Invalid manager selection." });
      const manager = await peoplePool.query(`
        SELECT display_name, email
        FROM public.workspace_accounts
        WHERE id = $1 AND active = true
      `, [Number(managerMatch[1])]);
      if (!manager.rowCount) return response.status(400).json({ error: "Selected manager is unavailable." });
      supervisorName = manager.rows[0].display_name || manager.rows[0].email;
      supervisorEmail = manager.rows[0].email;
    }

    const result = await peoplePool.query(`
      UPDATE public.interns
      SET full_name = $1,
          email = $2,
          department = $3,
          employment_status = $4,
          supervisor_name = $5,
          supervisor_email = $6,
          updated_at = now()
      WHERE id = $7 AND archived_at IS NULL
      RETURNING id
    `, [name, email, department, accountStatus === "Active" ? "Active" : "Inactive", supervisorName, supervisorEmail, id]);
    if (!result.rowCount) return response.status(404).json({ error: "Intern record not found." });
    return response.json({ ok: true });
  } catch (error) {
    console.error("People update failed:", error instanceof Error ? error.message : "Unknown error");
    if (error?.code === "23505") return response.status(409).json({ error: "That email address is already in use." });
    return response.status(503).json({ error: "Could not update this person." });
  }
});

app.post("/api/people/:id/ops-access", requireAuth, requireAccount, async (request, response) => {
  if (request.appAccount.app_role !== "Superadmin") {
    return response.status(403).json({ error: "Only the Superadmin can create Ops login credentials." });
  }
  if (!peoplePool || !appPool) return response.status(503).json({ error: "Required databases are not configured." });

  const match = /^(intern|account)-(\d+)$/.exec(request.params.id);
  if (!match) return response.status(400).json({ error: "Invalid person identifier." });
  const [, kind, rawId] = match;
  const id = Number(rawId);

  try {
    const personResult = kind === "intern"
      ? await peoplePool.query(`
          SELECT full_name AS name, email, 'Member' AS role
          FROM public.interns
          WHERE id = $1 AND archived_at IS NULL
        `, [id])
      : await peoplePool.query(`
          SELECT display_name AS name, email,
                 CASE WHEN manage_interns OR manage_projects THEN 'Manager' ELSE 'Member' END AS role
          FROM public.workspace_accounts
          WHERE id = $1
        `, [id]);
    const person = personResult.rows[0];
    if (!person) return response.status(404).json({ error: "Person not found." });
    if (!person.email) return response.status(400).json({ error: "Add an email address before creating Ops access." });

    const requestedPassword = String(request.body.password || "");
    const randomBytes = new Uint8Array(9);
    crypto.getRandomValues(randomBytes);
    const temporaryPassword = requestedPassword || `${Buffer.from(randomBytes).toString("base64url")}!7a`;
    if (temporaryPassword.length < 10 || temporaryPassword.length > 128) {
      return response.status(400).json({ error: "The temporary password must be between 10 and 128 characters." });
    }
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const role = person.role === "Manager" ? "Manager" : "Member";
    const accountResult = await appPool.query(`
      INSERT INTO public.ops_users (email, password_hash, display_name, role, active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          display_name = EXCLUDED.display_name,
          updated_at = now()
      RETURNING role
    `, [String(person.email).trim().toLowerCase(), passwordHash, person.name || person.email, role]);

    return response.json({
      name: person.name || person.email,
      email: String(person.email).trim().toLowerCase(),
      temporaryPassword,
      role: accountResult.rows[0].role,
    });
  } catch (error) {
    console.error("Ops access provisioning failed:", error instanceof Error ? error.message : "Unknown error");
    return response.status(503).json({ error: "Could not create Ops access." });
  }
});

app.patch("/api/people/:id/ops-account", requireAuth, requireAccount, async (request, response) => {
  if (request.appAccount.app_role !== "Superadmin") {
    return response.status(403).json({ error: "Only the Superadmin can manage Ops accounts." });
  }
  if (!peoplePool || !appPool) return response.status(503).json({ error: "Required databases are not configured." });
  const match = /^(intern|account)-(\d+)$/.exec(request.params.id);
  if (!match) return response.status(400).json({ error: "Invalid person identifier." });
  const [, kind, rawId] = match;
  const id = Number(rawId);
  const role = String(request.body.role || "");
  const active = request.body.active;
  if (!["Admin", "Manager", "Member"].includes(role) || typeof active !== "boolean") {
    return response.status(400).json({ error: "Choose a valid role and account status." });
  }
  try {
    const personResult = kind === "intern"
      ? await peoplePool.query("SELECT email FROM public.interns WHERE id = $1 AND archived_at IS NULL", [id])
      : await peoplePool.query("SELECT email FROM public.workspace_accounts WHERE id = $1", [id]);
    const email = String(personResult.rows[0]?.email || "").trim().toLowerCase();
    if (!email) return response.status(404).json({ error: "Person or email address not found." });
    if (email === String(request.appAccount.email).toLowerCase()) {
      return response.status(409).json({ error: "You cannot change your own Superadmin access here." });
    }
    const result = await appPool.query(`
      UPDATE public.ops_users
      SET role = $1, active = $2, updated_at = now()
      WHERE lower(email) = lower($3) AND role <> 'Superadmin'
      RETURNING id
    `, [role, active, email]);
    if (!result.rowCount) return response.status(404).json({ error: "This person does not have a manageable Ops account." });
    return response.json({ ok: true });
  } catch (error) {
    console.error("Ops account update failed:", error instanceof Error ? error.message : "Unknown error");
    return response.status(503).json({ error: "Could not update the Ops account." });
  }
});

app.delete("/api/people/:id/ops-account", requireAuth, requireAccount, async (request, response) => {
  if (request.appAccount.app_role !== "Superadmin") {
    return response.status(403).json({ error: "Only the Superadmin can delete Ops accounts." });
  }
  if (!peoplePool || !appPool) return response.status(503).json({ error: "Required databases are not configured." });
  const match = /^(intern|account)-(\d+)$/.exec(request.params.id);
  if (!match) return response.status(400).json({ error: "Invalid person identifier." });
  const [, kind, rawId] = match;
  const id = Number(rawId);
  try {
    const personResult = kind === "intern"
      ? await peoplePool.query("SELECT email FROM public.interns WHERE id = $1 AND archived_at IS NULL", [id])
      : await peoplePool.query("SELECT email FROM public.workspace_accounts WHERE id = $1", [id]);
    const email = String(personResult.rows[0]?.email || "").trim().toLowerCase();
    if (!email) return response.status(404).json({ error: "Person or email address not found." });
    if (email === String(request.appAccount.email).toLowerCase()) {
      return response.status(409).json({ error: "You cannot delete your own Superadmin account." });
    }
    const result = await appPool.query(`
      DELETE FROM public.ops_users
      WHERE lower(email) = lower($1) AND role <> 'Superadmin'
      RETURNING id
    `, [email]);
    if (!result.rowCount) return response.status(404).json({ error: "This person does not have a deletable Ops account." });
    return response.json({ ok: true });
  } catch (error) {
    console.error("Ops account deletion failed:", error instanceof Error ? error.message : "Unknown error");
    return response.status(503).json({ error: "Could not delete the Ops account." });
  }
});

app.get("/api/state/:key", requireAuth, requireAccount, async (request, response) => {
  if (!stateKeys.has(request.params.key)) return response.status(404).json({ error: "Unknown state collection." });
  const result = await appPool.query("SELECT state_value FROM workspace_state WHERE state_key = $1", [request.params.key]);
  if (!result.rows[0]) return response.status(404).json({ error: "State collection has not been initialized." });
  return response.json({ value: result.rows[0].state_value });
});

app.put("/api/state/:key", requireAuth, requireAccount, requireAdmin, async (request, response) => {
  if (!stateKeys.has(request.params.key)) return response.status(404).json({ error: "Unknown state collection." });
  if (request.params.key === "projects" && request.appAccount.app_role !== "Superadmin") {
    const current = await appPool.query("SELECT state_value FROM workspace_state WHERE state_key = 'projects'");
    const existingAssignments = new Map((current.rows[0]?.state_value || []).map((project) => [project.id, JSON.stringify(project.assigneeIds || [])]));
    const assignmentsChanged = (request.body.value || []).some((project) =>
      existingAssignments.has(project.id)
        ? existingAssignments.get(project.id) !== JSON.stringify(project.assigneeIds || [])
        : (project.assigneeIds || []).length > 0
    );
    if (assignmentsChanged) return response.status(403).json({ error: "Only the Superadmin can assign people to projects." });
  }
  await appPool.query(`
    INSERT INTO workspace_state (state_key, state_value, updated_by)
    VALUES ($1, $2::jsonb, $3)
    ON CONFLICT (state_key) DO UPDATE
    SET state_value = EXCLUDED.state_value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `, [request.params.key, JSON.stringify(request.body.value), request.appAccount.id]);
  return response.json({ ok: true });
});

app.patch("/api/projects/:id", requireAuth, requireAccount, requireAdmin, async (request, response) => {
  const githubUrl = String(request.body.githubUrl || "").trim();
  if (!/^https?:\/\/(www\.)?github\.com\/.+/i.test(githubUrl)) return response.status(400).json({ error: "Enter a valid GitHub repository URL." });
  const result = await appPool.query("SELECT state_value FROM workspace_state WHERE state_key = 'projects'");
  const projects = result.rows[0]?.state_value || [];
  const project = projects.find((item) => item.id === request.params.id);
  if (!project) return response.status(404).json({ error: "Project not found." });
  project.githubUrl = githubUrl;
  if (request.appAccount.app_role === "Superadmin") {
    project.assigneeIds = Array.isArray(request.body.assigneeIds) ? [...new Set(request.body.assigneeIds.map(String))] : project.assigneeIds;
  }
  await appPool.query(`
    UPDATE workspace_state
    SET state_value = $1::jsonb, updated_by = $2, updated_at = now()
    WHERE state_key = 'projects'
  `, [JSON.stringify(projects), request.appAccount.id]);
  return response.json({ project });
});

app.post("/api/projects/:id/resources", requireAuth, requireAccount, async (request, response) => {
  const { name, kind, url } = request.body || {};
  if (!name || !["document", "image"].includes(kind) || !url) return response.status(400).json({ error: "A valid uploaded resource is required." });
  const result = await appPool.query("SELECT state_value FROM workspace_state WHERE state_key = 'projects'");
  const projects = result.rows[0]?.state_value || [];
  const project = projects.find((item) => item.id === request.params.id);
  if (!project) return response.status(404).json({ error: "Project not found." });
  const resource = { id: crypto.randomUUID(), name: String(name).slice(0, 255), kind, url };
  project.resources = [...(project.resources || []), resource];
  await appPool.query(`
    UPDATE workspace_state
    SET state_value = $1::jsonb, updated_by = $2, updated_at = now()
    WHERE state_key = 'projects'
  `, [JSON.stringify(projects), request.appAccount.id]);
  return response.status(201).json({ resource });
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
  const externalPerson = await resolveExternalPerson(request.appAccount.email);
  const result = await appPool.query(`
    INSERT INTO public.app_assets (owner_user_id, external_person_id, asset_kind, storage_path, original_filename, mime_type, byte_size)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [request.appAccount.id, externalPerson?.external_id || null, kind, objectKey, request.file.originalname, request.file.mimetype, request.file.size]);
  return response.status(201).json({ id: result.rows[0].id, url: `/api/assets/${result.rows[0].id}` });
});

app.get("/api/assets/:id", requireAuth, requireAccount, async (request, response) => {
  const result = await appPool.query(`
    SELECT storage_path, mime_type, original_filename
    FROM public.app_assets
    WHERE id = $1
      AND $2 IS NOT NULL
  `, [request.params.id, request.appAccount.id]);
  const asset = result.rows[0];
  if (!asset) return response.status(404).json({ error: "Asset not found." });
  response.type(asset.mime_type);
  response.set("Cache-Control", "private, max-age=3600");
  response.set("Content-Disposition", `inline; filename="${asset.original_filename.replace(/"/g, "")}"`);
  const objectStorage = new ObjectStorageClient();
  return objectStorage.downloadAsStream(asset.storage_path).pipe(response);
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

if (!process.env.VERCEL) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Olyxee Ops listening on port ${port}`);
  });
}

export default app;
