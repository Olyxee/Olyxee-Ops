import assert from "node:assert/strict";
import test from "node:test";
import {
  buildObjectiveBlockerNotices,
  canonicalNoticeUserId,
} from "./objective-notifications.mjs";

test("staff-linked reporting accounts receive notices under their external person ID", () => {
  assert.equal(
    canonicalNoticeUserId({ id: 42 }, { external_id: "staff-manager-7" }),
    "staff-manager-7",
  );
});

test("unlinked Superadmin fallback receives notices under the workspace account ID", () => {
  const recipientUserId = canonicalNoticeUserId({ id: 9 }, null);
  const notices = buildObjectiveBlockerNotices({
    objectives: [{ title: "Ship weekly report", blockerMessage: "Waiting for finance" }],
    recipientUserId,
    actorName: "Operations Manager",
    time: "2026-09-23T08:00:00.000Z",
    randomId: () => "notice-1",
  });

  assert.equal(recipientUserId, "account-9");
  assert.deepEqual(notices, [{
    id: "notice-1",
    userId: "account-9",
    title: "Weekly objective blocked",
    body: "Operations Manager reported a blocker on Ship weekly report: Waiting for finance",
    read: false,
    time: "2026-09-23T08:00:00.000Z",
  }]);
});