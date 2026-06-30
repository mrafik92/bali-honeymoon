// Inlined into every generated trip page. Pure ES2020, no dependencies.
// Reads the trip-data JSON block (#trip-data), restores overrides from
// localStorage, wires up swap / reset / shuffle / print buttons.

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
      return `<div class="transfer-note"><span>✈️</span> Transfer day — travel logistics in the region section below.</div>`;
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
    // Client-side shuffle: rotate eligible activities through active days within each region.
    const days = applyOverrides(trip.days);
    const rng = Math.random;
    const byRegion = {};
    for (const d of days) {
      if (d.status === "active") (byRegion[d.region] = byRegion[d.region] || []).push(d);
    }
    for (const region in byRegion) {
      const activeDays = byRegion[region];
      const pool = eligibleActivities(region, -1, []).slice();
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
