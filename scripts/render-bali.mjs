#!/usr/bin/env node
// Throwaway script: render a Bali trip page from hand-written content JSON.
// Used to verify the template works end-to-end before we build the agent.
// Deleted in Task 14.

import { readFileSync, writeFileSync } from "node:fs";
import { buildSchedule } from "./build-schedule.mjs";

const content = JSON.parse(readFileSync("scripts/__tests__/fixtures/bali-content.json", "utf8"));
const tpl = readFileSync("templates/trip-page.html.tmpl", "utf8");
const runtime = readFileSync("templates/swap-runtime.js", "utf8");

// Build trip-spec for the scheduler
const spec = {
  tripSlug: content.tripSlug,
  startDate: content.startDate,
  endDate: content.endDate,
  seed: content.seed,
  splurgeCount: content.splurgeCount,
  driveCapMinutes: content.driveCapMinutes,
  restSuggestions: content.restSuggestions,
  regions: content.regions.map((r) => ({ id: r.id, name: r.name, nightsRange: r.nightsRange })),
  hotels: Object.fromEntries(content.regions.map((r) => [r.id, r.hotels[0].id])),
  activities: Object.fromEntries(content.regions.map((r) => [r.id, r.attractions.map((a) => ({ id: a.id, name: a.name, score: a.score, drive: a.drive }))])),
  restaurants: Object.fromEntries(content.regions.map((r) => [r.id, r.restaurants.map((x) => ({ id: x.id, name: x.name, tier: x.tier, drive: x.drive }))])),
};

const days = buildSchedule(spec);

// ── fragment helpers ───────────────────────────────────────────────────────
function extractFragment(tag) {
  const m = tpl.match(new RegExp(`<!-- ${tag}_TEMPLATE_START -->([\\s\\S]*?)<!-- ${tag}_TEMPLATE_END -->`));
  if (!m) throw new Error(`fragment not found: ${tag}`);
  return m[1].trim();
}
function fill(fragment, vars) {
  return fragment.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => vars[k] ?? "");
}

const fragHotel    = extractFragment("HOTEL_CARD");
const fragSpot     = extractFragment("SPOT_CARD");
const fragTL       = extractFragment("TIMELINE_CARD");
const fragNav      = extractFragment("NAV_ITEM");
const fragRegion   = extractFragment("REGION_SECTION");
const fragDay      = extractFragment("DAY_CARD");

// ── per-region rendering ───────────────────────────────────────────────────
const regionSections = content.regions.map((r) => {
  const hotels = r.hotels.map((h) => fill(fragHotel, {
    HOTEL_IMG: h.img,
    HOTEL_NAME: h.name,
    HOTEL_RATING: h.rating,
    HOTEL_PLATFORM: h.platform,
    HOTEL_PLATFORM_CLASS: h.platformClass || "",
    HOTEL_PRICE: h.price,
    HOTEL_FEATURES: (h.features || []).map(f => `<span>${f}</span>`).join(""),
    HOTEL_DESC: h.desc,
    HOTEL_COUPLES_NOTE: h.couplesNote ? `<div class="couples-note">&#9829; Couples rate it ${h.couplesNote}</div>` : "",
  })).join("\n        ");

  const spots = (r.attractions || []).map((a) => fill(fragSpot, {
    SPOT_IMG: a.img,
    SPOT_NAME: a.name,
    SPOT_VIBE: a.vibe,
    SPOT_DETAIL: a.detail,
    SPOT_PRICE: a.price,
  })).join("\n        ");

  const localQuote = r.localQuote
    ? `<div class="local-quote"><em>"${r.localQuote.text}"</em><cite>&mdash; ${r.localQuote.source}</cite></div>`
    : "";

  const socials = r.socialEmbeds && r.socialEmbeds.length
    ? `<details class="social-embeds"><summary>From TikTok / IG (${r.socialEmbeds.length})</summary>${r.socialEmbeds.join("")}</details>`
    : "";

  return fill(fragRegion, {
    REGION_ID: r.id,
    REGION_NUM: r.num,
    REGION_NAME: r.name,
    REGION_DAYS: r.days,
    REGION_NIGHTS: r.nights,
    REGION_TAGLINE: r.tagline,
    REGION_BANNER_IMG: r.bannerImg,
    GETTING_THERE_LIST: (r.gettingThere || []).map(li => `<li>${li}</li>`).join("\n          "),
    HOTEL_CARDS: hotels,
    HOTEL_TIP_BOX: r.hotelTipBox ? `<div class="tip-box">${r.hotelTipBox}</div>` : "",
    ATTRACTION_CARDS: spots,
    LOCAL_QUOTE_BOX: localQuote,
    SOCIAL_EMBEDS: socials,
  });
}).join("\n\n");

// ── timeline cards (Overview) ──────────────────────────────────────────────
const timelineCards = content.regions.map((r) => fill(fragTL, {
  REGION_DAYS: r.days,
  REGION_NAME: r.name,
  REGION_TAGLINE: r.tagline,
})).join("\n    ");

