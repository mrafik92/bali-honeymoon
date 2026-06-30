# Travel Agent — Design

**Date:** 2026-06-30
**Status:** Design approved, pre-implementation
**Repo:** `mrafik92/bali-honeymoon` (kept named for URL stability)

## Summary

Build an OpenCode subagent that takes a destination name (and optional dates / notes) and generates a polished, GitHub-Pages-deployable travel page for it. Style and structure mirror the existing Bali honeymoon page. Output includes a day-by-day plan that respects pacing rules (alternate active/rest with extra rest after transfers, 60-min drive cap from hotel, mostly cheap dinners with 2–3 splurges, at least one luxury infinity-pool villa, restaurants per day). The agent does live web research including TikTok / Instagram / YouTube / Reddit (via `site:` searches) and mandatory local-language search. Generated pages are committed to `trips/<slug>/` and deployed via GitHub Actions.

## Goals

1. `@travel-agent <country>` produces a complete, deployable trip page with zero further hand-editing required.
2. Every generated page looks like a sibling of the existing Bali page (typography, color, layout, card styles all identical).
3. The day plan is enforceable: pacing rules, drive-time cap, dinner-per-day, splurge distribution are all validated automatically before commit.
4. The Bali page itself is regenerated through the agent as a dogfood test — proves the system works end-to-end on a known-good destination.
5. The live URL `https://mrafik92.github.io/bali-honeymoon/` stays alive across the restructure.

## Non-goals (YAGNI)

- Backend, database, user accounts.
- Multi-user editing or shared state (swap UI is per-browser localStorage only).
- Real-time hotel/restaurant pricing or booking integration.
- Live drive-time API (the agent estimates; users get a Google Maps link to verify).
- Image downloading or self-hosting (Unsplash hotlinks + 200-check, same as today).
- A trip-spec editor UI — the agent IS the authoring interface.
- Unit tests beyond the validation script — dogfood + validation IS the test suite.

## Constraints (locked from brainstorming)

- **Pacing:** alternate active / rest days, with the day AFTER any transfer day forced to rest.
- **Travel cap:** any activity assigned to a day must be ≤ 60 min one-way drive from that day's hotel. Eligibility is enforced; out-of-range options are not shown in the swap pool either.
- **Dinner per day:** every day has one dinner pick. Mostly cheap (warung / street food $3–10), some mid-range, exactly 2–3 splurges across the whole trip.
- **Breakfast:** assumed at hotel, not surfaced in the day plan.
- **Hotel mix:** mostly budget ($30–100/night). At least one luxury villa with an infinity pool must appear in the trip (hard requirement; relaxes to "luxury villa with pool" with a note if no infinity pool is found at a reasonable price).
- **Restaurants per region:** 6–8.
- **Activities per region:** 6–10 in the pool; only some used on active days, the rest are swap options.
- **Day count:** if user provides dates, use them. Otherwise default to 14 days starting on the first of next month. Cap at 21 days.
- **Trip length floor:** below 4 days, skip alternation and put one activity per day.
- **Splurge count:** 2–3 per trip, never on transfer days, never back-to-back.
- **Pin behavior:** only arrival and departure days are pinned as transfer. Inter-region boundary days are also transfer days (the scheduler picks them based on the region night allocation).
- **Research is mandatory:** English web search + social signal sweep (`site:tiktok.com`, `site:reddit.com/r/travel`, `site:youtube.com`, `site:instagram.com`) + local-language sweep (queries in the local language on local TLDs, with translated quotes surfaced in the page).
- **Images:** Unsplash hotlinks, validated 200 OK before commit. Up to 3 retries per image.
- **Deployment:** GitHub Pages via Actions workflow, source set to "GitHub Actions" (not branch).
- **Persistence:** swap-UI overrides save to `localStorage["trip:<slug>"]`. Reset button wipes. Shuffle button re-runs the scheduler client-side with a bumped seed.
- **Print:** `[Print plan]` button uses `window.print()` with a print stylesheet that hides nav, hero, social embeds, and swap UI.

