# Travel Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OpenCode subagent that generates Bali-style trip pages for any destination, deployed via GitHub Pages.

**Architecture:** A subagent prompt at `.opencode/agent/travel-agent.md` does live research (English + social `site:` searches + mandatory local-language sweep), feeds a trip-spec JSON to a deterministic Node scheduler, fills a strict HTML template with placeholders, runs image + structural validators, then commits to `main` where a GitHub Actions workflow rebuilds the root trips index and deploys to Pages. The existing Bali page is moved to `trips/bali-march-2027/` and regenerated through the agent as a dogfood test.

**Tech Stack:** OpenCode subagent (Opus 4.7), Node 20 ESM (zero-deps), Bash, GitHub Actions, Unsplash hotlinks, vanilla ES2020 JS in the browser.

## Global Constraints

- **Pacing:** alternate active/rest days, day after any transfer is forced to rest, never two consecutive active days.
- **Drive cap:** every active day's activity must be ≤ 60 min one-way from that day's hotel.
- **Dinner per day:** every day has exactly one dinner pick.
- **Splurge count:** 2–3 splurges per trip, never on transfer days, never back-to-back.
- **Hotel mix:** mostly budget ($30–100/night), at least one luxury infinity-pool villa per trip (relax to "luxury villa with pool" with a note if no infinity pool found).
- **Activities per region:** 6–10 in the pool; restaurants per region: 6–8.
- **Day count:** use user-provided dates, else 14 days from first of next month. Cap at 21. Below 4 days, skip alternation.
- **Research mandatory:** English + social signal sweep (`site:tiktok.com / site:reddit.com / site:youtube.com / site:instagram.com`) + local-language sweep with translated quotes surfaced.
- **Images:** Unsplash hotlinks only, validated 200 OK before commit, up to 3 retries per image.
- **Output path:** `trips/<slug>/index.html`. Each page fully self-contained (inline `<style>`, inline `<script>`).
- **Deployment:** GitHub Pages via Actions workflow, source set to "GitHub Actions". The live URL `https://mrafik92.github.io/bali-honeymoon/` must stay alive.
- **Repo identity:** repo name `bali-honeymoon` stays on GitHub for URL stability; git author is `Mahmoud Rafik <mrafik3@outlook.com>` per existing history.
- **No new runtime deps:** all Node scripts are ESM with zero npm dependencies (use built-in `fs`, `path`, `process`).
- **Frequent commits:** commit after each task. Commit messages follow existing style (lowercase prefix, terse subject, e.g. `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`).

---

## Task 0: Install Node 20 locally and verify toolchain

**Files:**
- None (system setup task)

**Interfaces:**
- Consumes: nothing
- Produces: working `node` (≥ v20) and `npm` (≥ v10) on PATH, working `git`, `curl`, `rg` (already verified present)

- [ ] **Step 1: Detect what's installed**

Run:
```bash
node --version 2>/dev/null || echo "no node"
which curl rg git bash
```
Expected: `curl`, `rg`, `git`, `bash` all resolve to absolute paths. `node` likely says "no node" — that's fine, next steps install it.

- [ ] **Step 2: Install Node 20 via the official tarball (no sudo required)**

Run:
```bash
mkdir -p ~/.local/node
curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz -o /tmp/node.tar.xz
tar -xJf /tmp/node.tar.xz -C ~/.local/node --strip-components=1
echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> ~/.zshrc
export PATH="$HOME/.local/node/bin:$PATH"
```

- [ ] **Step 3: Verify the install**

Run:
```bash
node --version
npm --version
```
Expected:
```
v20.18.0
10.x.x
```

- [ ] **Step 4: No commit — local environment change only**

Nothing to commit. Move to Task 1.

---

## Task 1: Move existing Bali page into `trips/bali-march-2027/`

**Files:**
- Move: `index.html` → `trips/bali-march-2027/index.html`
- Move: `check-images.sh` → `scripts/check-images.sh`

**Interfaces:**
- Consumes: nothing
- Produces: a `trips/bali-march-2027/index.html` (byte-identical to old root `index.html`) and a `scripts/check-images.sh` that still works on its old hardcoded path (generalized in Task 2)

- [ ] **Step 1: Create the new directories**

Run:
```bash
mkdir -p trips/bali-march-2027 scripts
ls -la trips scripts
```
Expected: both directories exist and are empty.

- [ ] **Step 2: Move the files with `git mv` to preserve history**

Run:
```bash
git mv index.html trips/bali-march-2027/index.html
git mv check-images.sh scripts/check-images.sh
git status
```
Expected:
```
renamed: check-images.sh -> scripts/check-images.sh
renamed: index.html -> trips/bali-march-2027/index.html
```

- [ ] **Step 3: Sanity-check the moved page renders the same**

Run:
```bash
wc -l trips/bali-march-2027/index.html
head -10 trips/bali-march-2027/index.html
```
Expected: 953 lines (matches pre-move), first line is `<!DOCTYPE html>`, line 6 is `<title>Our Bali Honeymoon — March 2027</title>`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move Bali page into trips/ subfolder

Prep for multi-trip layout. The page itself is unchanged; only its
path moved. check-images.sh moved to scripts/ as well — still
hardcoded to look at the old index.html path (generalized in next
task)."
```

---

## Task 2: Generalize `check-images.sh` to take an HTML file argument

**Files:**
- Modify: `scripts/check-images.sh` (replace entire contents)
- Test: manual run against `trips/bali-march-2027/index.html`

**Interfaces:**
- Consumes: nothing
- Produces: `scripts/check-images.sh <html-file>` — exits 0 if all Unsplash photo URLs in the file return HTTP 200, non-zero otherwise. Prints `OK <photo-id>` per image, `BROKEN (<code>) <url>` for failures.

- [ ] **Step 1: Replace the script with the generalized version**

Write to `scripts/check-images.sh`:

```bash
#!/bin/bash
# Usage: check-images.sh <html-file>
# Greps all images.unsplash.com photo IDs from the file, fetches each as a
# small thumbnail, asserts HTTP 200 on every one. Exits non-zero if any image
# is broken.

set -u
FILE="${1:?Usage: check-images.sh <html-file>}"

if [ ! -f "$FILE" ]; then
  echo "error: file not found: $FILE" >&2
  exit 2
fi

FAIL=0
while read -r id; do
  url="https://${id}?auto=format&fit=crop&w=100&q=80"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$url" 2>/dev/null || echo "000")
  if [ "$code" != "200" ]; then
    echo "BROKEN ($code) $url"
    FAIL=1
  else
    echo "OK $id"
  fi
done < <(rg -o 'images\.unsplash\.com/photo-[a-zA-Z0-9_-]+' "$FILE" --no-filename | sort -u)

exit $FAIL
```

- [ ] **Step 2: Make sure it's executable**

Run:
```bash
chmod +x scripts/check-images.sh
ls -la scripts/check-images.sh
```
Expected: `-rwxr-xr-x` permissions.

- [ ] **Step 3: Run it against the Bali page**

Run:
```bash
bash scripts/check-images.sh trips/bali-march-2027/index.html
echo "exit: $?"
```
Expected: many `OK photo-…` lines, final `exit: 0`. No `BROKEN` lines (history shows all images were repaired in commit `da3894c`).

- [ ] **Step 4: Verify error handling for a missing file**

Run:
```bash
bash scripts/check-images.sh /tmp/does-not-exist.html
echo "exit: $?"
```
Expected: `error: file not found: /tmp/does-not-exist.html` on stderr, `exit: 2`.

- [ ] **Step 5: Verify missing-argument behavior**

Run:
```bash
bash scripts/check-images.sh
echo "exit: $?"
```
Expected: bash prints `scripts/check-images.sh: line N: 1: Usage: check-images.sh <html-file>` (or similar from the `${1:?...}` syntax) and exits non-zero.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-images.sh
git commit -m "feat: generalize check-images.sh to take a file argument

Takes <html-file> as its first arg instead of hardcoding index.html.
Returns exit 2 for missing-file, exit 1 for any broken image, exit 0
on full success. Prep for multi-trip layout."
```

---

## Task 3: Write `scripts/build-index.mjs` — root trips listing generator

**Files:**
- Create: `scripts/build-index.mjs`
- Output (written by the script when run): `index.html` at repo root

**Interfaces:**
- Consumes: `trips/*/index.html` files, each containing a `<script id="trip-data" type="application/json">{...}</script>` block (regenerated trips will have one; the existing Bali file does NOT yet — script must tolerate that and fall back to scraping `<title>` and the first `<img class="img-banner">`).
- Produces: writes `index.html` at repo root listing each trip as a card sorted by `startDate` ascending. Includes `<meta http-equiv="refresh" content="3; url=trips/bali-march-2027/">` for old-URL preservation.

- [ ] **Step 1: Write the script**

Write to `scripts/build-index.mjs`:

```javascript
#!/usr/bin/env node
// Generates the root index.html listing all trips/*/ subfolders.
// Reads `#trip-data` JSON when present, falls back to scraping <title> + hero <img>.
// Sorts by startDate ascending; falls back to folder name when startDate is missing.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TRIPS_DIR = "trips";
const OUT = "index.html";
const DEFAULT_REDIRECT_SLUG = "bali-march-2027";

function extractTripData(html) {
  const m = html.match(/<script id="trip-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function extractTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function extractHero(html) {
  // Try img-banner first, then any hero-class image, then any image.
  let m = html.match(/<img[^>]*class="[^"]*img-banner[^"]*"[^>]*src="([^"]+)"/);
  if (m) return m[1];
  m = html.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*img-banner[^"]*"/);
  if (m) return m[1];
  m = html.match(/<img[^>]*src="(https:\/\/images\.unsplash\.com\/[^"]+)"/);
  return m ? m[1] : "";
}

function extractHeroH1(html) {
  const m = html.match(/<h1>([^<]+)<\/h1>/);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&mdash;/g, "—").trim() : "";
}

function collectTrips() {
  if (!existsSync(TRIPS_DIR)) return [];
  return readdirSync(TRIPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const slug = d.name;
      const file = join(TRIPS_DIR, slug, "index.html");
      if (!existsSync(file)) return null;
      const html = readFileSync(file, "utf8");
      const td = extractTripData(html);
      return {
        slug,
        title: td?.title || extractHeroH1(html) || extractTitle(html) || slug,
        subtitle: td?.datesLong || "",
        startDate: td?.startDate || "",
        endDate: td?.endDate || "",
        hero: td?.heroImg || extractHero(html),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.startDate || a.slug).localeCompare(b.startDate || b.slug));
}

function renderCard(t) {
  const heroStyle = t.hero ? ` style="background-image:url('${t.hero}')"` : "";
  return `    <a class="trip-card" href="trips/${t.slug}/">
      <div class="trip-hero"${heroStyle}></div>
      <div class="trip-body">
        <h2>${t.title}</h2>
        <p>${t.subtitle || ""}</p>
      </div>
    </a>`;
}

