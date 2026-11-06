// One-time, operator-run grant of organisational capabilities (CEO bootstrap and break-glass recovery).
// There is deliberately no web path for a Superadmin to give itself business approval authority.
//
//   node --env-file=.env scripts/org-bootstrap.mjs --list
//   node --env-file=.env scripts/org-bootstrap.mjs --email someone@company.com                (shows what would be granted)
//   node --env-file=.env scripts/org-bootstrap.mjs --email someone@company.com --apply        (grants all organisational capabilities)
//   node --env-file=.env scripts/org-bootstrap.mjs --email someone@company.com --capability org.view_all --apply
//
// The email is only used to look up the account once; authority is stored against the account id.
import { ORG_CAPABILITIES } from "../server/services/org/schema.mjs";
import { connectOps } from "../server/services/org/connect.mjs";
import { fromPgPool, grantCapability, listCapabilities } from "../server/services/org/store.mjs";

const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const ops = connectOps();
const db = fromPgPool(ops);

try {
  if (args.includes("--list")) {
    console.table((await listCapabilities(db)).map((row) => ({ person: row.display_name, capability: row.capability, granted: row.granted_at, by: row.granted_by_name || "bootstrap" })));
  } else {
    const email = String(value("--email") || "").trim().toLowerCase();
    if (!email) throw new Error("--email is required.");
    const account = (await ops.query("SELECT id, display_name, role, active FROM public.ops_users WHERE lower(email) = $1", [email])).rows[0];
    if (!account?.active) throw new Error("No active Ops account found for that email.");
    const only = value("--capability");
    const capabilities = only ? [only] : [...ORG_CAPABILITIES];
    console.log(`Account: ${account.display_name} (Ops role: ${account.role}, unchanged)`);
    console.log(`Capabilities: ${capabilities.join(", ")}`);
    if (!args.includes("--apply")) {
      console.log("DRY RUN: nothing granted. Add --apply to grant.");
    } else {
      for (const capability of capabilities) {
        const result = await grantCapability(db, { actor: null, userId: account.id, capability, via: "bootstrap" });
        console.log(`${capability}: ${result.granted ? "granted" : "already held"}`);
      }
    }
  }
} finally {
  await ops.end();
}