## Architecture

```
honeymoon-planner/  (this repo, named `bali-honeymoon` on GitHub)
├── .github/
│   └── workflows/
│       └── pages.yml         deploy root + trips/ to GitHub Pages on push to main
├── .opencode/
│   └── agent/
│       └── travel-agent.md   OpenCode subagent (Opus 4.7, subagent mode)
├── templates/
│   └── trip-page.html.tmpl   strict HTML template with {{PLACEHOLDER}} substitution
├── scripts/
│   ├── check-images.sh       generalized: takes <html-file> arg, validates Unsplash URLs
│   ├── build-schedule.mjs    deterministic scheduler (Node ESM, zero deps)
│   ├── validate-page.mjs     12-point structural validator
│   └── build-index.mjs       root trips-listing generator (runs in CI)
├── trips/
│   └── bali-march-2027/
│       └── index.html        regenerated through the agent
├── index.html                auto-generated trips listing (CI-built)
└── README.md
```

Each `trips/<slug>/index.html` is fully self-contained: inlined `<style>`, inlined `<script>`, no shared runtime. Renders correctly offline, prints correctly, no JS required for static content.

## Components

### 1. The agent (`.opencode/agent/travel-agent.md`)

OpenCode subagent. Frontmatter:

```yaml
---
description: Generates a polished honeymoon-style travel page for any destination, with hotels, activities, restaurants, and a day-by-day plan that respects pacing rules. Use when the user asks for a trip plan for a country/region/city.
mode: subagent
model: github-copilot/claude-opus-4.7
permission:
  edit: allow
  bash: allow
  webfetch: allow
  websearch: allow
---
```

