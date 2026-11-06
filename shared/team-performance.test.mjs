import assert from "node:assert/strict";
import test from "node:test";
import { teamWeeklyPerformance } from "./team-performance.mjs";

const NOW = new Date("2026-11-12T12:00:00").getTime();                 // Thursday; this week started Monday 9 Nov
const teams = [
  { name: "AI Research & Development", leaderName: "Emmanuel", leaderRef: "account-2", memberRefs: ["intern-14"], description: "AI" },
  { name: "Data Engineering", leaderName: "Mosa", leaderRef: "account-3", memberRefs: ["intern-34"] },
  { name: "Software Engineering", leaderName: "Zaid", leaderRef: "intern-31", memberRefs: ["intern-35"] },
];
const done = (assignee, completedAt, over = {}) => ({ id: `${assignee}-${completedAt}`, status: "Completed", assigneeIds: [assignee], completedAt, ...over });

test("each team is counted from the work assigned to its people, in the order given", () => {
  const tasks = [
    done("intern-14", "2026-11-10T09:00:00"),         // AI R&D, this week
    done("account-2", "2026-11-11T09:00:00"),         // AI R&D leader, this week
    done("intern-34", "2026-11-09T10:00:00"),         // Data Engineering, this week
    done("intern-35", "2026-11-03T10:00:00"),         // Software Engineering, last week
    done("intern-31", "2026-11-12T08:00:00"),         // Software Engineering leader, this week
  ];
  const rows = teamWeeklyPerformance(teams, tasks, NOW);
  assert.deepEqual(rows.map((row) => row.department[0]), ["AI Research & Development", "Data Engineering", "Software Engineering"]);
  assert.deepEqual(rows.map((row) => [row.currentCompleted, row.previousCompleted, row.change]), [[2, 0, 2], [1, 0, 1], [1, 1, 0]]);
  assert.deepEqual(rows[2].department, ["Software Engineering", "Zaid", ""]);
});

test("only completed work counts, and unrelated or unassigned work is ignored", () => {
  const tasks = [
    done("intern-14", "2026-11-10T09:00:00", { status: "In Progress" }),
    done("intern-14", undefined),
    done("someone-else", "2026-11-10T09:00:00"),
    { id: "x", status: "Completed", completedAt: "2026-11-10T09:00:00" },
    done("intern-14", "2026-10-01T09:00:00"),          // long ago: neither this week nor last
  ];
  const rows = teamWeeklyPerformance(teams, tasks, NOW);
  assert.deepEqual(rows.map((row) => row.currentCompleted + row.previousCompleted), [0, 0, 0]);
});

test("last week is compared up to the same point in the week", () => {
  const sameMoment = new Date("2026-11-05T11:00:00").toISOString();       // last Thursday, before 12:00: counts
  const later = new Date("2026-11-05T15:00:00").toISOString();            // last Thursday, after 12:00: not yet at this point
  const rows = teamWeeklyPerformance(teams, [done("intern-34", sameMoment), done("intern-34", later)], NOW);
  assert.equal(rows[1].previousCompleted, 1);
});

test("a task shared by two teams counts for each of them; a team with no one assigned gets zeros, not made-up numbers", () => {
  const shared = { id: "s", status: "Completed", assigneeIds: ["intern-14", "intern-34"], completedAt: "2026-11-10T09:00:00" };
  const rows = teamWeeklyPerformance(teams, [shared], NOW);
  assert.deepEqual(rows.map((row) => row.currentCompleted), [1, 1, 0]);
  assert.deepEqual(teamWeeklyPerformance([{ name: "Empty team", memberRefs: [] }], [shared], NOW)[0].currentCompleted, 0);
});