// ── nav links ──────────────────────────────────────────────────────────────
const navLinks = [
  fill(fragNav, { ITEM_ID: "overview", ITEM_LABEL: "Overview" }),
  fill(fragNav, { ITEM_ID: "dayplan",  ITEM_LABEL: "Day-by-Day" }),
  ...content.regions.map(r => fill(fragNav, { ITEM_ID: r.id, ITEM_LABEL: r.name })),
  fill(fragNav, { ITEM_ID: "budget", ITEM_LABEL: "Budget" }),
].join("\n    ");

// ── day cards (static) ─────────────────────────────────────────────────────
const dayCards = days.map((d) => {
  const region = content.regions.find(r => r.id === d.region);
  const regionName = region ? region.name : d.region;
  const a = region?.attractions.find(x => x.id === d.activityId);
  const r = region?.restaurants.find(x => x.id === d.dinnerId);
  const dt = new Date(d.date + "T00:00:00Z");
  const dateShort = dt.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const statusBadge = d.status === "active" ? "📸 ACTIVE" : d.status === "rest" ? "🌿 REST" : "✈️ TRANSFER";
  const hotel = spec.hotels[d.region];

  let activityBlock;
  if (d.status === "rest") {
    activityBlock = `<div class="rest-suggestion">🌿 ${d.restSuggestion || "Rest day"}</div>`;
  } else if (d.status === "transfer") {
    activityBlock = `<div class="transfer-note">✈️ Transfer day — see region section for logistics.</div>`;
  } else if (a) {
    const drive = a.drive[hotel];
    activityBlock = `<strong>${a.name}</strong><div class="muted">🚗 ${drive} min from ${hotel}</div>`;
  } else {
    activityBlock = `<em>(no activity)</em>`;
  }

  const dinnerBlock = r
    ? `🍽 <strong>${r.name}</strong><div class="muted">${r.tier} · ${r.drive[hotel] ?? "?"} min</div>`
    : `<em>(no dinner)</em>`;

  return fill(fragDay, {
    DAY_N: d.n,
    DAY_N_PAD: String(d.n).padStart(2, "0"),
    DATE_SHORT: dateShort,
    REGION_NAME: regionName,
    STATUS: d.status,
    STATUS_BADGE: statusBadge,
    ACTIVITY_NAME_OR_REST: a?.name || d.status,
    ACTIVITY_BLOCK: activityBlock,
    DINNER_BLOCK: dinnerBlock,
  });
}).join("\n    ");

// ── trip-data JSON for the swap UI ─────────────────────────────────────────
const tripData = {
  tripSlug: spec.tripSlug,
  seed: spec.seed,
  startDate: spec.startDate,
  endDate: spec.endDate,
  splurgeCount: spec.splurgeCount,
  regions: content.regions.map(r => ({ id: r.id, name: r.name })),
  regionHotel: spec.hotels,
  activities: spec.activities,
  restaurants: spec.restaurants,
  days,
};

// ── final substitution ─────────────────────────────────────────────────────
let html = tpl
  .replaceAll("{{TITLE}}", content.title)
  .replace("{{SUBTITLE}}", content.subtitle)
  .replace("{{DATES_LONG}}", content.datesLong)
  .replace("{{DATES_SHORT}}", content.datesShort)
  .replace("{{HERO_IMG}}", content.heroImg)
  .replace("{{OVERVIEW_TITLE}}", content.overviewTitle)
  .replace("{{OVERVIEW_TAGLINE}}", content.overviewTagline)
  .replace("{{WEATHER_NOTE}}", content.weatherNote)
  .replace("{{NAV_LINKS}}", navLinks)
  .replace("{{TIMELINE_CARDS}}", timelineCards)
  .replace("{{DAY_PLAN_SECTION}}", dayCards)
  .replace("{{REGION_SECTIONS}}", regionSections)
  .replace("{{BUDGET_TAGLINE}}", content.budgetTagline)
  .replace("{{BUDGET_TABLE}}", content.budgetTable)
  .replace("{{BUDGET_NOTE}}", content.budgetNote)
  .replace("{{FOOTER_CLOSING}}", content.footerClosing)
  .replace("{{TRIP_DATA_JSON}}", JSON.stringify(tripData, null, 2))
  .replace("{{SWAP_RUNTIME_JS}}", runtime);

// Strip the <template id="fragments"> block (held the fragment definitions
// we just extracted; we don't ship it in the final page because it contains
// unfilled placeholders that would trip the validator).
html = html.replace(/<template id="fragments"[^>]*>[\s\S]*?<\/template>\s*/g, "");

const outFile = process.argv[2] || "/tmp/bali-rendered.html";
writeFileSync(outFile, html);
console.error(`rendered ${outFile} (${html.length} bytes)`);