function renderIndex(trips) {
  const redirectSlug = trips.find((t) => t.slug === DEFAULT_REDIRECT_SLUG)
    ? DEFAULT_REDIRECT_SLUG
    : trips[0]?.slug;
  const refresh = redirectSlug
    ? `  <meta http-equiv="refresh" content="3; url=trips/${redirectSlug}/">\n`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Our Trips</title>
${refresh}  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;font-weight:300;color:#1a1a2e;background:#faf9f7;line-height:1.7;padding:48px 24px;min-height:100vh}
    h1,h2{font-family:'Playfair Display',serif;font-weight:600}
    .wrap{max-width:1100px;margin:0 auto}
    header{text-align:center;margin-bottom:48px}
    header h1{font-size:clamp(2rem,5vw,3.5rem);margin-bottom:8px}
    header p{color:#888;letter-spacing:2px;text-transform:uppercase;font-size:.85rem}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
    .trip-card{display:block;text-decoration:none;color:inherit;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.06);transition:transform .2s,box-shadow .2s}
    .trip-card:hover{transform:translateY(-4px);box-shadow:0 8px 24px rgba(0,0,0,.10)}
    .trip-hero{height:200px;background:#e8e3dd center/cover no-repeat}
    .trip-body{padding:20px}
    .trip-body h2{font-size:1.4rem;margin-bottom:6px}
    .trip-body p{color:#666;font-size:.95rem}
    .redirect-note{text-align:center;margin-top:48px;color:#aaa;font-size:.85rem}
    footer{text-align:center;margin-top:64px;color:#b8865b;font-size:.9rem}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Our Trips</h1>
      <p>Honeymoon planning &middot; built with love</p>
    </header>
    <div class="grid">
${trips.map(renderCard).join("\n")}
    </div>
${redirectSlug ? `    <p class="redirect-note">Redirecting to <a href="trips/${redirectSlug}/">${redirectSlug}</a> in 3 seconds&hellip;</p>\n` : ""}    <footer>&hearts; &hearts; &hearts;</footer>
  </div>
</body>
</html>
`;
}

const trips = collectTrips();
if (trips.length === 0) {
  console.error("no trips found under trips/*/index.html");
  process.exit(1);
}
writeFileSync(OUT, renderIndex(trips));
console.error(`wrote ${OUT} with ${trips.length} trip(s): ${trips.map((t) => t.slug).join(", ")}`);
```

- [ ] **Step 2: Run it locally**

Run:
```bash
node scripts/build-index.mjs
```
Expected stderr: `wrote index.html with 1 trip(s): bali-march-2027`.

- [ ] **Step 3: Inspect the generated `index.html`**

Run:
```bash
wc -l index.html
head -20 index.html
rg 'bali-march-2027' index.html | head -5
```
Expected: ~60–80 lines, `<title>Our Trips</title>` present, `<meta http-equiv="refresh"` line present, a `trips/bali-march-2027/` link present.

- [ ] **Step 4: Open it in a quick local check (optional, if a browser is available)**

Run:
```bash
python3 -m http.server 8765 --bind 127.0.0.1 &
SERVER_PID=$!
sleep 1
curl -s http://127.0.0.1:8765/ | rg -c 'bali-march-2027'
kill $SERVER_PID 2>/dev/null
```
Expected: count > 0 (the link is in the served page).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-index.mjs index.html
git commit -m "feat: add scripts/build-index.mjs and root trips listing

build-index.mjs scans trips/*/index.html and writes a root index.html
that lists every trip as a card. Reads #trip-data JSON when present,
falls back to scraping <title> + hero <img> for legacy pages. Includes
a 3-second meta-refresh to trips/bali-march-2027/ to preserve the old
URL for anyone hitting https://mrafik92.github.io/bali-honeymoon/."
```

---

## Task 4: Add the GitHub Pages workflow

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `trips/*/index.html`, `scripts/build-index.mjs`, `scripts/validate-page.mjs` (Task 8), `scripts/check-images.sh`
- Produces: on every push to `main`, deploys a `_site/` artifact (containing the root `index.html` + `trips/` + `.nojekyll`) to GitHub Pages.

**Note:** Task 4 references `scripts/validate-page.mjs` which doesn't exist yet (built in Task 8). For now the workflow's `validate-page.mjs` step will fail, so this task gates the validation step behind `if: hashFiles('scripts/validate-page.mjs') != ''` — it runs when the file exists, skips when it doesn't. Same trick for image check on multi-trip globbing (it'll just run on Bali for now).

- [ ] **Step 1: Create the workflow file**

Run:
```bash
mkdir -p .github/workflows
```

Write to `.github/workflows/pages.yml`:

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
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Rebuild trips index
        run: node scripts/build-index.mjs

      - name: Validate every trip page (skip legacy pages without #trip-data)
        if: hashFiles('scripts/validate-page.mjs') != ''
        run: |
          for f in trips/*/index.html; do
            if grep -q 'id="trip-data"' "$f"; then
              node scripts/validate-page.mjs "$f"
            else
              echo "skipping validation: $f has no #trip-data (legacy page)"
            fi
          done

      - name: Check images on every trip page (always)
        run: |
          for f in trips/*/index.html; do
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

- [ ] **Step 2: Set Pages source to "GitHub Actions" via the API**

Run:
```bash
gh api -X POST repos/mrafik92/bali-honeymoon/pages -f build_type=workflow 2>&1 || \
  gh api -X PUT  repos/mrafik92/bali-honeymoon/pages -f build_type=workflow
```
Expected: 200 / 204 response. (POST creates, PUT updates — one of them succeeds depending on whether Pages was already enabled with a different source.)

- [ ] **Step 3: Commit the workflow**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: deploy GitHub Pages via Actions workflow

On every push to main: rebuild root trips index, validate trip pages
(when validate-page.mjs exists), check all Unsplash images return 200,
stage publishable files into _site/, deploy to Pages. Source switched
from 'branch' to 'GitHub Actions' via gh api."
```

- [ ] **Step 4: Push and watch the first Action run**

Run:
```bash
git push
gh run watch --exit-status
```
Expected: workflow succeeds (green check). Image check passes for the Bali page. `index.html` is regenerated but unchanged → no commit-rebuilt-index step fires.

- [ ] **Step 5: Verify the live site**

Run:
```bash
sleep 30
curl -sI https://mrafik92.github.io/bali-honeymoon/ | head -3
curl -s  https://mrafik92.github.io/bali-honeymoon/ | rg -c 'trips/bali-march-2027'
curl -sI https://mrafik92.github.io/bali-honeymoon/trips/bali-march-2027/ | head -3
```
Expected: root returns `HTTP/2 200`, contains `trips/bali-march-2027` link, and the trip subpath also returns `HTTP/2 200`.

- [ ] **Step 6: No additional commit — Step 4 already pushed.**

---

## Task 5: Add the pre-push image-check git hook

**Files:**
- Create: `.git/hooks/pre-push` (not tracked by git, but documented in repo)
- Create: `scripts/install-hooks.sh` (idempotent setup helper that future contributors can run)

**Interfaces:**
- Consumes: `scripts/check-images.sh`
- Produces: a pre-push hook that loops over `trips/*/index.html` and the root `index.html`, aborting the push if any image is broken.

- [ ] **Step 1: Write the installer**

Write to `scripts/install-hooks.sh`:

```bash
#!/bin/bash
# Installs git hooks for this repo. Run once after cloning.
set -e
ROOT=$(git rev-parse --show-toplevel)
HOOK="$ROOT/.git/hooks/pre-push"

cat > "$HOOK" <<'EOF'
#!/bin/bash
# Pre-push: assert all Unsplash images on every trip page (and root index)
# return HTTP 200. Aborts the push if any are broken.
set -e
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

FAIL=0
for f in index.html trips/*/index.html; do
  [ -f "$f" ] || continue
  echo "→ checking $f"
  if ! bash scripts/check-images.sh "$f" > /tmp/check-out 2>&1; then
    echo "✗ broken images in $f:"
    grep BROKEN /tmp/check-out || cat /tmp/check-out
    FAIL=1
  fi
done

if [ $FAIL -ne 0 ]; then
  echo "pre-push aborted — fix broken images or run with --no-verify to bypass."
  exit 1
fi
EOF

chmod +x "$HOOK"
echo "installed: $HOOK"
```

- [ ] **Step 2: Make the installer executable and run it**

Run:
```bash
chmod +x scripts/install-hooks.sh
bash scripts/install-hooks.sh
ls -la .git/hooks/pre-push
```
Expected: `installed: <path>/.git/hooks/pre-push` and the hook file exists with `-rwx` permissions.

- [ ] **Step 3: Test the hook works (dry-run)**

Run:
```bash
bash .git/hooks/pre-push
echo "exit: $?"
```
Expected: prints `→ checking ...` lines and `OK photo-…` lines, final `exit: 0`.

- [ ] **Step 4: Commit the installer**

```bash
git add scripts/install-hooks.sh
git commit -m "feat: add scripts/install-hooks.sh

Idempotent installer for the pre-push image-check hook. Future
contributors run \`bash scripts/install-hooks.sh\` once after cloning."
```

---

## Task 6: Write the deterministic scheduler `scripts/build-schedule.mjs`

**Files:**
- Create: `scripts/build-schedule.mjs`
- Create: `scripts/__tests__/build-schedule.test.mjs`
- Create: `scripts/__tests__/fixtures/bali-spec.json` (a hand-written Bali trip-spec for testing)

**Interfaces:**
- Consumes: a trip-spec JSON via stdin or file path. Shape:
  ```ts
  type TripSpec = {
    tripSlug: string,
    startDate: string,         // ISO date "YYYY-MM-DD"
    endDate: string,           // ISO date, inclusive
    seed: number,              // any int, deterministic
    regions: { id: string, name: string, nightsRange: [number, number] }[],
    hotels: { [regionId: string]: string },  // hotel id chosen per region
    activities: { [regionId: string]: { id: string, name: string, score: number, drive: { [hotelId: string]: number } }[] },
    restaurants: { [regionId: string]: { id: string, name: string, tier: "cheap"|"mid"|"splurge", drive: { [hotelId: string]: number } }[] },
    splurgeCount: number,      // 2 or 3
    driveCapMinutes: number,   // 60
    restSuggestions: string[]  // soft suggestions for rest days
  }
  ```
- Produces: a day-plan JSON, an array of:
  ```ts
  type Day = {
    n: number,                 // 1-indexed
    date: string,              // ISO
    region: string,            // region id
    status: "active"|"rest"|"transfer",
    activityId: string | null, // null on rest/transfer
    dinnerId: string | null,   // can be null only on transfer (rare)
    restSuggestion: string | null  // only on rest days
  }
  ```
- CLI: `node scripts/build-schedule.mjs <spec.json>` reads the file and writes the day plan to stdout as JSON.

- [ ] **Step 1: Write the fixture**

Run:
```bash
mkdir -p scripts/__tests__/fixtures
```

Write to `scripts/__tests__/fixtures/bali-spec.json`:

```json
{
  "tripSlug": "bali-march-2027",
  "startDate": "2027-03-01",
  "endDate": "2027-03-14",
  "seed": 1,
  "regions": [
    { "id": "ubud", "name": "Ubud", "nightsRange": [5, 6] },
    { "id": "penida", "name": "Nusa Penida", "nightsRange": [2, 3] },
    { "id": "seminyak", "name": "Seminyak", "nightsRange": [4, 5] }
  ],
  "hotels": {
    "ubud": "eden-house",
    "penida": "kamasan",
    "seminyak": "hepburn"
  },
  "activities": {
    "ubud": [
      { "id": "tegalalang", "name": "Tegalalang Rice Terraces", "score": 9, "drive": { "eden-house": 22 } },
      { "id": "campuhan",   "name": "Campuhan Ridge Walk",      "score": 8, "drive": { "eden-house": 5 } },
      { "id": "monkey",     "name": "Sacred Monkey Forest",     "score": 8, "drive": { "eden-house": 8 } },
      { "id": "tirta",      "name": "Tirta Empul",              "score": 7, "drive": { "eden-house": 35 } },
      { "id": "tegenungan", "name": "Tegenungan Waterfall",     "score": 7, "drive": { "eden-house": 18 } },
      { "id": "cooking",    "name": "Balinese Cooking Class",   "score": 9, "drive": { "eden-house": 10 } },
      { "id": "spa",        "name": "Couples Spa",              "score": 7, "drive": { "eden-house": 5 } }
    ],
    "penida": [
      { "id": "kelingking", "name": "Kelingking Beach",         "score": 10, "drive": { "kamasan": 35 } },
      { "id": "broken",     "name": "Broken Beach & Angel's Billabong", "score": 8, "drive": { "kamasan": 40 } },
      { "id": "crystal",    "name": "Crystal Bay",              "score": 7, "drive": { "kamasan": 25 } },
      { "id": "diamond",    "name": "Diamond Beach",            "score": 8, "drive": { "kamasan": 50 } },
      { "id": "manta",      "name": "Snorkeling with Mantas",   "score": 9, "drive": { "kamasan": 20 } }
    ],
    "seminyak": [
      { "id": "potato",     "name": "Sunset at Potato Head",    "score": 9, "drive": { "hepburn": 8 } },
      { "id": "beach",      "name": "Seminyak Beach",           "score": 8, "drive": { "hepburn": 5 } },
      { "id": "eat-street", "name": "Eat Street (Jl. Kayu Aya)","score": 7, "drive": { "hepburn": 3 } },
      { "id": "brunch",     "name": "Revolver Brunch",          "score": 7, "drive": { "hepburn": 6 } },
      { "id": "spa-sem",    "name": "Couples Spa Day",          "score": 8, "drive": { "hepburn": 4 } },
      { "id": "uluwatu",    "name": "Uluwatu Sunset Kecak",     "score": 9, "drive": { "hepburn": 55 } }
    ]
  },
  "restaurants": {
    "ubud": [
      { "id": "ibu-oka",    "name": "Warung Babi Guling Ibu Oka", "tier": "cheap", "drive": { "eden-house": 8 } },
      { "id": "warung-bu",  "name": "Warung Bu Mangku",           "tier": "cheap", "drive": { "eden-house": 12 } },
      { "id": "locavore",   "name": "Locavore",                   "tier": "splurge", "drive": { "eden-house": 6 } },
      { "id": "naughty-nu", "name": "Naughty Nuri's",             "tier": "mid",   "drive": { "eden-house": 9 } }
    ],
    "penida": [
      { "id": "penida-co",  "name": "Penida Colada",              "tier": "cheap", "drive": { "kamasan": 15 } },
      { "id": "warung-pa",  "name": "Warung Pak Made",            "tier": "cheap", "drive": { "kamasan": 6 } },
      { "id": "amok",       "name": "Amok Sunset",                "tier": "splurge", "drive": { "kamasan": 30 } }
    ],
    "seminyak": [
      { "id": "made-warung","name": "Made's Warung",              "tier": "cheap", "drive": { "hepburn": 4 } },
      { "id": "warung-eny", "name": "Warung Eny",                 "tier": "cheap", "drive": { "hepburn": 7 } },
      { "id": "mejekawi",   "name": "Mejekawi at Ku De Ta",       "tier": "splurge", "drive": { "hepburn": 8 } },
      { "id": "motel-mex",  "name": "Motel Mexicola",             "tier": "mid",   "drive": { "hepburn": 5 } }
    ]
  },
  "splurgeCount": 3,
  "driveCapMinutes": 60,
  "restSuggestions": [
    "Pool & book",
    "Couples spa near hotel",
    "Short walk in the neighborhood",
    "Sunset cocktail at hotel bar",
    "Late breakfast and lazy morning"
  ]
}
```

- [ ] **Step 2: Write the failing test FIRST (TDD)**

Write to `scripts/__tests__/build-schedule.test.mjs`:

```javascript
// Test the scheduler against the Bali fixture. Pure Node, no test framework —
// just `assert` from node:assert and a tiny runner. Run with: node scripts/__tests__/build-schedule.test.mjs
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
  // Ubud → Penida and Penida → Seminyak: each is a transfer day.
  const transfers = days.filter(d => d.status === "transfer").map(d => d.n);
  // Day 1 (arrival), days near the region transitions, day 14 (departure)
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
```

- [ ] **Step 3: Run the test, confirm it fails because `build-schedule.mjs` doesn't exist yet**

Run:
```bash
node scripts/__tests__/build-schedule.test.mjs
echo "exit: $?"
```
Expected: `Cannot find module .../build-schedule.mjs` error, `exit: 1`.

- [ ] **Step 4: Implement the scheduler**

Write to `scripts/build-schedule.mjs`:

```javascript
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
    // Last region absorbs remainder
    const isLast = i === spec.regions.length - 1;
    const count = isLast ? N - cursor : Math.max(1, Math.round((r.nightsRange[0] / totalNights) * N));
    for (let k = 0; k < count && cursor + k < N; k++) dayRegion[cursor + k] = r.id;
    cursor += count;
  }
  while (cursor < N) { dayRegion[cursor] = spec.regions[spec.regions.length - 1].id; cursor++; }

  // Step 2: status per day
  const status = new Array(N);
  for (let i = 0; i < N; i++) status[i] = "tbd";
  status[0] = "transfer";
  status[N - 1] = "transfer";
  // Region boundaries: the LAST day in region X (when next day is region Y) is transfer
  for (let i = 0; i < N - 1; i++) {
    if (dayRegion[i] !== dayRegion[i + 1]) status[i + 1] = "transfer"; // arrival day in new region
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
      .sort((a, b) => b.score - a.score || (rng() - 0.5));
    // Stable shuffle within equal score groups via mulberry
    shuffleInPlace(eligible.filter((_, i, arr) => i > 0 && arr[i - 1].score === eligible[i].score), rng);
    const pool = eligible.map(a => a.id);
    let pi = 0;
    for (let i = 0; i < N; i++) {
      if (dayRegion[i] !== region.id) continue;
      if (status[i] !== "active") continue;
      if (pi >= pool.length) { status[i] = "rest"; continue; } // exhausted → downgrade
      activityByDay[i] = pool[pi++];
    }
  }

  // Step 4: assign dinners
  const dinnerByDay = new Array(N).fill(null);

  // Collect candidate "last active day in each region" for splurges
  const lastActivePerRegion = {};
  for (let i = 0; i < N; i++) {
    if (status[i] === "active") lastActivePerRegion[dayRegion[i]] = i;
  }
  const splurgeTargets = Object.values(lastActivePerRegion).slice(0, spec.splurgeCount);

  // Pick splurges
  const splurgeUsedRegion = new Set();
  for (const idx of splurgeTargets) {
    const region = dayRegion[idx];
    const hotel = spec.hotels[region];
    const splurges = (spec.restaurants[region] || [])
      .filter(r => r.tier === "splurge" && !splurgeUsedRegion.has(`${region}:${r.id}`))
      .sort((a, b) => (a.drive[hotel] ?? Infinity) - (b.drive[hotel] ?? Infinity));
    if (!splurges.length) continue;
    // Avoid back-to-back: check neighbors
    const prev = idx > 0 ? dinnerByDay[idx - 1] : null;
    const next = idx < N - 1 ? dinnerByDay[idx + 1] : null;
    const prevIsSplurge = prev && (spec.restaurants[dayRegion[idx - 1]] || []).find(r => r.id === prev)?.tier === "splurge";
    const nextIsSplurge = next && (spec.restaurants[dayRegion[idx + 1]] || []).find(r => r.id === next)?.tier === "splurge";
    if (prevIsSplurge || nextIsSplurge) continue;
    dinnerByDay[idx] = splurges[0].id;
    splurgeUsedRegion.add(`${region}:${splurges[0].id}`);
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

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error("Usage: build-schedule.mjs <spec.json>"); process.exit(2); }
  const spec = JSON.parse(readFileSync(file, "utf8"));
  const days = buildSchedule(spec);
  process.stdout.write(JSON.stringify(days, null, 2) + "\n");
}
```

- [ ] **Step 5: Run the tests, confirm all pass**

Run:
```bash
node scripts/__tests__/build-schedule.test.mjs
echo "exit: $?"
```
Expected: every line is `✓ <name>`, final `exit: 0`. If any `✗` appears, fix the scheduler before moving on.

- [ ] **Step 6: Manual smoke test of the CLI**

Run:
```bash
node scripts/build-schedule.mjs scripts/__tests__/fixtures/bali-spec.json | head -30
```
Expected: prints a JSON array. First object has `"n": 1, "status": "transfer"`. The dates step from `2027-03-01` to `2027-03-14`.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-schedule.mjs scripts/__tests__/
git commit -m "feat: deterministic trip scheduler with self-tests

scripts/build-schedule.mjs takes a trip-spec JSON, returns a day plan
that respects pacing (alt active/rest with extra rest after transfer),
60-min drive cap, splurge distribution (one per region, never on
transfer, never back-to-back). Seeded PRNG (mulberry32) means same
input → same output. Includes a fixture (Bali) and 15 self-tests."
```

---

## Task 7: Write the page validator `scripts/validate-page.mjs`

**Files:**
- Create: `scripts/validate-page.mjs`
- Create: `scripts/__tests__/validate-page.test.mjs`
- Create: `scripts/__tests__/fixtures/valid-page.html` (a minimal hand-written page that should pass)
- Create: `scripts/__tests__/fixtures/invalid-pages/` (5 small broken pages, one per failure class)

**Interfaces:**
- Consumes: a generated `trips/<slug>/index.html` file path on argv.
- Produces: exits 0 on success (prints one-line summary to stderr), exit 1 on most failures, exit 2 specifically when the only violation is "no infinity-pool villa" (so the agent can relax that constraint and retry).
- CLI: `node scripts/validate-page.mjs <html-file>`

**The 12 checks (from spec §6):** (1) `#trip-data` parses, (2) `days.length` matches date range, (3) day numbers 1..N no gaps, (4) pacing rules, (5) drive cap, (6) no activity reuse per region, (7) splurge count ±1, (8) every day has dinnerId, (9) infinity-pool villa present (special exit 2), (10) HTML tag balance, (11) nav anchors match ids, (12) no `{{XXX}}` placeholders left.

- [ ] **Step 1: Write the valid fixture (minimal page passing all checks)**

Write to `scripts/__tests__/fixtures/valid-page.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Test Trip</title>
</head>
<body>
<nav><a href="#overview">Overview</a> <a href="#dayplan">Plan</a></nav>
<section id="overview"><div>x</div></section>
<section id="dayplan"><div>x</div></section>
<article aria-label="Day 1, transfer, arrival">
  Hotel: A villa with Infinity Pool and breakfast.
</article>
<script id="trip-data" type="application/json">
{
  "tripSlug": "test",
  "seed": 1,
  "startDate": "2027-03-01",
  "endDate": "2027-03-03",
  "regionHotel": { "r": "h1" },
  "activities": { "r": [{ "id": "a1", "name": "x", "drive": { "h1": 10 } }] },
  "restaurants": { "r": [
    { "id": "d1", "name": "d", "tier": "cheap", "drive": { "h1": 5 } },
    { "id": "d2", "name": "s", "tier": "splurge", "drive": { "h1": 8 } }
  ] },
  "days": [
    { "n": 1, "date": "2027-03-01", "region": "r", "status": "transfer", "activityId": null, "dinnerId": "d1", "restSuggestion": null },
    { "n": 2, "date": "2027-03-02", "region": "r", "status": "active",   "activityId": "a1",  "dinnerId": "d2", "restSuggestion": null },
    { "n": 3, "date": "2027-03-03", "region": "r", "status": "transfer", "activityId": null, "dinnerId": "d1", "restSuggestion": null }
  ]
}
</script>
</body>
</html>
```

- [ ] **Step 2: Write the invalid fixtures**

Run:
```bash
mkdir -p scripts/__tests__/fixtures/invalid-pages
```

Write to `scripts/__tests__/fixtures/invalid-pages/no-trip-data.html`:
```html
<!DOCTYPE html><html><head><title>X</title></head><body><nav></nav></body></html>
```

Write to `scripts/__tests__/fixtures/invalid-pages/bad-pacing.html`:
(copy of valid-page.html but with two consecutive active days — easy way is to flip day 1 from transfer to active and day 2 to active)
```html
<!DOCTYPE html><html><head><title>X</title></head><body>
<nav><a href="#x">x</a></nav><section id="x"></section>
<p>Infinity Pool villa</p>
<script id="trip-data" type="application/json">
{ "tripSlug":"t","startDate":"2027-03-01","endDate":"2027-03-02","regionHotel":{"r":"h"},
  "activities":{"r":[{"id":"a","drive":{"h":5}},{"id":"b","drive":{"h":5}}]},
  "restaurants":{"r":[{"id":"d","tier":"cheap","drive":{"h":5}}]},
  "days":[
    {"n":1,"date":"2027-03-01","region":"r","status":"active","activityId":"a","dinnerId":"d","restSuggestion":null},
    {"n":2,"date":"2027-03-02","region":"r","status":"active","activityId":"b","dinnerId":"d","restSuggestion":null}
  ]}
</script></body></html>
```

Write to `scripts/__tests__/fixtures/invalid-pages/drive-cap.html`:
```html
<!DOCTYPE html><html><head><title>X</title></head><body>
<nav><a href="#x">x</a></nav><section id="x"></section>
<p>Infinity Pool villa</p>
<script id="trip-data" type="application/json">
{ "tripSlug":"t","startDate":"2027-03-01","endDate":"2027-03-01","regionHotel":{"r":"h"},
  "activities":{"r":[{"id":"a","drive":{"h":120}}]},
  "restaurants":{"r":[{"id":"d","tier":"cheap","drive":{"h":5}}]},
  "days":[{"n":1,"date":"2027-03-01","region":"r","status":"active","activityId":"a","dinnerId":"d","restSuggestion":null}]}
</script></body></html>
```

Write to `scripts/__tests__/fixtures/invalid-pages/no-infinity-pool.html`:
(valid in every way EXCEPT no "Infinity Pool" string anywhere)
```html
<!DOCTYPE html><html><head><title>X</title></head><body>
<nav><a href="#x">x</a></nav><section id="x"></section>
<p>Just a budget guesthouse, no pool.</p>
<script id="trip-data" type="application/json">
{ "tripSlug":"t","startDate":"2027-03-01","endDate":"2027-03-01","regionHotel":{"r":"h"},
  "activities":{"r":[{"id":"a","drive":{"h":5}}]},
  "restaurants":{"r":[{"id":"d","tier":"cheap","drive":{"h":5}}]},
  "days":[{"n":1,"date":"2027-03-01","region":"r","status":"transfer","activityId":null,"dinnerId":"d","restSuggestion":null}]}
</script></body></html>
```

Write to `scripts/__tests__/fixtures/invalid-pages/placeholder-left.html`:
```html
<!DOCTYPE html><html><head><title>{{TITLE}}</title></head><body>
<nav><a href="#x">x</a></nav><section id="x"></section>
<p>Infinity Pool villa</p>
<script id="trip-data" type="application/json">
{ "tripSlug":"t","startDate":"2027-03-01","endDate":"2027-03-01","regionHotel":{"r":"h"},
  "activities":{"r":[]},"restaurants":{"r":[{"id":"d","tier":"cheap","drive":{"h":5}}]},
  "days":[{"n":1,"date":"2027-03-01","region":"r","status":"transfer","activityId":null,"dinnerId":"d","restSuggestion":null}]}
</script></body></html>
```

Write to `scripts/__tests__/fixtures/invalid-pages/missing-nav-anchor.html`:
```html
<!DOCTYPE html><html><head><title>X</title></head><body>
<nav><a href="#missing">x</a></nav><section id="exists"></section>
<p>Infinity Pool villa</p>
<script id="trip-data" type="application/json">
{ "tripSlug":"t","startDate":"2027-03-01","endDate":"2027-03-01","regionHotel":{"r":"h"},
  "activities":{"r":[]},"restaurants":{"r":[{"id":"d","tier":"cheap","drive":{"h":5}}]},
  "days":[{"n":1,"date":"2027-03-01","region":"r","status":"transfer","activityId":null,"dinnerId":"d","restSuggestion":null}]}
</script></body></html>
```

- [ ] **Step 3: Write the failing test FIRST (TDD)**

Write to `scripts/__tests__/validate-page.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function run(file) {
  try {
    const out = execFileSync("node", ["scripts/validate-page.mjs", file], { stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout: out.toString(), stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

test("valid page exits 0", () => {
  const r = run("scripts/__tests__/fixtures/valid-page.html");
  assert.equal(r.code, 0, `got code ${r.code}, stderr:\n${r.stderr}`);
});

test("missing #trip-data exits 1", () => {
  const r = run("scripts/__tests__/fixtures/invalid-pages/no-trip-data.html");
  assert.equal(r.code, 1);
});

test("two consecutive active days fails pacing (exit 1)", () => {
  const r = run("scripts/__tests__/fixtures/invalid-pages/bad-pacing.html");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /pacing|consecutive active/i);
});

test("drive cap violation exits 1", () => {
  const r = run("scripts/__tests__/fixtures/invalid-pages/drive-cap.html");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /drive/i);
});

test("missing infinity pool exits 2 specifically", () => {
  const r = run("scripts/__tests__/fixtures/invalid-pages/no-infinity-pool.html");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /infinity pool/i);
});

test("unsubstituted {{PLACEHOLDER}} exits 1", () => {
  const r = run("scripts/__tests__/fixtures/invalid-pages/placeholder-left.html");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /placeholder|\{\{/);
});

test("nav anchor without matching id exits 1", () => {
  const r = run("scripts/__tests__/fixtures/invalid-pages/missing-nav-anchor.html");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /anchor|id/i);
});

test("missing file exits non-zero", () => {
  const r = run("scripts/__tests__/fixtures/does-not-exist.html");
  assert.notEqual(r.code, 0);
});
```

- [ ] **Step 4: Run the test, confirm it fails because `validate-page.mjs` doesn't exist**

Run:
```bash
node scripts/__tests__/validate-page.test.mjs
echo "exit: $?"
```
Expected: every test prints `✗`, `exit: 1`.

- [ ] **Step 5: Implement the validator**

Write to `scripts/validate-page.mjs`:

```javascript
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
```

- [ ] **Step 6: Run the tests, confirm all pass**

Run:
```bash
node scripts/__tests__/validate-page.test.mjs
echo "exit: $?"
```
Expected: every line `✓`, final `exit: 0`. If any `✗`, fix `validate-page.mjs` before continuing.

- [ ] **Step 7: Smoke-test against the Bali page (will fail many checks since Bali has no `#trip-data` yet)**

Run:
```bash
node scripts/validate-page.mjs trips/bali-march-2027/index.html
echo "exit: $?"
```
Expected: `exit: 1`, multiple `✗` lines including "missing <script id=\"trip-data\">". This is correct — Bali doesn't have the new data yet; it will once regenerated through the agent.

- [ ] **Step 8: Commit**

```bash
git add scripts/validate-page.mjs scripts/__tests__/validate-page.test.mjs scripts/__tests__/fixtures/
git commit -m "feat: page validator with self-tests

scripts/validate-page.mjs runs 12 structural checks on a generated
trip page: trip-data JSON shape, day count vs date range, pacing,
drive cap, no activity reuse, splurge count, dinner-per-day,
infinity-pool villa (exit 2 — distinguishable), tag balance, title,
nav anchors, no placeholders left. 8 self-tests cover the happy path
and 7 failure classes."
```

---

## Task 8: Extract the HTML template `templates/trip-page.html.tmpl`

**Files:**
- Create: `templates/trip-page.html.tmpl` (lifted from `trips/bali-march-2027/index.html`, with placeholders + new sections)

**Interfaces:**
- Consumes: nothing (it's a template, not a runtime artifact)
- Produces: the template the agent will fill. Recognizable substitutions: `{{TITLE}}`, `{{SUBTITLE}}`, `{{DATES_LONG}}`, `{{DATES_SHORT}}`, `{{HERO_VIDEO_URL}}`, `{{HERO_IMG}}`, `{{WEATHER_NOTE}}`, `{{TIMELINE_CARDS}}`, `{{NAV_LINKS}}`, `{{DAY_PLAN_SECTION}}`, `{{REGION_SECTIONS}}`, `{{TRIP_DATA_JSON}}`, `{{SWAP_RUNTIME_JS}}`, `{{BUDGET_TABLE}}`, `{{BUDGET_NOTE}}`, `{{FOOTER_CLOSING}}`.

  Plus fragment blocks marked by HTML comments `<!-- HOTEL_CARD_TEMPLATE_START --> ... <!-- HOTEL_CARD_TEMPLATE_END -->`, similarly for `SPOT_CARD`, `TIMELINE_CARD`, `DAY_CARD`, `NAV_ITEM`, `REGION_SECTION`. Inside each block, inner placeholders use the same `{{XXX}}` syntax.

  This task is the LARGEST single task in the plan (the template is ~1300 lines) but it's mostly mechanical: copy the Bali HTML, replace specific strings with placeholders, add new CSS + new sections.

- [ ] **Step 1: Copy the Bali page as a starting point**

Run:
```bash
mkdir -p templates
cp trips/bali-march-2027/index.html templates/trip-page.html.tmpl
wc -l templates/trip-page.html.tmpl
```
Expected: 953 lines (same as Bali).

- [ ] **Step 2: Replace top-level placeholders (use `edit` tool on the .tmpl file)**

Make these exact substitutions in `templates/trip-page.html.tmpl`:

| Replace                                                                                                | With                       |
|--------------------------------------------------------------------------------------------------------|----------------------------|
| `<title>Our Bali Honeymoon — March 2027</title>`                                                       | `<title>{{TITLE}}</title>` |
| `<h1>Bali &amp; Nusa Penida</h1>` (inside hero)                                                        | `<h1>{{TITLE}}</h1>`       |
| Hero `.sub`: `Our Honeymoon Adventure` (or whatever text is there)                                     | `{{SUBTITLE}}`             |
| Hero `.date`: e.g. `March 2027 · 14 Days`                                                              | `{{DATES_LONG}}`           |
| Hero video `<source src="...">` URL                                                                    | `{{HERO_VIDEO_URL}}`       |
| Hero background fallback image URL (in the inline style, usually an Unsplash URL)                      | `{{HERO_IMG}}`             |
| The "March weather:" line inside `#overview` (the full inline strong + text)                           | `{{WEATHER_NOTE}}`         |
| The Bali-specific closing line in the footer (e.g. "See you in Bali — March 2027")                     | `{{FOOTER_CLOSING}}`       |
| The Bali-specific budget table rows (between `<tbody>` and `</tbody>`)                                 | `{{BUDGET_TABLE}}`         |
| The Bali-specific budget note line (the `<p>` after the table)                                         | `{{BUDGET_NOTE}}`          |

Use the `edit` tool with full surrounding context for each substitution (multiple lines of context to ensure unique matching).

- [ ] **Step 3: Replace the nav block with a `{{NAV_LINKS}}` placeholder**

Find the existing nav `<ul>` block (something like lines 100–110 of original Bali, with `<li><a href="#overview">…</a></li>` repeated). Replace its contents with `{{NAV_LINKS}}` (keep the wrapping `<nav><ul class="...">` and `</ul></nav>`).

Just before the `</ul>`, leave an HTML comment fragment template:

```html
<!-- NAV_ITEM_TEMPLATE_START -->
<li><a href="#{{ITEM_ID}}">{{ITEM_LABEL}}</a></li>
<!-- NAV_ITEM_TEMPLATE_END -->
```

Wait — putting the fragment inside the nav itself would make it visible at runtime. Instead: put ALL fragment templates inside a single `<template>` element at the very END of the file, just before `</body>`. The template element's contents don't render.

Define each fragment between unique HTML comments INSIDE a `<template id="fragments" hidden>` block, like:

```html
<template id="fragments" hidden>
<!-- NAV_ITEM_TEMPLATE_START -->
<li><a href="#{{ITEM_ID}}">{{ITEM_LABEL}}</a></li>
<!-- NAV_ITEM_TEMPLATE_END -->

<!-- TIMELINE_CARD_TEMPLATE_START -->
<div class="timeline-card">
  <div class="days">Days {{REGION_DAYS}}</div>
  <h3>{{REGION_NAME}}</h3>
  <p>{{REGION_TAGLINE}}</p>
</div>
<!-- TIMELINE_CARD_TEMPLATE_END -->

<!-- HOTEL_CARD_TEMPLATE_START -->
<div class="hotel-card">
  <img class="hotel-card-img" src="{{HOTEL_IMG}}" alt="{{HOTEL_NAME}}" loading="lazy" width="130" height="130">
  <div class="hotel-card-body">
    <div class="name-row">
      <h4>{{HOTEL_NAME}}</h4>
      <span class="rating-badge"><span class="star">&#9733;</span> {{HOTEL_RATING}}</span>
      <span class="platform-badge {{HOTEL_PLATFORM_CLASS}}">{{HOTEL_PLATFORM}}</span>
    </div>
    <div class="price-line">from <span class="price">{{HOTEL_PRICE}}</span> / night</div>
    <div class="features">{{HOTEL_FEATURES}}</div>
    <div class="desc">{{HOTEL_DESC}}</div>
    {{HOTEL_COUPLES_NOTE}}
  </div>
</div>
<!-- HOTEL_CARD_TEMPLATE_END -->

<!-- SPOT_CARD_TEMPLATE_START -->
<div class="spot-card">
  <img class="spot-card-img" src="{{SPOT_IMG}}" alt="{{SPOT_NAME}}" loading="lazy" width="110" height="110">
  <div class="spot-card-body">
    <h4>{{SPOT_NAME}}</h4>
    <div class="vibe">{{SPOT_VIBE}}</div>
    <div class="detail">{{SPOT_DETAIL}}</div>
    <span class="price-tag">{{SPOT_PRICE}}</span>
  </div>
</div>
<!-- SPOT_CARD_TEMPLATE_END -->

<!-- DAY_CARD_TEMPLATE_START -->
<article class="day-card day-card-{{STATUS}}" data-day="{{DAY_N}}" aria-label="Day {{DAY_N}}, {{STATUS}}, {{ACTIVITY_NAME_OR_REST}}">
  <header class="day-card-head">
    <div class="day-num">DAY {{DAY_N_PAD}} &middot; {{DATE_SHORT}}</div>
    <div class="day-tags"><span class="region-tag">{{REGION_NAME}}</span><span class="status-badge">{{STATUS_BADGE}}</span></div>
  </header>
  <div class="day-card-activity">{{ACTIVITY_BLOCK}}</div>
  <div class="day-card-dinner">{{DINNER_BLOCK}}</div>
  <footer class="day-card-foot">{{TRANSIT_LINE}}</footer>
</article>
<!-- DAY_CARD_TEMPLATE_END -->

<!-- REGION_SECTION_TEMPLATE_START -->
<section id="{{REGION_ID}}">
  <div class="area-header">
    <div class="num">{{REGION_NUM}}</div>
    <div>
      <h2>{{REGION_NAME}}</h2>
      <p>Days {{REGION_DAYS}} &middot; {{REGION_NIGHTS}} nights &middot; {{REGION_TAGLINE}}</p>
    </div>
  </div>
  <img class="img-banner" src="{{REGION_BANNER_IMG}}" alt="{{REGION_NAME}}" width="1100" height="240" loading="lazy">
  <div class="content-grid">
    <div>
      <div class="info-card">
        <h3>&#128666; Getting There</h3>
        <ul>{{GETTING_THERE_LIST}}</ul>
      </div>
      <div class="info-card">
        <h3>&#127968; Where to Stay</h3>
        {{HOTEL_CARDS}}
        {{HOTEL_TIP_BOX}}
      </div>
    </div>
    <div>
      <div class="info-card">
        <h3>&#128247; What to Visit in {{REGION_NAME}}</h3>
        {{ATTRACTION_CARDS}}
      </div>
      {{LOCAL_QUOTE_BOX}}
      {{SOCIAL_EMBEDS}}
    </div>
  </div>
</section>
<!-- REGION_SECTION_TEMPLATE_END -->
</template>
```

This `<template>` element holds the fragment definitions; the agent reads them out, performs substitution, and concatenates them into the appropriate top-level placeholders.

- [ ] **Step 4: Replace the three existing region sections with the single `{{REGION_SECTIONS}}` placeholder**

Delete the three `<section id="ubud">…</section>`, `<section id="nusapenida">…</section>`, `<section id="seminyak">…</section>` blocks (the agent will reconstruct them by repeating the `REGION_SECTION` fragment).

Replace with just: `{{REGION_SECTIONS}}`

- [ ] **Step 5: Replace the three Overview timeline cards with `{{TIMELINE_CARDS}}`**

Find the `<div class="timeline-grid">` block (3 `.timeline-card` divs inside). Replace its INNER contents with `{{TIMELINE_CARDS}}`.

- [ ] **Step 6: Add the new Day-by-Day section between Overview and `{{REGION_SECTIONS}}`**

Insert this exactly after `</section>` (which closes Overview) and before `{{REGION_SECTIONS}}`:

```html
<section id="dayplan">
  <div class="section-title">
    <h2>Day-by-Day</h2>
    <p>Paced to give you energy &mdash; one thing per active day, rest in between</p>
  </div>
  <div class="dayplan-controls">
    <button id="plan-reset" type="button">Reset</button>
    <button id="plan-shuffle" type="button">Shuffle</button>
    <button id="plan-print" type="button">Print</button>
  </div>
  <div class="day-grid">
    {{DAY_PLAN_SECTION}}
  </div>
</section>
```

- [ ] **Step 7: Add the new CSS inside the existing `<style>` block (append before `</style>`)**

Find `</style>` and insert before it:

```css

/* ── Day-by-day section ──────────────────────────────────────────────── */
#dayplan .dayplan-controls { display: flex; gap: 12px; justify-content: center; margin-bottom: 32px; flex-wrap: wrap; }
#dayplan .dayplan-controls button { background: #fff; border: 1px solid #d4cfc7; color: #1a1a2e; padding: 8px 16px; border-radius: 999px; font-family: inherit; font-size: .9rem; cursor: pointer; transition: background .15s; }
#dayplan .dayplan-controls button:hover { background: #f0ebe3; }
.day-grid { display: grid; grid-template-columns: 1fr; gap: 16px; max-width: 900px; margin: 0 auto; }
@media (min-width: 900px) { .day-grid { grid-template-columns: 1fr 1fr; } }
.day-card { background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.06); padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
.day-card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.day-num { font-family: 'Playfair Display', serif; font-size: 1.05rem; color: #b8865b; letter-spacing: 1px; }
.day-tags { display: flex; gap: 8px; }
.region-tag, .status-badge { font-size: .75rem; letter-spacing: 1px; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; }
.region-tag { background: #f0ebe3; color: #1a1a2e; }
.status-badge { color: #fff; }
.day-card-active .status-badge { background: #2e8b57; }
.day-card-rest   .status-badge { background: #b8865b; }
.day-card-transfer .status-badge { background: #6b7a8f; }
.day-card-activity, .day-card-dinner { font-size: .95rem; }
.day-card-foot { color: #888; font-size: .85rem; padding-top: 6px; border-top: 1px dashed #e8e3dd; }
.day-card .swap-btn { background: none; border: none; color: #b8865b; font: inherit; cursor: pointer; padding: 4px 0; text-decoration: underline; }
.swap-pool { display: none; margin-top: 8px; padding: 8px; background: #faf6f0; border-radius: 6px; max-height: 240px; overflow-y: auto; }
.swap-pool[aria-expanded="true"], .swap-pool.open { display: block; }
.swap-pool .swap-option { display: flex; gap: 10px; padding: 6px; cursor: pointer; border-radius: 4px; }
.swap-pool .swap-option:hover { background: #f0ebe3; }

/* ── Local quote callout ─────────────────────────────────────────────── */
.local-quote { font-family: 'Playfair Display', serif; font-style: italic; border-left: 3px solid #b8865b; padding: 12px 16px; margin-top: 16px; color: #555; background: #faf6f0; border-radius: 0 8px 8px 0; }
.local-quote cite { display: block; font-style: normal; font-family: 'Inter', sans-serif; font-size: .8rem; color: #888; margin-top: 6px; letter-spacing: 1px; }

/* ── Social embeds ───────────────────────────────────────────────────── */
.social-embeds { margin-top: 16px; }
.social-embeds summary { cursor: pointer; font-size: .9rem; color: #b8865b; padding: 6px 0; }
.social-embeds[open] { max-height: 600px; overflow-y: auto; }

/* ── Print stylesheet ────────────────────────────────────────────────── */
@media print {
  nav, .hero-video, .hero, .scroll-indicator, .social-embeds, .swap-btn, .dayplan-controls { display: none !important; }
  body { background: #fff; padding: 0 12mm; font-size: 11pt; }
  .day-card { page-break-inside: avoid; box-shadow: none; border: 1px solid #ccc; margin-bottom: 6mm; }
  .img-banner, .trip-hero { display: none; }
  h1, h2 { color: #000; }
}
```

- [ ] **Step 8: Add the `{{TRIP_DATA_JSON}}` and `{{SWAP_RUNTIME_JS}}` blocks just before `</body>`**

Find `</body>` and insert just before:

```html
<script id="trip-data" type="application/json">
{{TRIP_DATA_JSON}}
</script>
<script>
{{SWAP_RUNTIME_JS}}
</script>
```

The `{{SWAP_RUNTIME_JS}}` placeholder will be filled with the actual swap-pool runtime code (see Task 10 — the agent inlines a constant blob of JS, same across every trip).

- [ ] **Step 9: Verify the template is syntactically reasonable**

Run:
```bash
wc -l templates/trip-page.html.tmpl
rg -c '\{\{[A-Z_]+\}\}' templates/trip-page.html.tmpl
rg -c 'TEMPLATE_START' templates/trip-page.html.tmpl
```
Expected: template is ~1100–1300 lines. Placeholder count ≥ 15. Fragment-start markers ≥ 6.

- [ ] **Step 10: Commit**

```bash
git add templates/
git commit -m "feat: extract Bali page into templates/trip-page.html.tmpl

Lifted the Bali HTML/CSS verbatim and replaced trip-specific content
with {{PLACEHOLDERS}}. Added new sections: day-by-day, local-quote
callouts, social embeds. Added CSS for day cards, swap pool, print
styles. Fragment templates (hotel card, spot card, day card, etc.)
live inside a hidden <template id=\"fragments\"> at the bottom."
```

---

## Task 9: Write the SWAP_RUNTIME_JS payload as a standalone file

**Files:**
- Create: `templates/swap-runtime.js` (the JS that gets inlined into every generated page as `{{SWAP_RUNTIME_JS}}`)

**Interfaces:**
- Consumes: `#trip-data` JSON in the page, `localStorage["trip:<slug>"]`, the existing static day cards as initial DOM.
- Produces: live swap-pool, reset, shuffle, and print behavior. Reads `<template id="fragments">` to find the `DAY_CARD_TEMPLATE` fragment for re-rendering on shuffle/swap.

  The JS is kept in `templates/swap-runtime.js` and the agent embeds it verbatim via `{{SWAP_RUNTIME_JS}}` substitution. Keeping it as a separate file (rather than inline in the template) makes it editable, lintable, and testable as plain JS.

- [ ] **Step 1: Write the runtime**

Write to `templates/swap-runtime.js`:

```javascript
// Inlined into every generated trip page. Pure ES2020, no dependencies.
// Reads <script id="trip-data" type="application/json">, restores overrides
// from localStorage, wires up swap / reset / shuffle / print buttons.

(function () {
  "use strict";

  const dataEl = document.getElementById("trip-data");
  if (!dataEl) return; // page has no plan
  const trip = JSON.parse(dataEl.textContent);
  const KEY = "trip:" + trip.tripSlug;

  // Restore overrides if any
  let overrides = {};
  try { overrides = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { overrides = {}; }

  function applyOverrides(days) {
    if (!overrides.days) return days;
    return days.map((d) => {
      const o = overrides.days.find((x) => x.n === d.n);
      return o ? { ...d, ...o } : d;
    });
  }

  function saveOverride(dayN, patch) {
    overrides.days = overrides.days || [];
    const i = overrides.days.findIndex((x) => x.n === dayN);
    if (i >= 0) overrides.days[i] = { ...overrides.days[i], ...patch, n: dayN };
    else overrides.days.push({ ...patch, n: dayN });
    localStorage.setItem(KEY, JSON.stringify(overrides));
  }

  // ── eligibility ────────────────────────────────────────────────────────
  function eligibleActivities(region, dayN, currentDays) {
    const hotel = trip.regionHotel[region];
    const usedIds = new Set(currentDays.filter((d) => d.region === region && d.activityId && d.n !== dayN).map((d) => d.activityId));
    return (trip.activities[region] || [])
      .filter((a) => (a.drive[hotel] ?? Infinity) <= 60)
      .filter((a) => !usedIds.has(a.id));
  }
  function eligibleRestaurants(region) {
    const hotel = trip.regionHotel[region];
    return (trip.restaurants[region] || [])
      .slice()
      .sort((a, b) => (a.drive[hotel] ?? Infinity) - (b.drive[hotel] ?? Infinity));
  }

  // ── render helpers ─────────────────────────────────────────────────────
  function findActivity(region, id) {
    return ((trip.activities || {})[region] || []).find((a) => a.id === id);
  }
  function findRestaurant(region, id) {
    return ((trip.restaurants || {})[region] || []).find((r) => r.id === id);
  }

  function renderActivityBlock(d) {
    if (d.status === "rest") {
      return `<div class="rest-suggestion"><span>🌿</span> ${d.restSuggestion || "Rest day"}</div>`;
    }
    if (d.status === "transfer") {
      return `<div class="transfer-note"><span>✈️</span> Transfer day — travel logistics handled in the region section below.</div>`;
    }
    const a = findActivity(d.region, d.activityId);
    if (!a) return `<em>(no activity)</em>`;
    const hotel = trip.regionHotel[d.region];
    const drive = a.drive[hotel] ?? "?";
    const mapsLink = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.name)}`;
    return `<div class="activity-row">
      <strong>${a.name}</strong>
      <div class="muted">🚗 ${drive} min from ${hotel} &middot; <a href="${mapsLink}" target="_blank" rel="noopener">map</a></div>
      <button class="swap-btn" data-swap="activity" data-day="${d.n}" aria-expanded="false">swap activity ▾</button>
      <div class="swap-pool" data-pool-day="${d.n}" data-pool-kind="activity"></div>
    </div>`;
  }

  function renderDinnerBlock(d) {
    const r = findRestaurant(d.region, d.dinnerId);
    if (!r) return `<em>(no dinner)</em>`;
    const hotel = trip.regionHotel[d.region];
    return `<div class="dinner-row">
      🍽 <strong>${r.name}</strong>
      <div class="muted">${r.tier} &middot; ${r.drive[hotel] ?? "?"} min</div>
      <button class="swap-btn" data-swap="dinner" data-day="${d.n}" aria-expanded="false">swap dinner ▾</button>
      <div class="swap-pool" data-pool-day="${d.n}" data-pool-kind="dinner"></div>
    </div>`;
  }

  function dayCardHtml(d) {
    const statusBadge = d.status === "active" ? "📸 ACTIVE" : d.status === "rest" ? "🌿 REST" : "✈️ TRANSFER";
    const region = (trip.regions || []).find((r) => r.id === d.region);
    const regionName = region ? region.name : d.region;
    const a = findActivity(d.region, d.activityId);
    const dateShort = (() => { const dt = new Date(d.date + "T00:00:00Z"); return dt.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" }); })();
    return `<article class="day-card day-card-${d.status}" data-day="${d.n}" aria-label="Day ${d.n}, ${d.status}, ${a ? a.name : d.status}">
      <header class="day-card-head">
        <div class="day-num">DAY ${String(d.n).padStart(2, "0")} &middot; ${dateShort}</div>
        <div class="day-tags"><span class="region-tag">${regionName}</span><span class="status-badge">${statusBadge}</span></div>
      </header>
      <div class="day-card-activity">${renderActivityBlock(d)}</div>
      <div class="day-card-dinner">${renderDinnerBlock(d)}</div>
    </article>`;
  }

  function renderAllDays() {
    const grid = document.querySelector(".day-grid");
    if (!grid) return;
    const days = applyOverrides(trip.days);
    grid.innerHTML = days.map(dayCardHtml).join("\n");
    wireUp();
  }

  function showSwapPool(btn, kind, dayN) {
    const pool = btn.parentElement.querySelector(".swap-pool");
    const isOpen = pool.classList.toggle("open");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (!isOpen) return;
    const days = applyOverrides(trip.days);
    const d = days.find((x) => x.n === dayN);
    if (!d) return;
    let options = [];
    if (kind === "activity") {
      options = eligibleActivities(d.region, dayN, days);
      pool.innerHTML = options.length
        ? options.map((a) => `<div class="swap-option" data-pick="${a.id}">${a.name} <span class="muted">${a.drive[trip.regionHotel[d.region]]}min</span></div>`).join("")
        : `<em>No other eligible activities for this hotel. Try Shuffle or change another day first.</em>`;
    } else {
      options = eligibleRestaurants(d.region);
      pool.innerHTML = options.map((r) => `<div class="swap-option" data-pick="${r.id}">${r.name} <span class="muted">${r.tier} &middot; ${r.drive[trip.regionHotel[d.region]] ?? "?"}min</span></div>`).join("");
    }
    pool.querySelectorAll(".swap-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        const id = opt.getAttribute("data-pick");
        if (kind === "activity") saveOverride(dayN, { activityId: id });
        else saveOverride(dayN, { dinnerId: id });
        renderAllDays();
      });
    });
  }

  function wireUp() {
    document.querySelectorAll(".swap-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.getAttribute("data-swap");
        const dayN = Number(btn.getAttribute("data-day"));
        showSwapPool(btn, kind, dayN);
      });
    });
  }

  const resetBtn = document.getElementById("plan-reset");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    localStorage.removeItem(KEY);
    overrides = {};
    renderAllDays();
  });

  const printBtn = document.getElementById("plan-print");
  if (printBtn) printBtn.addEventListener("click", () => window.print());

  const shuffleBtn = document.getElementById("plan-shuffle");
  if (shuffleBtn) shuffleBtn.addEventListener("click", () => {
    // Client-side shuffle: bump seed, but we don't re-implement the full scheduler here.
    // Instead, simply randomly rotate eligible activities through active days within each region.
    const days = applyOverrides(trip.days);
    const rng = Math.random;
    const byRegion = {};
    for (const d of days) {
      if (d.status === "active") (byRegion[d.region] = byRegion[d.region] || []).push(d);
    }
    for (const region in byRegion) {
      const activeDays = byRegion[region];
      const pool = eligibleActivities(region, -1, []).slice();
      // Fisher–Yates
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (let i = 0; i < activeDays.length; i++) {
        if (pool[i]) saveOverride(activeDays[i].n, { activityId: pool[i].id });
      }
    }
    renderAllDays();
  });

  // Initial render replaces server-rendered static cards
  renderAllDays();
})();
```

- [ ] **Step 2: Syntax-check by parsing it with Node**

Run:
```bash
node --check templates/swap-runtime.js
echo "exit: $?"
```
Expected: no output, `exit: 0`. Any syntax error gets caught here.

- [ ] **Step 3: Commit**

```bash
git add templates/swap-runtime.js
git commit -m "feat: swap-pool runtime (templates/swap-runtime.js)

