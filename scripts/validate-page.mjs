#!/usr/bin/env node
// Validates a generated trip page. Exits 0 on success, 1 on most failures,
// 2 specifically when the only failure is "no infinity-pool villa".

import { readFileSync, existsSync } from "node:fs";

const FILE = process.argv[2];
if (!FILE) { console.error("Usage: validate-page.mjs <html-file>"); process.exit(2); }
if (!existsSync(FILE)) { console.error(`error: file not found: ${FILE}`); process.exit(2); }

const html = readFileSync(FILE, "utf8");
const errors = [];
let infinityPoolError = null;

// ── Check 1: #trip-data parses ───────────────────────────────────────────
const m = html.match(/<script id="trip-data"[^>]*>([\s\S]*?)<\/script>/);
let td = null;
if (!m) { errors.push("missing <script id=\"trip-data\">"); }
else { try { td = JSON.parse(m[1]); } catch (e) { errors.push(`#trip-data not valid JSON: ${e.message}`); } }

if (td) {
  const days = td.days || [];
  const start = td.startDate, end = td.endDate;

  // ── Check 2: days.length matches date range ────────────────────────────
  if (start && end) {
    const expected = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    if (days.length !== expected) errors.push(`days.length=${days.length}, expected ${expected} for ${start}→${end}`);
  }

  // ── Check 3: numbering 1..N, no gaps ───────────────────────────────────
  for (let i = 0; i < days.length; i++) {
    if (days[i].n !== i + 1) { errors.push(`day index ${i}: n=${days[i].n}, expected ${i + 1}`); break; }
  }

  // ── Check 4: pacing rules ──────────────────────────────────────────────
  for (let i = 0; i < days.length - 1; i++) {
    if (days[i].status === "active" && days[i + 1].status === "active") {
      errors.push(`pacing: consecutive active days at ${i + 1} & ${i + 2}`);
      break;
    }
    if (days[i].status === "transfer" && days[i + 1].status === "active") {
      errors.push(`pacing: active day right after transfer at day ${i + 2}`);
      break;
    }
  }

  // ── Check 5: drive cap ─────────────────────────────────────────────────
  for (const d of days) {
    if (d.status !== "active") continue;
    const hotel = (td.regionHotel || {})[d.region];
    const act = ((td.activities || {})[d.region] || []).find(a => a.id === d.activityId);
    if (!act) { errors.push(`day ${d.n}: unknown activityId ${d.activityId}`); break; }
    if ((act.drive || {})[hotel] > 60) { errors.push(`day ${d.n}: drive ${act.drive[hotel]} > 60 from ${hotel}`); break; }
  }

  // ── Check 6: no activity reuse per region ──────────────────────────────
  const seen = {};
  for (const d of days) {
    if (!d.activityId) continue;
    const key = `${d.region}:${d.activityId}`;
    if (seen[key]) { errors.push(`activity ${d.activityId} reused in ${d.region}`); break; }
    seen[key] = true;
  }

  // ── Check 7: splurge count ±1 ──────────────────────────────────────────
  let splurges = 0;
  for (const d of days) {
    const r = ((td.restaurants || {})[d.region] || []).find(x => x.id === d.dinnerId);
    if (r?.tier === "splurge") splurges++;
  }
  const want = td.splurgeCount ?? 3;
  if (Math.abs(splurges - want) > 1) errors.push(`splurge count ${splurges}, expected ~${want}`);

  // ── Check 8: every day has dinnerId ────────────────────────────────────
  for (const d of days) {
    if (!d.dinnerId) { errors.push(`day ${d.n}: missing dinnerId`); break; }
  }
}

// ── Check 9: infinity-pool villa present (special exit 2 if it's the ONLY error) ─
const hasInfinityPool = /infinity\s*pool/i.test(html);
if (!hasInfinityPool) infinityPoolError = "no 'Infinity Pool' feature tag found anywhere on the page";

// ── Check 10: tag balance ──────────────────────────────────────────────────
for (const tag of ["section", "div", "article", "script", "style"]) {
  const opens = (html.match(new RegExp(`<${tag}(\\s|>)`, "g")) || []).length;
  const closes = (html.match(new RegExp(`</${tag}>`, "g")) || []).length;
  if (opens !== closes) errors.push(`tag balance: <${tag}> opens=${opens} closes=${closes}`);
}
const titleM = html.match(/<title>([^<]*)<\/title>/);
if (!titleM || !titleM[1].trim()) errors.push("missing or empty <title>");

// ── Check 11: nav anchors match ids ────────────────────────────────────────
const navHrefs = [...html.matchAll(/<a\s+[^>]*href="#([a-zA-Z0-9_-]+)"/g)].map(x => x[1]);
const ids = new Set([...html.matchAll(/\sid="([a-zA-Z0-9_-]+)"/g)].map(x => x[1]));
for (const h of navHrefs) {
  if (!ids.has(h)) { errors.push(`nav anchor #${h} has no matching id`); break; }
}

// ── Check 12: no template placeholders left ────────────────────────────────
const placeholderM = html.match(/\{\{[A-Z_]+\}\}/);
if (placeholderM) errors.push(`unsubstituted placeholder: ${placeholderM[0]}`);

// ── Resolve exit code ──────────────────────────────────────────────────────
if (errors.length === 0 && infinityPoolError) {
  console.error(`✗ ${infinityPoolError}`);
  process.exit(2);
}
if (errors.length > 0) {
  if (infinityPoolError) errors.unshift(infinityPoolError);
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}

const summary = td ? `${(td.days || []).length} days, ${(td.days || []).filter(d => d.status === "active").length} active` : "ok";
console.error(`validated ${FILE}: ${summary}`);
process.exit(0);
