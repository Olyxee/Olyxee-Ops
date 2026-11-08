import assert from "node:assert/strict";
import test from "node:test";
import { availabilitySlug, isOutOfOffice } from "./availability.mjs";

const TODAY = "2026-11-10";

test("out of office is in force until the return date has passed, and wins over everything else", () => {
  assert.equal(isOutOfOffice({ availability: "Out of office" }, TODAY), true);                       // no date: until they change it
  assert.equal(isOutOfOffice({ availability: "Out of office", outUntil: "2026-11-12" }, TODAY), true);
  assert.equal(isOutOfOffice({ availability: "Out of office", outUntil: TODAY }, TODAY), true);       // the return day itself still counts as out
  assert.equal(isOutOfOffice({ availability: "Out of office", outUntil: "2026-11-09" }, TODAY), false); // lapsed by itself
});

test("other statuses and missing data are never out of office", () => {
  assert.equal(isOutOfOffice({ availability: "Busy", outUntil: "2026-12-01" }, TODAY), false);
  assert.equal(isOutOfOffice({ availability: "Available" }, TODAY), false);
  assert.equal(isOutOfOffice(undefined, TODAY), false);
  assert.equal(isOutOfOffice(null, TODAY), false);
});

test("the CSS class name is safe", () => {
  assert.equal(availabilitySlug("Out of office"), "out-of-office");
  assert.equal(availabilitySlug("Available"), "available");
  assert.equal(availabilitySlug(undefined), "offline");
});