Vanilla ES2020 runtime that every generated trip page inlines as
{{SWAP_RUNTIME_JS}}. Reads #trip-data, restores localStorage overrides,
wires up swap / reset / shuffle / print buttons. Eligibility filter:
drive ≤ 60 from hotel, no activity reuse within region. Dinners can
repeat but sort unused first. Shuffle rotates activities within each
region randomly (full scheduler logic lives server-side in
build-schedule.mjs)."
```

---

## Task 10: One-off `scripts/render-bali.mjs` to dogfood the template against known-good Bali

**Files:**
- Create: `scripts/render-bali.mjs` (throwaway — deleted in Task 14)
- Create: `scripts/__tests__/fixtures/bali-content.json` (hand-written content for the Bali trip — hotels, attractions, restaurants, regions, with the same drive-time matrix as `bali-spec.json`)
- Create: `/tmp/bali-rendered.html` (rendered output, not committed)

**Interfaces:**
- Consumes: `templates/trip-page.html.tmpl`, `templates/swap-runtime.js`, `scripts/__tests__/fixtures/bali-content.json`, `scripts/build-schedule.mjs`
- Produces: `/tmp/bali-rendered.html` — a complete trip page filled with Bali content. Used ONLY to verify the template is correct end-to-end before we build the agent. Not committed to `trips/`.

**Why throwaway:** the goal here is template verification. The agent will do this same job from research, not from a hand-written JSON. We delete `render-bali.mjs` and `bali-content.json` after the agent successfully regenerates Bali (Task 13).

- [ ] **Step 1: Write `bali-content.json`**

Write to `scripts/__tests__/fixtures/bali-content.json` (this is BIG — captures everything the current Bali page shows, plus the new infinity-pool villa we're adding):

Use the existing Bali page's text as the source. Structure:

```json
{
  "title": "Our Bali Honeymoon — March 2027",
  "subtitle": "Our Honeymoon Adventure",
  "datesLong": "March 2027 · 14 Days",
  "datesShort": "March 1–14, 2027",
  "heroVideoUrl": "",
  "heroImg": "https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=1920&q=80",
  "weatherNote": "<strong style=\"color:#b8865b;\">March weather:</strong> End of wet season — warm (27–32°C), occasional showers, lush & green",
  "footerClosing": "See you in Bali — March 2027",
  "regions": [
    { "id": "ubud", "name": "Ubud", "num": 1, "days": "1–6", "nights": 5, "tagline": "The cultural heart of Bali", "bannerImg": "https://images.unsplash.com/photo-1555400038-63f5ba517a47?auto=format&fit=crop&w=1100&q=80",
      "gettingThere": [
        "<span class=\"label\">Airport to Ubud:</span> Grab/Gojek <span class=\"price\">$13–19</span> | private transfer <span class=\"price\">$25–30</span>",
        "<span class=\"label\">Travel time:</span> 1.5–2 hours (38 km)",
        "<span class=\"label\">Getting around:</span> Scooter rental <span class=\"price\">$3–5/day</span> | Gojek rides <span class=\"price\">$1–3</span>"
      ],
      "hotels": [
        { "id": "eden-house", "name": "Eden House Ubud", "img": "https://images.unsplash.com/photo-1737808773486-ca1065f37217?auto=format&fit=crop&w=260&q=80", "rating": "9.5", "platform": "Booking.com", "platformClass": "", "price": "$35–50", "features": ["King bed","Breakfast","Balcony","Rice views","Yoga"], "desc": "Traditional Balinese guesthouse, family-run, surrounded by rice fields 5min from center.", "couplesNote": "9.2/10" },
        { "id": "bisma-eight", "name": "Bisma Eight (luxury splurge)", "img": "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=260&q=80", "rating": "9.4", "platform": "Booking.com", "platformClass": "", "price": "$180–240", "features": ["Infinity Pool","Jungle view","Breakfast","Spa","Adults-only"], "desc": "Adults-only design hotel with an Infinity Pool overlooking the jungle canopy — one splurge night, one moment you'll remember forever.", "couplesNote": "9.5/10" },
        { "id": "tegal-sari", "name": "Tegal Sari", "img": "https://images.unsplash.com/photo-1737531049186-a20c1f203f50?auto=format&fit=crop&w=260&q=80", "rating": "8.7", "platform": "Agoda", "platformClass": "agoda", "price": "$27–53", "features": ["Rice paddy views","Central","Pool","Balinese style"], "desc": "Iconic budget stay right by the rice fields.", "couplesNote": null }
      ],
      "hotelTipBox": "<strong>💡 Pro Tip:</strong> Book <strong>Eden House</strong> for most nights, splurge ONE night at <strong>Bisma Eight</strong> for the infinity pool experience.",
      "attractions": [
        { "id": "tegalalang", "img": "https://images.unsplash.com/photo-1680100595862-9c8803a9e7da?auto=format&fit=crop&w=220&q=80", "name": "Tegalalang Rice Terraces", "vibe": "Like walking through a living painting — layer after layer of luminous green stretching into the valley.", "detail": "Go before 8am when the light is golden.", "price": "Free (donation)" }
      ],
      "localQuote": { "text": "A peaceful escape from the Ubud crowds — the best rice paddies are not the famous ones.", "source": "Balinese travel blog Bali-Asli (translated)" },
      "socialEmbeds": []
    }
  ],
  "budgetTable": "<tr><td>Flights</td><td>Round-trip for 2</td><td>$1,400–$2,000</td></tr>...",
  "budgetNote": "All prices approximate for March 2027 · $1 ≈ 16,000 IDR"
}
```

(NOTE: For brevity I'm showing only Ubud and one attraction here. The actual fixture must include all 3 regions, all hotels, attractions, and restaurants from the current Bali page — the implementer should copy the data from `trips/bali-march-2027/index.html` directly. It's mechanical extraction.)

Also add `seed: 1`, `splurgeCount: 3`, `driveCapMinutes: 60`, `restSuggestions: [...]` at the top level so the file is also a valid input to `build-schedule.mjs` (the renderer will pass it along).

- [ ] **Step 2: Write `render-bali.mjs`**

Write to `scripts/render-bali.mjs`:

```javascript
#!/usr/bin/env node
// Throwaway script: render a Bali trip page from hand-written content JSON.
// Used to verify the template works end-to-end before we build the agent.
// Deleted in Task 14.