Body (the agent's prompt) encodes a 9-step workflow:

1. **Parse the request.** Extract destination, dates, trip length, user notes. Generate a slug like `japan-march-2027`. Reject if destination is missing.
2. **Plan the regions.** Pick 2–4 regions inside the destination, allocate nights proportionally (longer in cultural hubs, shorter on detours).
3. **Research, in this order:**
   - English web search (best things to do, hidden gems, budget hotels).
   - Social signal sweep via `site:tiktok.com / site:reddit.com / site:youtube.com / site:instagram.com` queries. Harvest URLs and captions; pick 2–3 most-cited TikTok URLs per region to embed.
   - **Mandatory local-language sweep:** identify the country's primary language(s) + TLD(s), generate 6–10 queries in the local language, run them, fetch results, pull out names not in English results, surface 1–2 short translated quotes per region with attribution.
   - Image hunt on Unsplash for each hotel and attraction.
4. **Pick content per region:** 3–5 hotels (mix; at least one luxury infinity-pool villa somewhere in the trip), 6–10 activities, 6–8 restaurants. Build a drive-time matrix from each hotel to every activity / restaurant in that region.
5. **Build the day plan.** Compose the trip-spec JSON (regions, dates, hotels, activities, restaurants, splurge count, drive cap, and a `restSuggestions` array — the agent always provides this bank, defaulting to the constant list `["Pool & book", "Couples spa near hotel", "Short walk around <neighborhood>", "Sunset cocktail at hotel bar", "Late breakfast and lazy morning"]` with `<neighborhood>` substituted per region). Invoke `scripts/build-schedule.mjs` with the trip-spec JSON; receive a day-plan JSON.
6. **Fill the template.** Read `templates/trip-page.html.tmpl`, substitute placeholders, write `trips/<slug>/index.html`.
7. **Verify.** Run `scripts/check-images.sh`, `scripts/validate-page.mjs`. Any non-zero exit triggers targeted retry logic per failure mode (see below).
8. **Commit + push** to `main`. The Action deploys.
9. **Report** back to the user: local file path, Pages URL, regions / hotels / highlights summary, any images that needed replacement, any flagged constraints (e.g. "no <$200 infinity-pool villa found, relaxed to luxury pool villa").

**Failure modes the prompt explicitly handles:**
- Image 200-check fails → fetch a replacement Unsplash URL, re-validate (max 3 retries per image).
- Local-language search returns nothing → log it, continue, flag in the report.
- No infinity-pool villa found at <$200/night → relax to "luxury villa with pool", note the relaxation in the report.
- Trip length < 4 days → skip alternation, one activity per day.
- Trip length > 21 days → cap at 21, tell the user.
- Validator failure on the scheduler output → adjust input (e.g. add more activities, drop excluded ones) and retry once.

**Invocation examples:**
- `@travel-agent Japan` → 14 days from first of next month, default settings.
- `@travel-agent Vietnam, October 2027, 10 days, beach focus`
- `@travel-agent Lisbon and Algarve, July 4-15 2027`

### 2. The template (`templates/trip-page.html.tmpl`)

Extracted from the existing Bali `index.html` (953 lines). Same `<style>` block, same typography (Playfair Display + Inter), same color palette, same card shapes. Trip-specific content replaced with placeholders.

**Top-level placeholders:**

| Placeholder | Type | Purpose |
|---|---|---|
| `{{TITLE}}` | string | `<title>` and hero `<h1>` |
| `{{SUBTITLE}}` | string | "Our Honeymoon Adventure" (constant) |
| `{{DATES_LONG}}` | string | "March 2027 · 14 Days" |
| `{{DATES_SHORT}}` | string | "March 1–14, 2027" |
| `{{HERO_VIDEO_URL}}` | string | optional video URL; empty falls back to image |
| `{{HERO_IMG}}` | string | always-set hero image URL |
| `{{WEATHER_NOTE}}` | string | seasonal one-liner |
| `{{TIMELINE_CARDS}}` | HTML | one card per region (day-range + name + tagline) |
| `{{NAV_LINKS}}` | HTML | nav items (Overview + Day-by-Day + per-region + Budget) |
| `{{DAY_PLAN_SECTION}}` | HTML | full new "Day-by-Day Plan" section |
| `{{REGION_SECTIONS}}` | HTML | one full `<section>` per region |
| `{{TRIP_DATA_JSON}}` | JSON | embedded source-of-truth for swap UI |
| `{{SWAP_RUNTIME_JS}}` | JS | inlined vanilla JS for swap pool (constant per template) |
| `{{BUDGET_TABLE}}` | HTML | budget table rows |
| `{{BUDGET_NOTE}}` | string | currency conversion + booking-tip footer |
| `{{FOOTER_CLOSING}}` | string | e.g. "See you in Japan — March 2027" |

**Per-region placeholders** (the agent repeats the inner template once per region, concatenating into `{{REGION_SECTIONS}}`):

`{{REGION_NUM}}`, `{{REGION_NAME}}`, `{{REGION_DAYS}}`, `{{REGION_NIGHTS}}`, `{{REGION_TAGLINE}}`, `{{REGION_BANNER_IMG}}`, `{{GETTING_THERE_LIST}}`, `{{HOTEL_CARDS}}`, `{{HOTEL_TIP_BOX}}`, `{{ATTRACTION_CARDS}}`, `{{LOCAL_QUOTE_BOX}}`, `{{SOCIAL_EMBEDS}}`.

**Fragment templates inside the .tmpl file:**

Repeating fragments (one hotel card, one attraction card, one timeline card, one day card) are embedded inside HTML comments like `<!-- HOTEL_CARD_TEMPLATE_START --> ... <!-- HOTEL_CARD_TEMPLATE_END -->`. The agent reads them out, fills inner placeholders, concatenates. No external template engine required.

**New CSS added on top of the existing Bali styles:**

- `.day-plan-section` and `.day-card` — for the day-by-day section.
- `.day-card .status-badge` variants for `active` / `rest` / `transfer`.
- `.swap-pool` — hidden per-day list shown when "swap" is clicked.
- `.local-quote` — italic Playfair, left border, small attribution.
- `.social-embeds` — wraps TikTok embeds in `<details>` collapsed by default, capped at 600px scroll height.
- `@media print` — hides nav, hero video, social embeds, swap UI; forces day-card page-break behavior.

### 3. The day-by-day section

New top-level `<section id="dayplan">` between Overview and the first region. Anchor added to nav.

**Layout:** vertical stack of day cards on mobile, 2-column grid on desktop. Static HTML on first render (works without JS, prints correctly), enhanced by the swap-pool JS.

**Day card shape:**

```
DAY 03 · MAR 3      [UBUD]  [📸 ACTIVE]
─────────────────────────────────────────
[thumb] Tegalalang Rice Terraces
        Like walking through a living painting…
        🚗 22 min from Eden House  ·  Free
        [swap activity ▾]
─────────────────────────────────────────
🍽 Warung Babi Guling Ibu Oka
   Local · $5/person · 8 min walk
   [swap dinner ▾]
─────────────────────────────────────────
⏱ Total transit: 44 min round-trip
```

**Status badges:**
- `📸 ACTIVE` — excursion + dinner. Card shows `[swap activity ▾]` and `[swap dinner ▾]` buttons, plus a `[mark as rest]` button in the card header.
- `🌿 REST` — no excursion, soft suggestion (e.g. "Pool & book", "Couples spa near hotel"), dinner near hotel. Card shows ONLY `[swap dinner ▾]` and `[make active]` (in header). No "swap activity" button on rest cards.
- `✈️ TRANSFER` — inter-region move; shows transfer logistics inline, no excursion, dinner is "at hotel or nearby". Card shows ONLY `[swap dinner ▾]`. No "mark as rest" / "make active" toggle on transfer cards (transfer status is pinned by the scheduler).

**Rest-day suggestion bank** (passed to scheduler as `restSuggestions: string[]`):
`pool & book`, `couples spa near hotel`, `short walk around <hotel neighborhood>`, `sunset cocktail at hotel bar`, `late breakfast and lazy morning`. Pick is deterministic per `(seed + dayN) % bank.length`.

**Embedded data (single source of truth for the swap UI):**

```html
<script id="trip-data" type="application/json">
{
  "tripSlug": "japan-march-2027",
  "seed": 1,
  "regions": [...],
  "days": [
    { "n": 1, "date": "2027-03-01", "region": "tokyo", "status": "transfer", "activityId": null, "dinnerId": "katsu-ton" },
    ...
  ],
  "regionHotel": { "tokyo": "shinjuku-granbell", "kyoto": "guesthouse-rakuza" },
  "activities": { "tokyo": [{ "id": "...", "name": "...", "thumb": "...", "drive": { "shinjuku-granbell": 0 }, "price": "...", "vibe": "...", "detail": "..." }, ...] },
  "restaurants": { "tokyo": [{ "id": "...", "tier": "cheap|mid|splurge", "drive": {...}, ... }, ...] },
  "restSuggestions": [...]
}
</script>
```

### 4. The swap-pool JS runtime

Inlined `<script>` at the end of every generated page. Plain vanilla JS, ES2020, ~100–150 lines. Responsibilities:

1. **Load:** parse `#trip-data`, restore overrides from `localStorage["trip:<slug>"]` (stored as deltas only).
2. **Swap activity:** clicking `[swap activity ▾]` reveals an inline list of other eligible activities for the same region. Eligibility = same region, drive[hotel] ≤ 60, not already used on another day. Each option: thumbnail, name, drive time, vibe one-liner. Click to apply.
3. **Swap dinner:** same UX. Dinners CAN repeat; the list sorts unused dinners first.
4. **Toggle rest:** per-card `[mark as rest]` / `[make active]`. Rest days drop their activity, keep their dinner.
5. **Persist:** save deltas to `localStorage["trip:<slug>"]`.
6. **Reset:** wipe localStorage for this trip, re-render from `#trip-data` defaults.
7. **Shuffle:** bump seed, re-run the scheduler client-side (ported from `build-schedule.mjs`, same algorithm), update in-memory state, re-render.
8. **Print:** call `window.print()`; print stylesheet handles the rest.

**Empty-pool handling:** if all eligible swap options for a day are exhausted, show "No more options for this hotel in <region>. Try shuffle, or switch the activity on another day first."

**Accessibility:**
- Swap toggles are `<button>` with `aria-expanded`.
- Day cards are `<article>` with `aria-label="Day 3, active, Tegalalang Rice Terraces"`.
- Print stylesheet works without JS.

### 5. The scheduler (`scripts/build-schedule.mjs`)

Node ESM, zero dependencies. Reads a trip-spec JSON, writes a day-plan JSON. Deterministic given `seed`.

**Input shape** (excerpt):
```json
{
  "tripSlug": "japan-march-2027",
  "startDate": "2027-03-01",
  "endDate": "2027-03-14",
  "seed": 1,
  "regions": [{ "id": "tokyo", "name": "Tokyo", "nightsRange": [5,6] }, ...],
  "hotels": { "tokyo": "shinjuku-granbell", ... },
  "activities": { "tokyo": [{ "id": "...", "score": 9, "drive": { "shinjuku-granbell": 0 } }, ...] },
  "restaurants": { "tokyo": [{ "id": "...", "tier": "cheap", "drive": {...} }, ...] },
  "splurgeCount": 3,
  "driveCapMinutes": 60,
  "restSuggestions": [...]
}
```

**Output:** the `days` array from `#trip-data` (above).

**Algorithm:**

1. **Determine region per day.** Day 1 = arrival in first region. Last day = departure from last region. Distribute middle days across regions proportional to `nightsRange[0]`. Days at region boundaries get `status: transfer`.
2. **Assign rest/active pattern.** Day 1 and last day = `transfer`. Inter-region boundary days = `transfer`. The day after any `transfer` = `rest`. Remaining days alternate `active`, `rest`, `active`, …, starting with `active`.
3. **Assign activities.** Per region: filter activities by `drive[hotel] ≤ driveCapMinutes`, sort by `score` desc, shuffle ties via seeded PRNG. Fill active days in order. If a region runs out of eligible activities, extra active days downgrade to `rest`.
4. **Assign dinners.** Distribute `splurgeCount` across the trip (one per region max, never on transfer days, never back-to-back, prefer the last active day of each region). Remaining days get `cheap` 70% / `mid` 30% via seeded PRNG. Pick the closest-drive eligible dinner.
5. **Rest-day suggestion.** Per rest day, pick `restSuggestions[(seed + dayN) % bank.length]`.
6. **Self-validate.** Same rules `validate-page.mjs` checks. Exit non-zero with stderr message if violated.

**Seeded PRNG:** mulberry32 (12 lines). Same seed → identical output. Shuffle button bumps seed by 1.

### 6. The validator (`scripts/validate-page.mjs`)

Node ESM, zero deps. Reads a generated HTML file, runs 12 hard checks. Exit code ≠ 0 stops the agent.

1. `#trip-data` exists, parses as JSON, matches expected shape.
2. `days.length` matches the inclusive date range.
3. Days numbered 1..N with no gaps.
4. **Pacing:** no two consecutive `active` days. Every `transfer` followed by `rest` or `transfer` (or is the last day).
5. **Drive cap:** every `active` day's activity has `drive[regionHotel[day.region]] ≤ 60`.
6. No activity reused within a region.
7. Splurge count within ±1 of requested.
8. Every day has a `dinnerId`.
9. **Infinity-pool villa:** at least one hotel has the `Infinity Pool` feature tag. Failure exits with code 2 specifically (distinguishable from other failures so the agent can relax and retry once).
10. **HTML sanity:** tag-balance check for `<section>`, `<div>`, `<article>`. `<title>` present and non-empty.
11. **Nav anchors:** every `<a href="#xxx">` in nav has a matching `id="xxx"` element.
12. **No placeholders left:** no `{{XXX}}` strings remain.

On success, prints a one-line summary to stderr.

### 7. The image checker (`scripts/check-images.sh`)

Generalized from the existing script. Takes one HTML file as argument. Greps Unsplash photo IDs, curls each, asserts 200. Returns non-zero on any failure.

Used by the agent during verification AND by the existing pre-push git hook (updated to loop over `trips/*/index.html` and the root `index.html`).

### 8. The root trips-listing (`scripts/build-index.mjs`)

Node ESM, runs in CI on every push to `main`. Globs `trips/*/index.html`, extracts title + hero + dates (from `#trip-data` JSON, not visible scraping), sorts by `startDate` ascending, renders the root `index.html` with a tiny inlined template (~250 lines).

**Includes a meta-refresh** `<meta http-equiv="refresh" content="3; url=trips/<default-slug>/">` so anyone hitting the old `https://mrafik92.github.io/bali-honeymoon/` URL is redirected to the most recent / upcoming trip after seeing the listing for 3 seconds. Default slug is configurable (initially `bali-march-2027`).

### 9. The GitHub Pages workflow (`.github/workflows/pages.yml`)

```yaml
name: Deploy Pages
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Rebuild trips index
        run: node scripts/build-index.mjs

      - name: Validate every trip page
        run: |
          for f in trips/*/index.html; do
            node scripts/validate-page.mjs "$f"
            bash scripts/check-images.sh "$f"
          done

      - name: Commit rebuilt index if changed
        run: |
          if [[ -n "$(git status --porcelain index.html)" ]]; then
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add index.html
            git commit -m "ci: rebuild trips index"
            git push
          fi

      - uses: actions/configure-pages@v5
      - name: Stage publishable files
        run: |
          mkdir -p _site
          cp index.html _site/index.html
          cp -r trips _site/trips
          touch _site/.nojekyll
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site
      - uses: actions/deploy-pages@v4
```

**One-time manual setting:** Pages source must be set to "GitHub Actions" (not "Deploy from a branch"). The agent's prompt includes the `gh api` call to set this programmatically as part of repo setup.

**Loop guard:** the "commit rebuilt index" step only commits when the diff is non-empty. The follow-up push triggers the workflow again, finds the index stable, no commit, deploy. Two runs per agent push max, never infinite.

## Data flow

```
User: @travel-agent Japan
  ↓
Agent prompt step 1–4: research, pick content
  ↓
Agent writes trip-spec.json (in memory)
  ↓
Agent runs `node scripts/build-schedule.mjs < trip-spec.json`
  ↓
Receives day-plan JSON
  ↓
Agent reads templates/trip-page.html.tmpl, substitutes placeholders, writes trips/japan-march-2027/index.html
  ↓
Agent runs `bash scripts/check-images.sh trips/japan-march-2027/index.html` (retry up to 3x per image on failure)
  ↓
Agent runs `node scripts/validate-page.mjs trips/japan-march-2027/index.html` (exit 2 → relax luxury constraint, retry once)
  ↓
Agent: git add, commit, push
  ↓
GitHub Action triggers: rebuild root index.html, validate all trips, deploy Pages
  ↓
User receives report: file path + Pages URL + summary + any flagged constraints
```

## Dogfooding plan

**Phase 0 — Repo restructure (no agent, no template, just file moves).**
1. Create `.github/workflows/`, `templates/`, `scripts/`, `trips/`.
2. `git mv index.html trips/bali-march-2027/index.html`.
3. `git mv check-images.sh scripts/check-images.sh`. Generalize to take `<html-file>` arg.
4. Write `scripts/build-index.mjs`. Run it locally → generates root `index.html` listing.
5. Push. Verify Action deploys. Hit `https://mrafik92.github.io/bali-honeymoon/` → listing visible, Bali card clickable → existing content intact at `/trips/bali-march-2027/`.
6. Update pre-push hook to loop over `trips/*/index.html`.

**Phase 1 — Build the template.**
1. Copy `trips/bali-march-2027/index.html` to `templates/trip-page.html.tmpl`.
2. Insert `{{PLACEHOLDERS}}` per the table above.
3. Add new sections: `{{DAY_PLAN_SECTION}}`, `{{LOCAL_QUOTE_BOX}}`, `{{SOCIAL_EMBEDS}}`.
4. Add new CSS: `.day-plan-section`, `.day-card`, `.swap-pool`, `.local-quote`, `.social-embeds`, print rules.
5. Inline the swap-pool JS runtime.
6. **Verify:** write a one-off `scripts/render-bali.mjs` taking a hand-written `bali-spec.json` (current Bali content), produces an HTML file. Diff against the original. Intentional diffs only: new day-plan section, local-quote callouts, social embeds, small CSS additions. `render-bali.mjs` and `bali-spec.json` are throwaways — deleted at the end of Phase 4 once the agent itself can regenerate Bali.

**Phase 2 — Build the scheduler + validator.**
1. `scripts/build-schedule.mjs` per §5.
2. Test with the Bali spec JSON. Expect: 14 days, alternating pattern, day 7 / day 10 = transfer, days 8 / 11 = rest, drive-times in cap, 3 splurges.
3. `scripts/validate-page.mjs` per §6.
4. Run validator against the Phase 1.6 output. Must pass.

**Phase 3 — Build the agent.**
1. Write `.opencode/agent/travel-agent.md`.
2. Restart opencode (config requires it).
3. **Dogfood 1:** `@travel-agent Bali, March 1-14 2027`. Compare to existing page. Expect same regions, mostly same activities + some new ones surfaced by TikTok / local search, hotels possibly upgraded (with at least one infinity-pool villa added — Bali has plenty: Hanging Gardens, Bisma Eight, COMO Uma, etc.), day plan valid.
4. **Dogfood 2:** `@travel-agent Japan`. New destination. Spot-check regions sensible, day plan valid, Pages deploys cleanly.
5. Failures: adjust prompt or scheduler, re-test.

**Phase 4 — Commit and ship.**
1. Replace `trips/bali-march-2027/index.html` with the dogfood-1 output. Original kept in git history.
2. README updated.
3. Push. Action deploys. URL is live.

## Surface area

| File | Purpose | Approx size |
|---|---|---|
| `.opencode/agent/travel-agent.md` | the agent prompt | 200–300 lines |
| `templates/trip-page.html.tmpl` | strict HTML template | 1100–1300 lines |
| `scripts/build-schedule.mjs` | deterministic scheduler | 150–200 lines |
| `scripts/validate-page.mjs` | 12-point validator | 150–200 lines |
| `scripts/build-index.mjs` | root listing generator | 100–150 lines |
| `scripts/check-images.sh` | generalized image checker | 15 lines |
| `.github/workflows/pages.yml` | CI deploy | 35 lines |
| `trips/bali-march-2027/index.html` | regenerated Bali page | ~1300 lines |
| `index.html` (root) | trip listing (CI-built) | ~250 lines |
| `README.md` | usage docs | ~60 lines |

## Open questions

None at time of writing. All decisions locked through the brainstorming Q&A.

## Risks

1. **TikTok embed reliability.** The `<blockquote class="tiktok-embed">` format depends on TikTok's official embed JS, which they host. If TikTok changes the embed URL or pulls support, embeds break silently. Mitigation: wrap in `<details>` collapsed by default, so a broken embed doesn't dominate the page. Also: the captions / titles are surfaced as plain text alongside, not just video tiles.
2. **Local-language search quality.** Exa / web-search results in non-Latin scripts are sometimes thin. Mitigation: the agent's prompt logs the queries it ran and the results it found, and surfaces "thin local results" as a flag in the final report.
3. **Unsplash URL drift.** Unsplash occasionally retires photos. Existing mitigation (pre-push hook) catches this; we keep that.
4. **Agent prompt drift.** Long prompts degrade. Mitigation: the 9-step structure is numbered and tight. The scheduler and validator carry the rules that must be enforced, so the prompt can drift without producing invalid output.
5. **GitHub Pages cold-deploy.** First time the workflow runs we need Pages source set to "GitHub Actions". The agent's first run after Phase 0 sets this with `gh api repos/:owner/:repo/pages -X POST -f build_type=workflow` or equivalent.
