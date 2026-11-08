// Temporary cover: someone stands in for a person who is away, and everything can be handed back.
//
// Starting cover moves the away person's leadership and direct reports to the stand-in using the same audited,
// version-checked changes as any other reorganisation, and remembers exactly what moved (org_cover.restore).
// Ending it moves the same things back. The away person stays on the chart throughout.

import { OrgError } from "./plan.mjs";
import { applyChange, getChart, getVersion } from "./store.mjs";

const label = (chart, ref) => chart.nodes[ref]?.name || ref;

export async function startCover(db, loadPeople, { actor, coveringRef, coveredRef, note = "" }) {
  const chart = await getChart(db, loadPeople);
  const covering = chart.nodes[coveringRef];
  const covered = chart.nodes[coveredRef];
  if (!covering || !covered) throw new OrgError("Both people must be on the chart.", 404, "not_found");
  if (coveringRef === coveredRef) throw new OrgError("A person cannot cover for themselves.");
  if (covering.coveredBy || covered.covering || covering.covering || covered.coveredBy) {
    throw new OrgError("One of these people is already part of a cover. End it first.", 409, "cover_active");
  }
  const restore = {
    directReports: covered.directReports.filter((ref) => ref !== coveringRef),
    led: covered.leadsDepartments,
  };
  const reason = `Interim cover for ${covered.name}${note ? `: ${note}` : ""}`;
  const step = async (input) => applyChange(db, loadPeople, { actor, input: { ...input, reason }, expectedVersion: await getVersion(db), kind: "cover.change" });

  // The stand-in leads what the away person led (this replaces the leader), then takes over the direct reports.
  if (restore.led.length) await step({ subjectRef: coveringRef, leadOfAdd: restore.led });
  for (const ref of restore.directReports) await step({ subjectRef: ref, reportsTo: coveringRef });

  await db.query(
    `INSERT INTO public.org_cover (covering_ref, covered_ref, note, restore, started_by) VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [coveringRef, coveredRef, note, JSON.stringify(restore), actor?.userId ?? null],
  );
  return { restore, summary: `${label(chart, coveringRef)} now covers for ${covered.name}.` };
}

export async function endCover(db, loadPeople, { actor, coveredRef }) {
  const row = (await db.query("SELECT * FROM public.org_cover WHERE covered_ref = $1 AND ended_at IS NULL", [coveredRef])).rows[0];
  if (!row) throw new OrgError("There is no active cover for this person.", 404, "not_found");
  const chart = await getChart(db, loadPeople);
  const reason = `${label(chart, coveredRef)} is back: interim cover by ${label(chart, row.covering_ref)} ended`;
  const step = async (input) => applyChange(db, loadPeople, { actor, input: { ...input, reason }, expectedVersion: await getVersion(db), kind: "cover.change" });
  const restore = row.restore || {};

  if ((restore.led || []).length) await step({ subjectRef: coveredRef, leadOfAdd: restore.led });
  for (const ref of restore.directReports || []) {
    // Only hand back people who still report to the stand-in (someone may have been moved on since).
    if (chart.nodes[ref]?.reportsTo === row.covering_ref) await step({ subjectRef: ref, reportsTo: coveredRef });
  }
  await db.query("UPDATE public.org_cover SET ended_at = now(), ended_by = $2 WHERE id = $1", [row.id, actor?.userId ?? null]);
  return { handedBack: restore };
}