import { readFileSync, writeFileSync } from "node:fs";
import { buildSchedule } from "./build-schedule.mjs";

const content = JSON.parse(readFileSync("scripts/__tests__/fixtures/bali-content.json", "utf8"));
const tpl = readFileSync("templates/trip-page.html.tmpl", "utf8");
const runtime = readFileSync("templates/swap-runtime.js", "utf8");

// Build trip-spec for the scheduler (needs the data shape the scheduler expects)
const spec = {
  tripSlug: "bali-march-2027",
  startDate: "2027-03-01",
  endDate: "2027-03-14",
  seed: content.seed ?? 1,
  splurgeCount: content.splurgeCount ?? 3,
  driveCapMinutes: content.driveCapMinutes ?? 60,
  restSuggestions: content.restSuggestions ?? ["Pool & book", "Couples spa near hotel", "Short walk", "Sunset cocktail", "Lazy morning"],
  regions: content.regions.map((r) => ({ id: r.id, name: r.name, nightsRange: [r.nights, r.nights] })),
  hotels: Object.fromEntries(content.regions.map((r) => [r.id, r.hotels[0].id])), // pick first hotel as primary
  activities: Object.fromEntries(content.regions.map((r) => [r.id, r.attractions.map((a) => ({ id: a.id, name: a.name, score: a.score ?? 8, drive: a.drive ?? { [r.hotels[0].id]: 20 } }))])),
  restaurants: Object.fromEntries(content.regions.map((r) => [r.id, (r.restaurants || []).map((x) => ({ id: x.id, name: x.name, tier: x.tier, drive: x.drive ?? { [r.hotels[0].id]: 10 } }))])),
};

