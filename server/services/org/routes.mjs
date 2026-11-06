import { OrgError } from "./plan.mjs";
import {
  applyChange, createPosition, createProposal, decideProposal, getChart, getUserCapabilities, getVersion,
  grantCapability, holds, listCapabilities, listHistory, listPositions, listProposals, previewChange,
  revokeCapability, withdrawProposal,
} from "./store.mjs";
import { createFunction, createInitiative, listInitiatives, updateFunction, updateInitiative } from "./structure.mjs";

/**
 * Registers /api/org/*. Authority comes only from server-side capability grants (org_capabilities),
 * never from an email address, a job title, a Superadmin role or the reporting hierarchy.
 */
export function registerOrgRoutes(app, { db, loadPeople, requireAuth, requireAccount, isEnabled, notify = async () => {} }) {
  const ANY_VIEW = ["org.view_all", "org.propose", "org.approve", "org.delegate"];

  const guard = (handler, { any = [], enabledOnly = true } = {}) => async (request, response) => {
    try {
      if (enabledOnly && !isEnabled()) return response.status(503).json({ error: "The organisation module is not enabled.", code: "disabled" });
      const account = request.appAccount;
      const actor = { userId: account.id, name: account.display_name || account.email };
      const capabilities = await getUserCapabilities(db, account.id);
      if (any.length && !any.some((capability) => holds(capabilities, capability))) {
        return response.status(403).json({ error: "You do not have permission to do that.", code: "forbidden" });
      }
      return await handler({ request, response, actor, capabilities });
    } catch (error) {
      if (error instanceof OrgError) return response.status(error.status).json({ error: error.message, code: error.code });
      console.error("Organisation request failed:", error instanceof Error ? error.message : "Unknown error");
      return response.status(500).json({ error: "The organisation request could not be completed." });
    }
  };
  const base = [requireAuth, requireAccount];

  app.get("/api/org/me", ...base, guard(async ({ response, capabilities }) => {
    response.json({ enabled: isEnabled(), capabilities, version: await getVersion(db) });
  }, { enabledOnly: false }));

  app.get("/api/org/chart", ...base, guard(async ({ request, response }) => {
    const asOf = request.query.asOf ? new Date(String(request.query.asOf)) : null;
    if (asOf && Number.isNaN(asOf.getTime())) throw new OrgError("asOf must be a valid date.");
    response.json(await getChart(db, loadPeople, { asOf, includeAlumni: request.query.alumni === "1" }));
  }, { any: ANY_VIEW }));

  app.get("/api/org/history", ...base, guard(async ({ request, response }) => {
    response.json({ history: await listHistory(db, { personRef: request.query.person ? String(request.query.person) : null, limit: request.query.limit }) });
  }, { any: ANY_VIEW }));

  app.get("/api/org/positions", ...base, guard(async ({ response }) => response.json({ positions: await listPositions(db) }), { any: ANY_VIEW }));
  app.post("/api/org/positions", ...base, guard(async ({ request, response }) =>
    response.status(201).json({ position: await createPosition(db, request.body || {}) }), { any: ["org.approve"] }));

  // Functions (departments), specialisations and cross-functional initiatives. Structure edits need org.approve.
  app.post("/api/org/functions", ...base, guard(async ({ request, response, actor }) =>
    response.status(201).json(await createFunction(db, { ...(request.body || {}), actor })), { any: ["org.approve"] }));
  app.patch("/api/org/functions/:id", ...base, guard(async ({ request, response, actor }) =>
    response.json(await updateFunction(db, { ...(request.body || {}), id: request.params.id, actor })), { any: ["org.approve"] }));
  app.get("/api/org/initiatives", ...base, guard(async ({ request, response }) =>
    response.json({ initiatives: await listInitiatives(db, { includeInactive: request.query.all === "1" }) }), { any: ANY_VIEW }));
  app.post("/api/org/initiatives", ...base, guard(async ({ request, response, actor }) =>
    response.status(201).json(await createInitiative(db, loadPeople, { ...(request.body || {}), actor })), { any: ["org.approve"] }));
  app.patch("/api/org/initiatives/:id", ...base, guard(async ({ request, response, actor }) =>
    response.json(await updateInitiative(db, loadPeople, { ...(request.body || {}), id: request.params.id, actor })), { any: ["org.approve"] }));

  app.post("/api/org/changes/preview", ...base, guard(async ({ request, response }) =>
    response.json(await previewChange(db, loadPeople, request.body?.input)), { any: ["org.approve", "org.propose"] }));

  app.post("/api/org/changes", ...base, guard(async ({ request, response, actor }) => {
    const result = await applyChange(db, loadPeople, { actor, input: request.body?.input, expectedVersion: request.body?.expectedVersion });
    await notify({ result, actor }).catch((error) => console.error("Organisation notification failed:", error instanceof Error ? error.message : "Unknown error"));
    response.status(201).json(result);
  }, { any: ["org.approve"] }));

  app.get("/api/org/proposals", ...base, guard(async ({ request, response, actor, capabilities }) => {
    const all = holds(capabilities, "org.approve");
    response.json({ proposals: await listProposals(db, { status: request.query.status ? String(request.query.status) : null, proposedBy: all ? null : actor.userId }) });
  }, { any: ["org.approve", "org.propose"] }));

  app.post("/api/org/proposals", ...base, guard(async ({ request, response, actor }) =>
    response.status(201).json(await createProposal(db, loadPeople, { actor, input: request.body?.input })), { any: ["org.propose", "org.approve"] }));

  app.post("/api/org/proposals/:id/decision", ...base, guard(async ({ request, response, actor }) => {
    const result = await decideProposal(db, loadPeople, {
      actor, proposalId: request.params.id, decision: request.body?.decision, note: request.body?.note, acknowledgeChanges: request.body?.acknowledgeChanges === true,
    });
    if (result.status === "approved") await notify({ result, actor }).catch((error) => console.error("Organisation notification failed:", error instanceof Error ? error.message : "Unknown error"));
    response.json(result);
  }, { any: ["org.approve"] }));

  app.post("/api/org/proposals/:id/withdraw", ...base, guard(async ({ request, response, actor }) =>
    response.json(await withdrawProposal(db, { actor, proposalId: request.params.id })), { any: ["org.propose", "org.approve"] }));

  app.get("/api/org/capabilities", ...base, guard(async ({ response }) => response.json({ capabilities: await listCapabilities(db) }), { any: ["org.delegate"] }));
  app.post("/api/org/capabilities", ...base, guard(async ({ request, response, actor }) =>
    response.status(201).json(await grantCapability(db, { actor, userId: request.body?.userId, capability: request.body?.capability, scopeDepartmentId: request.body?.scopeDepartmentId || null })),
  { any: ["org.delegate"] }));
  app.delete("/api/org/capabilities", ...base, guard(async ({ request, response, actor }) =>
    response.json(await revokeCapability(db, { actor, userId: request.body?.userId, capability: request.body?.capability, scopeDepartmentId: request.body?.scopeDepartmentId || null })),
  { any: ["org.delegate"] }));

  app.get("/api/org/accounts", ...base, guard(async ({ response }) => {
    const { rows } = await db.query("SELECT id, display_name FROM public.ops_users WHERE active = true ORDER BY display_name");
    response.json({ accounts: rows });
  }, { any: ["org.delegate"] }));

  app.get("/api/org/integrity", ...base, guard(async ({ response }) => {
    const chart = await getChart(db, loadPeople, { includeAlumni: false });
    response.json({ version: chart.version, issues: chart.issues, counts: chart.counts });
  }, { any: ["org.view_all", "org.approve"] }));
}
