#!/usr/bin/env node
// Watches the PKW results for the Kraków runoff and republishes
// data/results.json whenever PKW reports more counted commissions.
//
//   node scripts/pkw-watch.mjs --url <PKW address> [--interval 30] [--push]
//
// Every --interval seconds it downloads the PKW data, turns it into the
// site's results format (scripts/pkw-adapter.mjs), and, if the number of
// counted commissions went up, writes data/results.json. With --push it also
// commits ("Refresh the PKW count to N commissions, P percent.") and pushes,
// using the git identity already set for the repository. It stops once PKW
// has counted every commission. No dependencies; Node 18 or newer.
//
// Other flags:
//   --once          check one time and exit
//   --dry-run       show what would change, write nothing
//   --format X      "pkw" (default) or "results" (the address already serves
//                   the site's own results format, e.g. for a test)
//   --max-hours N   give up after N hours (default 8)

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { toResults } from "./pkw-adapter.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = path.join(ROOT, "data", "results.json");

const args = parseArgs(process.argv.slice(2));
const url = args.url || process.env.PKW_URL;
const interval = Math.max(10, Number(args.interval || process.env.PKW_INTERVAL || 30));
const maxHours = Number(args["max-hours"] || 8);
const format = args.format || "pkw";

if (!url) {
  console.error("Podaj adres danych PKW: --url <adres> (albo zmienna PKW_URL).");
  process.exit(2);
}

const candidates = JSON.parse(await readFile(path.join(ROOT, "data", "candidates.json"), "utf8")).candidates;
const started = Date.now();

for (;;) {
  const finished = await check().catch((error) => {
    log(`błąd: ${error.message}`);
    return false;
  });
  if (finished || args.once) break;
  if (Date.now() - started > maxHours * 3600e3) {
    log(`koniec czasu (${maxHours} h), zatrzymuję.`);
    break;
  }
  await sleep(interval * 1000);
}

async function check() {
  const raw = await download(url);
  const next = format === "results" ? JSON.parse(raw) : toResults(raw, { candidates });
  validate(next);
  const current = JSON.parse(await readFile(RESULTS, "utf8"));
  const was = current.precinctsReporting || 0;
  const now = next.precinctsReporting;
  const total = next.precinctsTotal;
  const done = now >= total;
  log(`PKW: ${now}/${total} komisji (${percent(now, total)}%), na stronie: ${was}/${total}.`);
  // Publish only when more commissions are counted, as agreed. A final
  // status change at 100% also counts.
  const final = done && current.status !== "final";
  if (now <= was && !final) return done && current.status === "final";
  if (args["dry-run"]) {
    log("(dry run) opublikowałbym nowy stan.");
    return done;
  }
  await writeFile(RESULTS, `${JSON.stringify(next, null, 2)}\n`);
  log(`zapisano data/results.json (${now}/${total}).`);
  if (args.push) publish(`Refresh the PKW count to ${now} commissions, ${percent(now, total)} percent.`);
  return done;
}

function publish(message) {
  const git = (...rest) => execFileSync("git", rest, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  git("add", "data/results.json");
  try {
    git("commit", "-m", message);
  } catch {
    log("brak zmian do zatwierdzenia.");
    return;
  }
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      git("push", "origin", "HEAD:main");
      log(`wysłano: ${message}`);
      requestPagesBuild();
      return;
    } catch (error) {
      log(`push się nie udał (próba ${attempt}): ${String(error.stderr || error.message).trim().split("\n").pop()}`);
      try {
        git("pull", "--rebase", "origin", "main");
      } catch {
        /* retry the push anyway */
      }
    }
  }
  throw new Error("nie udało się wysłać zmian na GitHub.");
}

// In GitHub Actions, ask Pages to rebuild in case a push made with the
// workflow token does not start a build on its own.
function requestPagesBuild() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return;
  fetch(`https://api.github.com/repos/${repo}/pages/builds`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  })
    .then((response) => log(`GitHub Pages: prośba o przebudowę (${response.status}).`))
    .catch(() => {});
}

async function download(address) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(address, {
        headers: { "User-Agent": "krakow-wybory-2-tura (mapa wyników)", "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`PKW odpowiedziało ${response.status}`);
      let bytes = Buffer.from(await response.arrayBuffer());
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
      return bytes.toString("utf8");
    } catch (error) {
      lastError = error;
      await sleep(2000 * attempt);
    }
  }
  throw lastError;
}

// The site's results contract (see docs/HANDOVER.md). Refuse anything that
// would show wrong numbers rather than publish it.
function validate(results) {
  const total = results.precinctsTotal;
  if (!Number.isInteger(total) || total < 1) throw new Error("brak precinctsTotal");
  if (!Number.isInteger(results.precinctsReporting)) throw new Error("brak precinctsReporting");
  let reported = 0;
  for (let nr = 1; nr <= total; nr += 1) {
    const row = results.precincts && results.precincts[String(nr)];
    if (!row) throw new Error(`brak komisji ${nr}`);
    if (!row.reported) continue;
    reported += 1;
    for (const key of ["validVotes"]) {
      if (typeof row[key] !== "number") throw new Error(`komisja ${nr}: brak ${key}`);
    }
    for (const candidate of candidates) {
      if (typeof (row.votes || {})[candidate.id] !== "number") throw new Error(`komisja ${nr}: brak głosów ${candidate.id}`);
    }
  }
  if (reported !== results.precinctsReporting) {
    throw new Error(`precinctsReporting=${results.precinctsReporting}, a policzonych komisji jest ${reported}`);
  }
}

function percent(part, whole) {
  return whole > 0 ? Math.round((10000 * part) / whole) / 100 : 0;
}

function parseArgs(list) {
  const out = {};
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = list[index + 1];
    if (value === undefined || value.startsWith("--")) out[key] = true;
    else {
      out[key] = value;
      index += 1;
    }
  }
  return out;
}

function log(message) {
  const time = new Date().toLocaleTimeString("pl-PL", { timeZone: "Europe/Warsaw" });
  console.log(`[${time}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
