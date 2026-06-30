#!/usr/bin/env node
// Deterministic 14-day trip scheduler. Pure function buildSchedule(spec) → Day[].
// CLI: node scripts/build-schedule.mjs <spec.json>  → prints day plan JSON to stdout.

import { readFileSync } from "node:fs";

// ── seeded PRNG ──────────────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── date helpers ─────────────────────────────────────────────────────────
function daysBetween(start, end) {
  const a = Date.parse(start), b = Date.parse(end);
  return Math.round((b - a) / 86400000) + 1; // inclusive
}
function addDays(start, n) {
  const d = new Date(Date.parse(start));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── core ─────────────────────────────────────────────────────────────────
export function buildSchedule(spec) {
  const N = daysBetween(spec.startDate, spec.endDate);
  if (N < 1) throw new Error("endDate before startDate");
  const rng = mulberry32(spec.seed);

  // Step 1: region per day, proportional to nightsRange[0]
  const totalNights = spec.regions.reduce((s, r) => s + r.nightsRange[0], 0);
  const dayRegion = new Array(N);
  let cursor = 0;
  for (let i = 0; i < spec.regions.length; i++) {
    const r = spec.regions[i];
    const isLast = i === spec.regions.length - 1;
    const count = isLast ? N - cursor : Math.max(1, Math.round((r.nightsRange[0] / totalNights) * N));
    for (let k = 0; k < count && cursor + k < N; k++) dayRegion[cursor + k] = r.id;
    cursor += count;
  }
  while (cursor < N) { dayRegion[cursor] = spec.regions[spec.regions.length - 1].id; cursor++; }

  // Step 2: status per day
  const status = new Array(N).fill("tbd");
  status[0] = "transfer";
  status[N - 1] = "transfer";
  // Region boundaries: when day i and day i+1 are different regions, day i+1 = transfer (arrival in new region)
  for (let i = 0; i < N - 1; i++) {
    if (dayRegion[i] !== dayRegion[i + 1]) status[i + 1] = "transfer";
  }
  // Day after every transfer = rest
  for (let i = 0; i < N - 1; i++) {
    if (status[i] === "transfer" && status[i + 1] === "tbd") status[i + 1] = "rest";
  }
  // Remaining: alternate active/rest starting with active
  let toggle = "active";
  for (let i = 0; i < N; i++) {
    if (status[i] !== "tbd") continue;
    // If previous day was active, this must be rest
    if (i > 0 && status[i - 1] === "active") { status[i] = "rest"; toggle = "active"; continue; }
    status[i] = toggle;
    toggle = toggle === "active" ? "rest" : "active";
  }
  // Sub-4-day trips: skip alternation, all middle days active
  if (N < 4) {
    for (let i = 1; i < N - 1; i++) status[i] = "active";
  }

  // Step 3: assign activities per region
  const activityByDay = new Array(N).fill(null);
  for (const region of spec.regions) {
    const hotel = spec.hotels[region.id];
    const eligible = (spec.activities[region.id] || [])
      .filter(a => (a.drive[hotel] ?? Infinity) <= spec.driveCapMinutes)
      .slice()
      .sort((a, b) => b.score - a.score);
    // Shuffle ties within equal-score groups using seeded RNG
    let i = 0;
    while (i < eligible.length) {
      let j = i;
      while (j < eligible.length && eligible[j].score === eligible[i].score) j++;
      if (j - i > 1) {
        const group = eligible.slice(i, j);
        shuffleInPlace(group, rng);
        for (let k = 0; k < group.length; k++) eligible[i + k] = group[k];
      }
      i = j;
    }
    const pool = eligible.map(a => a.id);
    let pi = 0;
    for (let d = 0; d < N; d++) {
      if (dayRegion[d] !== region.id) continue;
      if (status[d] !== "active") continue;
      if (pi >= pool.length) { status[d] = "rest"; continue; }
      activityByDay[d] = pool[pi++];
    }
  }

  // Step 4: assign dinners
  const dinnerByDay = new Array(N).fill(null);

  // Find candidate splurge days: last ACTIVE day in each region (with neighbors not transfer)
  const lastActivePerRegion = {};
  for (let i = 0; i < N; i++) {
    if (status[i] === "active") lastActivePerRegion[dayRegion[i]] = i;
  }
  const splurgeCandidates = Object.values(lastActivePerRegion).slice(0, spec.splurgeCount);

  // Pick splurges (no back-to-back at the time of placement)
  for (const idx of splurgeCandidates) {
    const region = dayRegion[idx];
    const hotel = spec.hotels[region];
    const splurges = (spec.restaurants[region] || [])
      .filter(r => r.tier === "splurge")
      .sort((a, b) => (a.drive[hotel] ?? Infinity) - (b.drive[hotel] ?? Infinity));
    if (!splurges.length) continue;
    // Check neighbors are not splurges
    const prevTier = idx > 0 ? lookupTier(spec, dayRegion[idx - 1], dinnerByDay[idx - 1]) : null;
    const nextTier = idx < N - 1 ? lookupTier(spec, dayRegion[idx + 1], dinnerByDay[idx + 1]) : null;
    if (prevTier === "splurge" || nextTier === "splurge") continue;
    dinnerByDay[idx] = splurges[0].id;
  }

  // Fill remaining: cheap 70% / mid 30%
  const usedMidByRegion = {};
  for (let i = 0; i < N; i++) {
    if (dinnerByDay[i]) continue;
    const region = dayRegion[i];
    const hotel = spec.hotels[region];
    const wantMid = rng() < 0.30;
    const tierOrder = wantMid ? ["mid", "cheap"] : ["cheap", "mid"];
    let picked = null;
    for (const tier of tierOrder) {
      const cands = (spec.restaurants[region] || [])
        .filter(r => r.tier === tier)
        .filter(r => tier === "cheap" ? true : !(usedMidByRegion[region] || new Set()).has(r.id))
        .sort((a, b) => (a.drive[hotel] ?? Infinity) - (b.drive[hotel] ?? Infinity));
      if (cands.length) { picked = cands[0]; break; }
    }
    if (!picked) {
      // Fallback: any cheap, ignore drive
      picked = (spec.restaurants[region] || []).find(r => r.tier === "cheap") || (spec.restaurants[region] || [])[0];
    }
    if (picked) {
      dinnerByDay[i] = picked.id;
      if (picked.tier === "mid") {
        usedMidByRegion[region] = usedMidByRegion[region] || new Set();
        usedMidByRegion[region].add(picked.id);
      }
    }
  }

  // Step 5: rest suggestions
  const suggestionByDay = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (status[i] === "rest") {
      const bank = spec.restSuggestions || [];
      suggestionByDay[i] = bank.length ? bank[(spec.seed + (i + 1)) % bank.length] : null;
    }
  }

  // Assemble
  const out = [];
  for (let i = 0; i < N; i++) {
    out.push({
      n: i + 1,
      date: addDays(spec.startDate, i),
      region: dayRegion[i],
      status: status[i],
      activityId: status[i] === "active" ? activityByDay[i] : null,
      dinnerId: dinnerByDay[i],
      restSuggestion: status[i] === "rest" ? suggestionByDay[i] : null,
    });
  }
  return out;
}

function lookupTier(spec, region, dinnerId) {
  if (!dinnerId) return null;
  const r = (spec.restaurants[region] || []).find(x => x.id === dinnerId);
  return r?.tier ?? null;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error("Usage: build-schedule.mjs <spec.json>"); process.exit(2); }
  const spec = JSON.parse(readFileSync(file, "utf8"));
  const days = buildSchedule(spec);
  process.stdout.write(JSON.stringify(days, null, 2) + "\n");
}
