import pg from "pg";
import {
  OFFICIAL_DEPARTMENTS,
  UNASSIGNED_DEPARTMENT,
  resolveDepartment,
} from "../shared/departments.mjs";

if (!process.env.EXTERNAL_DATABASE_URL) {
  throw new Error("EXTERNAL_DATABASE_URL is required to backfill intern departments.");
}

const pool = new pg.Pool({
  connectionString: process.env.EXTERNAL_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const result = await client.query(`
    SELECT *
    FROM public.interns
    WHERE archived_at IS NULL
    ORDER BY id
    FOR UPDATE
  `);

  let changed = 0;
  let skipped = 0;
  let reviewRequired = 0;

  for (const intern of result.rows) {
    const resolution = resolveDepartment({
      department: intern.department,
      position: intern.position,
      role: intern.role,
      title: intern.title,
      skills: intern.skills,
      responsibilities: intern.responsibilities,
      currentResponsibilities: intern.current_responsibilities,
      notes: intern.notes,
    });

    if (!resolution.changed) {
      skipped += 1;
      if (resolution.reviewRequired) reviewRequired += 1;
      continue;
    }

    await client.query(`
      UPDATE public.interns
      SET department = $1, updated_at = now()
      WHERE id = $2
        AND department IS NOT DISTINCT FROM $3
    `, [resolution.department, intern.id, intern.department]);
    changed += 1;
    if (resolution.reviewRequired) reviewRequired += 1;
    console.log(JSON.stringify({
      internId: intern.id,
      name: intern.full_name,
      previousDepartment: intern.department || null,
      newDepartment: resolution.department,
      matchedKeywords: resolution.matchedKeywords,
      reviewRequired: resolution.reviewRequired,
    }));
  }

  const verification = await client.query(`
    SELECT count(*)::int AS invalid_count
    FROM public.interns
    WHERE archived_at IS NULL
      AND lower(coalesce(employment_status, '')) = 'active'
      AND department <> ALL($1::text[])
  `, [[...OFFICIAL_DEPARTMENTS, UNASSIGNED_DEPARTMENT]]);
  if (verification.rows[0].invalid_count !== 0) {
    throw new Error(`${verification.rows[0].invalid_count} active interns still have invalid departments.`);
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({ changed, skipped, reviewRequired, activeInvalidDepartments: 0 }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}