const days = buildSchedule(spec);

// Fragment helpers
function extractFragment(tag) {
  const m = tpl.match(new RegExp(`<!-- ${tag}_TEMPLATE_START -->([\\s\\S]*?)<!-- ${tag}_TEMPLATE_END -->`));
  return m ? m[1].trim() : "";
}
function fill(fragment, vars) {
  return fragment.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => vars[k] ?? "");
}

const fragHotel = extractFragment("HOTEL_CARD");
const fragSpot  = extractFragment("SPOT_CARD");
const fragTL    = extractFragment("TIMELINE_CARD");
const fragNav   = extractFragment("NAV_ITEM");
const fragRegion= extractFragment("REGION_SECTION");

// Render per-region pieces
const regionSections = content.regions.map((r) => {
  const hotels = r.hotels.map((h) => fill(fragHotel, {
    HOTEL_IMG: h.img, HOTEL_NAME: h.name, HOTEL_RATING: h.rating, HOTEL_PLATFORM: h.platform, HOTEL_PLATFORM_CLASS: h.platformClass || "",
    HOTEL_PRICE: h.price, HOTEL_FEATURES: (h.features || []).map(f => `<span>${f}</span>`).join(""), HOTEL_DESC: h.desc,
    HOTEL_COUPLES_NOTE: h.couplesNote ? `<div class="couples-note">♥ Couples rate it ${h.couplesNote}</div>` : "",
  })).join("\n");
  const spots = (r.attractions || []).map((a) => fill(fragSpot, {
    SPOT_IMG: a.img, SPOT_NAME: a.name, SPOT_VIBE: a.vibe, SPOT_DETAIL: a.detail, SPOT_PRICE: a.price,
  })).join("\n");
  const localQuote = r.localQuote ? `<div class="local-quote">${r.localQuote.text}<cite>— ${r.localQuote.source}</cite></div>` : "";
  const socials = r.socialEmbeds && r.socialEmbeds.length ? `<details class="social-embeds"><summary>From TikTok / IG (${r.socialEmbeds.length})</summary>${r.socialEmbeds.join("")}</details>` : "";
  return fill(fragRegion, {
    REGION_ID: r.id, REGION_NUM: r.num, REGION_NAME: r.name, REGION_DAYS: r.days, REGION_NIGHTS: r.nights, REGION_TAGLINE: r.tagline,
    REGION_BANNER_IMG: r.bannerImg, GETTING_THERE_LIST: (r.gettingThere || []).map(li => `<li>${li}</li>`).join(""),
    HOTEL_CARDS: hotels, HOTEL_TIP_BOX: r.hotelTipBox ? `<div class="tip-box">${r.hotelTipBox}</div>` : "",
    ATTRACTION_CARDS: spots, LOCAL_QUOTE_BOX: localQuote, SOCIAL_EMBEDS: socials,
  });
}).join("\n");

