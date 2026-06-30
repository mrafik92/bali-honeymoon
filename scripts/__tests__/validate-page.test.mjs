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
