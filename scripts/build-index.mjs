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
