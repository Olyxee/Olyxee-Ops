// Read-only access to the People database. The org model never writes to it.

export function createPeopleLoader(peoplePool) {
  return async function loadPeople() {
    if (!peoplePool) throw new Error("People database is not configured.");
    const [interns, accounts] = await Promise.all([
      peoplePool.query(`SELECT id, full_name, email, employment_status FROM public.interns WHERE archived_at IS NULL`),
      peoplePool.query(`SELECT id, display_name, email, active FROM public.workspace_accounts`),
    ]);
    return [
      ...accounts.rows.map((row) => ({
        ref: `account-${row.id}`,
        name: String(row.display_name || row.email || "").replace(/\s+/g, " ").trim(),
        email: String(row.email || "").toLowerCase(),
        employmentType: "Employee",
        active: Boolean(row.active),
        status: row.active ? "Active" : "Suspended",
      })),
      ...interns.rows.map((row) => ({
        ref: `intern-${row.id}`,
        name: String(row.full_name || row.email || "").replace(/\s+/g, " ").trim(),
        email: String(row.email || "").toLowerCase(),
        employmentType: "Intern",
        active: String(row.employment_status || "").toLowerCase() === "active",
        status: row.employment_status || "Unknown",
      })),
    ];
  };
}

/** Legacy reporting columns, used only for the one-time seed and the reconciliation report. */
export async function readLegacyRelations(peoplePool) {
  const [accounts, interns] = await Promise.all([
    peoplePool.query(`SELECT id, display_name, email, department, active, manage_interns, manage_projects, reports_to_account_id FROM public.workspace_accounts ORDER BY id`),
    peoplePool.query(`SELECT id, full_name, email, position, department, employment_status, completion_date, supervisor_account_id, supervisor_email, supervisor_name FROM public.interns WHERE archived_at IS NULL ORDER BY id`),
  ]);
  return { accounts: accounts.rows, interns: interns.rows };
}