const timelineCards = content.regions.map((r) => fill(fragTL, {
  REGION_DAYS: r.days, REGION_NAME: r.name, REGION_TAGLINE: r.tagline,
})).join("\n");

const navLinks = [
  fill(fragNav, { ITEM_ID: "overview", ITEM_LABEL: "Overview" }),
  fill(fragNav, { ITEM_ID: "dayplan", ITEM_LABEL: "Day-by-Day" }),
  ...content.regions.map(r => fill(fragNav, { ITEM_ID: r.id, ITEM_LABEL: r.name })),
  fill(fragNav, { ITEM_ID: "budget", ITEM_LABEL: "Budget" }),
].join("\n");

// Day plan
const fragDay = extractFragment("DAY_CARD");
const dayCards = days.map((d) => {
  const region = content.regions.find(r => r.id === d.region);
  const activity = region?.attractions.find(a => a.id === d.activityId);
  return fill(fragDay, {
    DAY_N: d.n, DAY_N_PAD: String(d.n).padStart(2, "0"),
    DATE_SHORT: new Date(d.date + "T00:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" }),
    REGION_NAME: region?.name || d.region,
    STATUS: d.status,
    STATUS_BADGE: d.status === "active" ? "📸 ACTIVE" : d.status === "rest" ? "🌿 REST" : "✈️ TRANSFER",
    ACTIVITY_NAME_OR_REST: activity?.name || d.status,
    ACTIVITY_BLOCK: activity ? `<strong>${activity.name}</strong>` : d.restSuggestion || (d.status === "transfer" ? "Transfer day" : "Rest"),
    DINNER_BLOCK: d.dinnerId || "—",
    TRANSIT_LINE: "",
  });
}).join("\n");

