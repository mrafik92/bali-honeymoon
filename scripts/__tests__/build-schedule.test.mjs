// Test the scheduler against the Bali fixture. Pure Node, no test framework —
// just `assert` from node:assert and a tiny runner. Run with:
//   node scripts/__tests__/build-schedule.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSchedule } from "../build-schedule.mjs";

const spec = JSON.parse(readFileSync(new URL("./fixtures/bali-spec.json", import.meta.url)));
const days = buildSchedule(spec);

function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

test("produces 14 days for a 14-day range", () => {
  assert.equal(days.length, 14);
});

test("days are numbered 1..14 in order", () => {
  for (let i = 0; i < days.length; i++) assert.equal(days[i].n, i + 1);
});

test("day 1 is transfer", () => {
  assert.equal(days[0].status, "transfer");
});

test("last day is transfer", () => {
  assert.equal(days[13].status, "transfer");
});

test("inter-region boundary days are transfer", () => {
  const transfers = days.filter(d => d.status === "transfer").map(d => d.n);
  assert.ok(transfers.includes(1), "day 1 transfer");
  assert.ok(transfers.includes(14), "day 14 transfer");
  assert.ok(transfers.length >= 3, `expected ≥3 transfer days, got ${transfers.length}`);
});

test("day after every transfer is rest (or another transfer)", () => {
  for (let i = 0; i < days.length - 1; i++) {
    if (days[i].status === "transfer") {
      assert.match(days[i + 1].status, /^(rest|transfer)$/, `day ${i + 2} after transfer is ${days[i + 1].status}`);
    }
  }
});

test("no two consecutive active days", () => {
  for (let i = 0; i < days.length - 1; i++) {
    if (days[i].status === "active" && days[i + 1].status === "active") {
      throw new Error(`days ${i + 1} and ${i + 2} are both active`);
    }
  }
});

test("every active day has an activityId", () => {
  for (const d of days) if (d.status === "active") assert.ok(d.activityId, `day ${d.n} active but no activityId`);
});

test("every active day's activity is within drive cap from that day's hotel", () => {
  for (const d of days) {
    if (d.status !== "active") continue;
    const hotel = spec.hotels[d.region];
    const act = spec.activities[d.region].find(a => a.id === d.activityId);
    assert.ok(act, `unknown activityId ${d.activityId} on day ${d.n}`);
    assert.ok(act.drive[hotel] <= spec.driveCapMinutes, `day ${d.n}: drive ${act.drive[hotel]} > cap ${spec.driveCapMinutes}`);
  }
});

test("no activity reused within a region", () => {
  const byRegion = {};
  for (const d of days) {
    if (!d.activityId) continue;
    byRegion[d.region] = byRegion[d.region] || new Set();
    if (byRegion[d.region].has(d.activityId)) throw new Error(`activity ${d.activityId} reused in ${d.region}`);
    byRegion[d.region].add(d.activityId);
  }
});

test("every day has a dinnerId", () => {
  for (const d of days) assert.ok(d.dinnerId, `day ${d.n} has no dinnerId`);
});

test("splurge count is within ±1 of requested", () => {
  const splurges = days.filter(d => {
    const r = spec.restaurants[d.region].find(x => x.id === d.dinnerId);
    return r?.tier === "splurge";
  }).length;
  assert.ok(Math.abs(splurges - spec.splurgeCount) <= 1, `splurges=${splurges}, requested=${spec.splurgeCount}`);
});

test("no splurge on a transfer day", () => {
  for (const d of days) {
    if (d.status !== "transfer") continue;
    const r = spec.restaurants[d.region]?.find(x => x.id === d.dinnerId);
    if (r?.tier === "splurge") throw new Error(`day ${d.n} is transfer but dinner is splurge`);
  }
});

test("no back-to-back splurges", () => {
  for (let i = 0; i < days.length - 1; i++) {
    const a = spec.restaurants[days[i].region]?.find(x => x.id === days[i].dinnerId);
    const b = spec.restaurants[days[i + 1].region]?.find(x => x.id === days[i + 1].dinnerId);
    if (a?.tier === "splurge" && b?.tier === "splurge") throw new Error(`splurges back-to-back: days ${i + 1} & ${i + 2}`);
  }
});

test("rest days have a restSuggestion", () => {
  for (const d of days) if (d.status === "rest") assert.ok(d.restSuggestion, `day ${d.n} rest but no suggestion`);
});

test("identical seed produces identical output", () => {
  const a = buildSchedule(spec);
  const b = buildSchedule(spec);
  assert.deepEqual(a, b);
});

test("different seed produces different output", () => {
  const a = buildSchedule(spec);
  const b = buildSchedule({ ...spec, seed: 999 });
  assert.notDeepEqual(a, b);
});
