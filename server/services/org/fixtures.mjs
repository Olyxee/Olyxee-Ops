import { PGlite } from "@electric-sql/pglite";
import { ORG_SCHEMA_SQL } from "./schema.mjs";
import { fromPglite } from "./store.mjs";

export const person = (ref, name, extra = {}) => ({
  ref, name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`,
  employmentType: ref.startsWith("intern-") ? "Intern" : "Employee", active: true, status: "Active", ...extra,
});

export const PEOPLE = [
  person("account-1", "Ada Chief"),
  person("account-2", "Bo Vice"),
  person("account-3", "Cy Lead"),
  person("account-4", "Di Dev"),
  person("account-5", "Ed Gone", { active: false, status: "Suspended" }),
  person("intern-1", "Ivy Intern"),
  person("intern-2", "Jo Alumnus", { active: false, status: "Completed" }),
];
export const loadPeople = async () => PEOPLE;

export async function makeDb() {
  const pglite = new PGlite();
  await pglite.exec(`
    CREATE TABLE public.ops_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, display_name text NOT NULL,
      role text NOT NULL DEFAULT 'Member', active boolean NOT NULL DEFAULT true);
  `);
  await pglite.exec(ORG_SCHEMA_SQL);
  const db = fromPglite(pglite);
  const user = async (name, role = "Member") =>
    (await db.query("INSERT INTO public.ops_users (email, display_name, role) VALUES ($1,$2,$3) RETURNING id", [`${name}@example.test`, name, role])).rows[0].id;
  const dept = async (name) => (await db.query("INSERT INTO public.org_departments (name) VALUES ($1) RETURNING id", [name])).rows[0].id;
  return { pglite, db, user, dept };
}