// Trip-data JSON for swap UI
const tripData = {
  tripSlug: spec.tripSlug, seed: spec.seed,
  regions: content.regions.map(r => ({ id: r.id, name: r.name })),
  regionHotel: spec.hotels,
  activities: spec.activities,
  restaurants: spec.restaurants,
  days,
};

// Final substitution
let html = tpl
  .replace("{{TITLE}}", content.title)
  .replace("{{TITLE}}", content.title) // hero h1
  .replace("{{SUBTITLE}}", content.subtitle)
  .replace("{{DATES_LONG}}", content.datesLong)
  .replace("{{DATES_SHORT}}", content.datesShort)
  .replace("{{HERO_VIDEO_URL}}", content.heroVideoUrl)
  .replace("{{HERO_IMG}}", content.heroImg)
  .replace("{{WEATHER_NOTE}}", content.weatherNote)
  .replace("{{NAV_LINKS}}", navLinks)
  .replace("{{TIMELINE_CARDS}}", timelineCards)
  .replace("{{DAY_PLAN_SECTION}}", dayCards)
  .replace("{{REGION_SECTIONS}}", regionSections)
  .replace("{{TRIP_DATA_JSON}}", JSON.stringify(tripData, null, 2))
  .replace("{{SWAP_RUNTIME_JS}}", runtime)
  .replace("{{BUDGET_TABLE}}", content.budgetTable)
  .replace("{{BUDGET_NOTE}}", content.budgetNote)
  .replace("{{FOOTER_CLOSING}}", content.footerClosing);

writeFileSync("/tmp/bali-rendered.html", html);
console.error(`rendered /tmp/bali-rendered.html (${html.length} bytes)`);
```

- [ ] **Step 3: Run it**

Run:
```bash
node scripts/render-bali.mjs
ls -la /tmp/bali-rendered.html
```
Expected: stderr `rendered /tmp/bali-rendered.html (~70000+ bytes)`, file exists.

- [ ] **Step 4: Validate the rendered output**

Run:
```bash
node scripts/validate-page.mjs /tmp/bali-rendered.html
echo "exit: $?"
```
Expected: `exit: 0`, summary line about 14 days. If exit is non-zero, fix the template OR the fixture (probably the fixture is incomplete, but check tag balance — the new sections may have introduced an extra `<div>` or unclosed tag).

- [ ] **Step 5: Image-check the rendered output**

Run:
```bash
bash scripts/check-images.sh /tmp/bali-rendered.html
echo "exit: $?"
```
Expected: `exit: 0`, all images return 200.

- [ ] **Step 6: Spot-check visually (optional)**

Run:
```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp &
SERVER_PID=$!
sleep 1
echo "→ open http://127.0.0.1:8765/bali-rendered.html in a browser"
echo "Press Ctrl-C to stop the server when done"
wait $SERVER_PID
```
(Manual step — the implementer eyeballs the rendered page in a browser to confirm it visually matches the current Bali page, plus the new day-by-day section.)

- [ ] **Step 7: Commit**

```bash
git add scripts/render-bali.mjs scripts/__tests__/fixtures/bali-content.json
git commit -m "test: throwaway render-bali.mjs to dogfood the template

Renders /tmp/bali-rendered.html from a hand-written content fixture
using the actual template + scheduler. Validates end-to-end before we
build the agent. Both files are deleted in the final cleanup task
once the agent itself can regenerate Bali."
```

---

## Task 11: Write the OpenCode subagent definition

**Files:**
- Create: `.opencode/agent/travel-agent.md`

**Interfaces:**
- Consumes: user invocation `@travel-agent <destination> [dates] [notes]`, plus the rest of the repo (templates, scripts, existing trips for style reference).
- Produces: a new `trips/<slug>/index.html` committed to `main`, then a chat summary reporting the file path, Pages URL, and any flagged constraints.

- [ ] **Step 1: Write the agent definition**

Write to `.opencode/agent/travel-agent.md`:

```markdown
---
description: Generates a polished honeymoon-style travel page for any destination, with hotels, activities, restaurants, and a day-by-day plan that respects pacing rules (alternate active/rest with extra rest after transfers, 60-min drive cap, dinner per day, 2-3 splurges, at least one infinity-pool villa). Use when the user asks for a trip plan for a country, region, or city.
mode: subagent
model: github-copilot/claude-opus-4.7
permission:
  edit: allow
  bash: allow
  webfetch: allow
  websearch: allow
---

You generate complete, deployable travel pages for any destination. You take a free-form destination input (country, region, city, with optional dates and notes), do live web research, and produce a `trips/<slug>/index.html` styled like the existing Bali page in this repo. Then you commit and push so GitHub Pages deploys it.

## The 9-step workflow

You MUST follow these steps in order. Do not skip steps.

### Step 1: Parse the request

From the user's message, extract:
- **destination** (required): country, region, or city. Reject if missing.
- **dates** (optional): use them if given. Otherwise default to 14 days starting on the first of next month.
- **trip length** (optional): default 14, cap at 21, floor at 4.
- **notes** (optional): any user preferences ("beach focus", "no temples", "for a group of 6").

Generate a **slug** like `japan-march-2027` (destination kebab + month-year).

### Step 2: Plan the regions

Decide on 2–4 regions inside the destination. Use geography and character to pick — cultural hub + nature detour + beach/coastal area is a common pattern. Allocate nights per region proportional to its draw (longer in cultural hubs, shorter on detours). For 14 days a typical split is 6 + 3 + 5 or 5 + 4 + 5.

### Step 3: Research (mandatory)

Do all four research passes:

**3a. English web search.** For the destination and each region:
- "best things to do in <region>"
- "<region> hidden gems travel blog"
- "<region> budget hotel under $100 booking.com"
- "<region> best local restaurant warung / street food / cheap eats"

**3b. Social signal sweep.** For each region run these `site:` searches and harvest URLs + captions:
- `site:tiktok.com <region> hidden gem`
- `site:tiktok.com <region> travel`
- `site:reddit.com/r/travel <region>`
- `site:youtube.com <region> vlog`
- `site:instagram.com <region>`

Pick the 2–3 most-recurring TikTok URLs per region to embed as `<blockquote class="tiktok-embed" cite="<url>" data-video-id="<id>"></blockquote>` inside a `<details class="social-embeds">` block. Include `<script async src="https://www.tiktok.com/embed.js"></script>` once near the end of the page.

**3c. MANDATORY local-language sweep.** Identify the destination's primary language(s) and country TLD(s) (Japan: ja, .jp; Vietnam: vi, .vn; France: fr, .fr; etc.). Generate 6–10 search queries in the local language and run them:
- Restaurant recommendations in the local language ("おすすめ 京都 居酒屋", "meilleur restaurant Annecy", "best warung Ubud" if local language is English-adjacent)
- Neighborhood guides
- "Best of <region>" lists
- Add `site:.<tld>` to some queries to bias toward local sources

Fetch the top local-language pages. Pull out hotel / restaurant / activity names that don't appear in English results — these are gold. Surface 1–2 short translated quotes per region in the page using:
```html
<div class="local-quote">
  <em>"<translated quote>"</em>
  <cite>— <local source name> (translated from <language>)</cite>
</div>
```

If local-language search returns nothing useful for a region: log it (mention in your final report), continue without local content for that region.

**3d. Image hunt.** For each hotel / attraction / region banner, find an Unsplash photo:
- Search `site:unsplash.com <keyword>` via web search.
- Extract the photo ID (the `photo-<hash>` portion of the URL).
- Build the image URL: `https://images.unsplash.com/photo-<hash>?auto=format&fit=crop&w=<width>&q=80`. Use `w=1100` for hero banners, `w=260` for hotel thumbs, `w=220` for spot thumbs.

### Step 4: Pick content per region

For EACH region pick:
- **3–5 hotels**: mostly budget ($30–100/night), at least ONE luxury villa with an **Infinity Pool** somewhere across the trip. The infinity-pool villa is a HARD requirement — the validator exits with code 2 if no hotel has the literal feature tag "Infinity Pool". If you can't find one under $250/night, relax to "luxury villa with pool" and explicitly note this in your final report.
- **6–10 activities**: scored by mentions across English + local + social. Each activity needs: name, vibe one-liner, detail, price, an Unsplash thumb URL, and a drive-time `{ "<hotel-id>": <minutes> }` from that region's primary hotel. ANY activity over 60 minutes drive must NOT be assigned to a day — but include it in the swap pool with a note.
- **6–8 restaurants**: mix of cheap (warung / street food / $3–10), mid ($10–20), and 2 splurge ($30–60). Total splurges across the trip = 2 or 3, not more, not less.

Build the drive-time matrix for every activity and restaurant relative to the chosen primary hotel for that region. Use known geographic distances + typical traffic.

### Step 5: Build the day plan

Compose the trip-spec JSON (see Task 6 in the implementation plan for the exact shape) and write it to `/tmp/trip-spec.json`. Always provide `restSuggestions` — default to:
```
["Pool & book", "Couples spa near hotel", "Short walk in the neighborhood", "Sunset cocktail at hotel bar", "Late breakfast and lazy morning"]
```

Run:
```bash
node scripts/build-schedule.mjs /tmp/trip-spec.json > /tmp/day-plan.json
```

If the scheduler exits non-zero, read its stderr, adjust the spec (e.g. add more activities for an under-supplied region), and retry ONCE.

### Step 6: Fill the template

Read `templates/trip-page.html.tmpl` and `templates/swap-runtime.js`. Substitute every `{{PLACEHOLDER}}` and repeat fragment templates per the conventions in Task 8 of the implementation plan. The fragment template blocks live inside the `<template id="fragments">` element at the bottom of the .tmpl file — extract their innerHTML by matching the comment markers (e.g. `<!-- HOTEL_CARD_TEMPLATE_START -->`).

Write the filled HTML to `trips/<slug>/index.html`. Create the directory if it doesn't exist.

### Step 7: Verify

Run both checks. They MUST pass.

```bash
bash scripts/check-images.sh trips/<slug>/index.html
node scripts/validate-page.mjs trips/<slug>/index.html
```

**Image-check failures** (exit 1, "BROKEN" lines in output): for each broken URL, find a replacement on Unsplash via web search, substitute in the file, re-run `check-images.sh`. Max 3 retries per image. If after 3 retries an image is still broken, drop the image (remove the `<img>` element entirely).

**Validator exit 2** (only the infinity-pool check failed): find a luxury pool villa in the destination (search Unsplash + Booking.com via web search), add it to the trip, set its features list to include "Infinity Pool" (or "Luxury Pool Villa" if no infinity pool is actually available). Re-run validator. If still failing, accept the relaxation and note it in your final report.

**Validator exit 1** (anything else): read stderr, fix the specific violation, re-run.

### Step 8: Commit and push

```bash
git add trips/<slug>/ .opencode/  # (.opencode only if you somehow modified it)
git commit -m "feat: add <Destination> trip page

Generated by travel-agent. <N> days, <K> regions: <r1>, <r2>, …
At least one infinity-pool villa included. Day plan validated."
git push origin main
```

The GitHub Action will: rebuild the root `index.html` trips listing, validate every trip page, deploy to Pages. Watch the run:

```bash
gh run watch --exit-status
```

If the Action fails, the page will not deploy. Read the failure, fix it (commonly: an image broke between local check and CI — find a replacement and re-push).

### Step 9: Report

Reply to the user with:
- `trips/<slug>/index.html` — local path
- `https://mrafik92.github.io/bali-honeymoon/trips/<slug>/` — live Pages URL
- A 4–6 line summary: regions chosen, nights per region, one highlight per region, the luxury villa name, any flagged constraints.
- If anything was relaxed (no infinity pool found, missing local content, image dropped), state it clearly.

## Constraints (mandatory)

- **Pacing:** alternate active/rest. Day after every transfer = rest. No two consecutive active days.
- **Drive cap:** 60 min one-way max from hotel for any active-day activity.
- **Dinner per day:** every single day. Mostly cheap, exactly 2–3 splurges total.
- **Infinity-pool villa:** at least one. Relax to "luxury pool villa" with a note if not findable.
- **Trip length:** 4 ≤ N ≤ 21. Below 4, skip alternation. Above 21, cap and warn.
- **Research:** all four passes (English + social + LOCAL LANGUAGE + image hunt) are MANDATORY. Skipping the local-language pass is a hard failure of the agent — do not skip.
- **No new dependencies:** scheduler and validator are zero-dep Node ESM. Do not add npm dependencies.
- **Stay self-contained:** the generated page must be a single HTML file with inline CSS and inline JS. No external `.js` or `.css` references (except CDN fonts, which the template already uses).

## Common failure modes

- **Image returns 403/404 in CI but 200 locally.** Unsplash sometimes serves cached responses. Pre-warm by curl'ing each image URL once before committing. If a URL is flaky, replace it.
- **Local-language search returns thin results.** Some destinations have weak indexed local web. Don't fail — fall back to English sources and note the gap.
- **Scheduler exits non-zero with "region X exhausted".** That region needs more activities in the pool. Find 2–3 more via web search, add them, re-run.
- **Validator says splurges back-to-back.** Reorder: put a cheap day between the two splurges in the spec. Re-run scheduler.
- **The agent loop runs too long.** If you've spent 10+ research queries on a single region without consensus, just pick the highest-scoring 8 candidates and move on. Don't perfect — ship.

## Invocation examples

- `@travel-agent Japan` → 14 days from first of next month, 3 regions, defaults.
- `@travel-agent Vietnam, October 2027, 10 days, beach focus` → 10-day Vietnam with coastal regions weighted.
- `@travel-agent Lisbon and Algarve, July 4-15 2027` → 12 days, 2 regions (Lisbon city + Algarve coast).
- `@travel-agent Bali, March 1-14 2027` → DOGFOOD run for the existing Bali trip (Task 13).
```

- [ ] **Step 2: Verify the agent loads (restart OpenCode)**

The customize-opencode skill states: "Config is loaded once when opencode starts and is not hot-reloaded. After saving changes to an agent file, tell the user to quit and restart opencode."

Stop here in the implementation, **tell the human implementer to restart opencode**, then continue.

After restart, confirm the agent is registered:

```bash
# from within opencode after restart, the agent should be invocable.
# Type:  @travel-agent
# and you should see it autocomplete / be a valid handle.
```

- [ ] **Step 3: Commit the agent definition**

```bash
git add .opencode/agent/travel-agent.md
git commit -m "feat: add travel-agent OpenCode subagent

Generates a complete trip page for any destination via a 9-step
workflow: parse → regions → research (EN + social site: + mandatory
local-language + Unsplash) → pick content → build schedule → fill
template → verify (images + 12-check validator) → commit/push → report.

Requires restart of opencode to be registered."
```

- [ ] **Step 4: Push so the agent file is in main**

```bash
git push origin main
```

---

## Task 12: Dogfood — regenerate the Bali page through the agent

**Files:**
- Replace: `trips/bali-march-2027/index.html` (output of the agent)

**Interfaces:**
- Consumes: the agent (Task 11), all the scripts and template from prior tasks.
- Produces: a NEW `trips/bali-march-2027/index.html` generated from scratch by the agent. Should include the new day-by-day section, the infinity-pool villa, local quotes, and TikTok embeds — none of which the original Bali page had.

- [ ] **Step 1: Invoke the agent**

In opencode, send:
```
@travel-agent Bali, March 1-14 2027
```

The agent should run the 9-step workflow. Watch its tool calls — it will do many web searches, fetches, image lookups. Expect 5–10 minutes wall-clock.

- [ ] **Step 2: When the agent reports done, run validation manually**

```bash
node scripts/validate-page.mjs trips/bali-march-2027/index.html
bash scripts/check-images.sh trips/bali-march-2027/index.html
echo "exit: $?"
```
Expected: both pass, summary line printed.

- [ ] **Step 3: Visual spot-check**

Run:
```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory trips/bali-march-2027 &
SERVER_PID=$!
sleep 1
echo "→ open http://127.0.0.1:8765/ in a browser"
# eyeball it, then:
kill $SERVER_PID
```

Checklist for the eyeball pass:
- Hero looks like the old Bali page (same style, may differ in image choice — that's fine).
- Day-by-Day section exists between Overview and the first region.
- Each day card shows status badge, activity (or rest suggestion), dinner, drive time.
- At least one hotel card has "Infinity Pool" in its features.
- At least one region has a local-quote callout.
- At least one region has a `<details class="social-embeds">` with TikTok blockquotes.
- Click "swap activity" on a day card → inline list appears with eligible alternatives.
- Click "swap dinner" → list appears.
- Click "Print" → browser print dialog opens, preview shows clean layout.
- localStorage: open devtools console, run `localStorage.getItem("trip:bali-march-2027")` after a swap → returns JSON.

- [ ] **Step 4: If anything fails, iterate**

- Style drift (the agent picked different fonts/colors): the template should be byte-identical CSS. Diff the new page's `<style>` block against the template — they should match. If the agent rewrote CSS, update the agent prompt to forbid CSS edits.
- Missing infinity pool: the validator should have caught this (exit 2). If it slipped through, validator has a bug.
- Day plan looks weird (e.g. activity on a transfer day, drive > 60 min): the scheduler has a bug or the agent gave it bad input. Check `/tmp/trip-spec.json` if the agent kept it.

- [ ] **Step 5: Commit (if the agent didn't already)**

The agent commits as part of its workflow. If it didn't (or you had to fix manually):
```bash
git add trips/bali-march-2027/index.html
git commit -m "feat: regenerate Bali page through travel-agent (dogfood)

Dogfood test of the travel-agent. New version includes the day-by-day
plan, a luxury infinity-pool villa, local-language quotes from Balinese
sources, and embedded TikTok content. Original page kept in git history
at commit <ORIGINAL_HASH>."
git push origin main
```

- [ ] **Step 6: Verify Pages deploys cleanly**

```bash
gh run watch --exit-status
sleep 30
curl -sI https://mrafik92.github.io/bali-honeymoon/trips/bali-march-2027/ | head -2
```
Expected: HTTP 200, page is live with the new content.

---

## Task 13: Dogfood 2 — generate a NEW destination

**Files:**
- Create: `trips/<new-slug>/index.html` (agent output)

**Interfaces:**
- Consumes: the agent.
- Produces: a brand-new trip page proving the agent handles destinations it hasn't seen before.

- [ ] **Step 1: Invoke the agent on a fresh destination**

In opencode:
```
@travel-agent Japan
```

(Or any destination with rich English + non-English web presence — Vietnam, Thailand, Mexico, Portugal, etc.)

- [ ] **Step 2: Watch the run**

Expect the agent to pick ~3 regions (e.g. Tokyo + Kyoto + Kanazawa for Japan). Local-language sweep should produce Japanese search queries. Expect 5–15 minutes.

- [ ] **Step 3: Validate the output**

```bash
SLUG=$(ls -1 trips/ | grep -v bali | head -1)
node scripts/validate-page.mjs trips/$SLUG/index.html
bash scripts/check-images.sh trips/$SLUG/index.html
```
Expected: both pass.

- [ ] **Step 4: Verify Pages deploys**

```bash
gh run watch --exit-status
sleep 30
curl -sI "https://mrafik92.github.io/bali-honeymoon/trips/$SLUG/" | head -2
curl -s https://mrafik92.github.io/bali-honeymoon/ | rg -c "$SLUG"
```
Expected: trip page returns 200. Root index now lists 2 trips.

- [ ] **Step 5: If issues found, fix in the agent prompt (not in the page)**

The agent prompt is the right place for systemic fixes. Iterating: edit `.opencode/agent/travel-agent.md`, restart opencode, re-run. Each re-run blows away `trips/<slug>/` (or commit the iteration as a separate trip slug to compare).

- [ ] **Step 6: Commit if needed**

```bash
git add -A
git commit -m "test: validate travel-agent on new destination ($SLUG)"
git push origin main
```

---

## Task 14: Cleanup

**Files:**
- Delete: `scripts/render-bali.mjs` (throwaway from Task 10)
- Delete: `scripts/__tests__/fixtures/bali-content.json` (throwaway from Task 10)
- Verify: `/tmp/bali-rendered.html` no longer referenced anywhere (it was never committed)

**Interfaces:**
- Consumes: nothing
- Produces: a cleaner repo with only the production-path files.

- [ ] **Step 1: Delete the throwaways**

```bash
git rm scripts/render-bali.mjs scripts/__tests__/fixtures/bali-content.json
```

- [ ] **Step 2: Verify no other file references them**

```bash
rg -l 'render-bali|bali-content' || echo "no references found"
```
Expected: `no references found`.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove throwaway render-bali script + fixture

The agent now regenerates Bali end-to-end (verified in Task 12), so
the dogfooding scaffold from Task 10 is no longer needed."
git push origin main
```

---

## Task 15: README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the entire repo state.
- Produces: a short README explaining what this repo is and how to use it.

- [ ] **Step 1: Write the README**

Write to `README.md`:

```markdown
# Honeymoon Planner

Travel pages for upcoming trips, served from GitHub Pages at
[mrafik92.github.io/bali-honeymoon](https://mrafik92.github.io/bali-honeymoon).

## Trips

Live trips are listed at the URL above. Each trip lives at
`trips/<slug>/index.html` and is a single self-contained HTML file.

## Generating a new trip

This repo has an OpenCode subagent that generates a complete trip page
for any destination. From within opencode:

    @travel-agent Japan
    @travel-agent Vietnam, October 2027, 10 days, beach focus
    @travel-agent Lisbon and Algarve, July 4-15 2027

The agent does live web research (English + social signal sweep on
TikTok / Reddit / YouTube / Instagram + mandatory local-language
search), picks hotels / activities / restaurants, builds a day-by-day
plan that respects pacing rules, fills a strict HTML template, runs
image + structural validation, commits, and pushes. The GitHub Action
deploys.

## Repo layout

    .opencode/agent/travel-agent.md    the subagent definition
    templates/trip-page.html.tmpl      the strict HTML template
    templates/swap-runtime.js          inlined per-page swap-pool JS
    scripts/build-schedule.mjs         deterministic scheduler (Node 20, no deps)
    scripts/validate-page.mjs          12-check structural validator
    scripts/build-index.mjs            rebuilds the root trips listing in CI
    scripts/check-images.sh            asserts all Unsplash URLs return 200
    scripts/install-hooks.sh           sets up the pre-push image-check hook
    .github/workflows/pages.yml        deploys to GitHub Pages on push to main
    trips/<slug>/index.html            generated trip pages
    docs/superpowers/specs/            design specs
    docs/superpowers/plans/            implementation plans

## Local dev

    # install Node 20 (one-time)
    curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.xz | tar -xJ -C ~/.local/node --strip-components=1
    export PATH="$HOME/.local/node/bin:$PATH"

    # install the pre-push image-check hook
    bash scripts/install-hooks.sh

    # validate a generated page locally
    node scripts/validate-page.mjs trips/bali-march-2027/index.html
    bash scripts/check-images.sh trips/bali-march-2027/index.html

    # serve locally
    python3 -m http.server 8765 --directory trips/bali-march-2027

## Rules baked into the agent

- Alternate active/rest days, with extra rest after any transfer day.
- Activities must be ≤ 60 min drive from the chosen hotel.
- One dinner per day. Mostly cheap (street food / warung). 2–3 fancy splurges total per trip.
- At least one luxury villa with an infinity pool somewhere in the trip.
- Trip length: 4–21 days, default 14 starting the first of next month.
- Research is mandatory: English + social (TikTok / Reddit / YouTube / IG via `site:` search) + local-language with translated quotes surfaced in the page.

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for full design.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README

Explains the repo layout, how to invoke the travel-agent, and the
rules baked into it. Links to the design spec and implementation plan."
git push origin main
```

---

## Done

At this point:
- The agent generates trip pages for any destination.
- The Bali page has been regenerated through the agent (proven end-to-end).
- A second destination has been generated (further confidence).
- All scripts are zero-dependency Node 20 ESM with self-tests.
- Pages deploys on every push.
- The old URL `https://mrafik92.github.io/bali-honeymoon/` still works (now a listing + redirect).

Future improvements (NOT in this plan — explicitly out of scope per spec §"Non-goals"):
- Live drive-time API (Google Maps / OpenRouteService).
- Real-time price scraping.
- Multi-user editing.
- A trip-spec editor UI.
- Image self-hosting.


