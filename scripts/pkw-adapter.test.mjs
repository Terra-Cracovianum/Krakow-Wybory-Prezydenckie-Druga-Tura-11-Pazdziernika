import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPkw, toResults } from "./pkw-adapter.mjs";
import { nextHistory } from "./pkw-history.mjs";
import { buildResults } from "./pkw-results.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES = [
  { id: "gibala", ballot: 1 },
  { id: "piatkowska", ballot: 2 },
];

test("the live Kraków blob is the runoff and has no counted commissions yet", async () => {
  const blob = await readFile(path.join(ROOT, "scripts/fixtures/pkw-4485-20261011.blob"));
  const info = inspectPkw(blob);
  assert.equal(info.file, "20261011_WBP_Krakow_tura_2");
  assert.equal(info.commissions, 454);
  assert.equal(info.protocols, 0);
  const results = toResults(blob, { candidates: CANDIDATES });
  assert.equal(results.round, 2);
  assert.equal(results.status, "awaiting");
  assert.equal(results.precinctsReporting, 0);
  assert.equal(results.candidates.gibala, 0);
  assert.equal(results.candidates.piatkowska, 0);
  assert.equal(results.precincts["1"].reported, false);
  assert.equal(results.pkwFile, "20261011_WBP_Krakow_tura_2");
});

test("a first-round file without secondRound is refused", () => {
  const blob = message([[30, "20260927_WBP_Krakow_tura_1"]]);
  assert.throws(() => toResults(blob, { candidates: CANDIDATES }), /drugiej tury/);
});

test("one second-round protocol becomes that commission's votes", () => {
  const protocol = message([
    [2, zig(900)],
    [5, zig(1000)],
    [10, zig(400)],
    [25, zig(390)],
    [26, zig(10)],
    [27, zig(380)],
    [28, line(5020512, 210)],
    [28, line(5019538, 170)],
  ]);
  const commission = message([[2, message([[1, 12], [6, 900]])]]);
  const round = message([
    [2, zig(1_791_714_072)],
    [15, commission],
    [20, protocol],
    [30, "20261011_WBP_Krakow_tura_2"],
  ]);
  // A first-round protocol with a huge total must not leak into the runoff.
  const leaked = message([
    [2, zig(1)],
    [27, zig(99999)],
    [28, line(5020512, 99999)],
  ]);
  const blob = message([
    [15, message([[2, message([[1, 12], [6, 1]])]])],
    [20, leaked],
    [24, round],
    [30, "20260927_WBP_Krakow_tura_1"],
  ]);
  const results = toResults(blob, { candidates: CANDIDATES });
  assert.equal(results.precinctsReporting, 1);
  assert.equal(results.status, "partial");
  assert.equal(results.precincts["12"].reported, true);
  assert.equal(results.precincts["12"].eligible, 1000);
  assert.equal(results.precincts["12"].ballots, 400);
  assert.equal(results.precincts["12"].validCards, 390);
  assert.equal(results.precincts["12"].validVotes, 380);
  assert.equal(results.precincts["12"].invalidVotes, 10);
  assert.equal(results.precincts["12"].votes.gibala, 210);
  assert.equal(results.precincts["12"].votes.piatkowska, 170);
  assert.equal(results.candidates.gibala, 210);
  assert.equal(results.precincts["1"].reported, false);
});

test("history keeps the hour, the split and the district", async () => {
  const previous = buildResults([], { candidates: CANDIDATES, updatedAt: "2026-10-11T17:00:00.000Z" });
  const next = buildResults(
    [{ nr: 1, reported: true, eligible: 100, ballots: 60, validCards: 60, validVotes: 58, invalidVotes: 2, votes: { gibala: 40, piatkowska: 18 } }],
    { candidates: CANDIDATES, updatedAt: "2026-10-11T19:10:00.000Z" }
  );
  const districts = JSON.parse(await readFile(path.join(ROOT, "data/districts.geojson"), "utf8"));
  const history = nextHistory(
    { events: [] },
    { previous, next, districts, source: "https://example.test/4485.blob", page: "https://example.test/gm/4485" }
  );
  assert.equal(history.events.length, 1);
  const event = history.events[0];
  assert.equal(event.at, "2026-10-11T19:10:00.000Z");
  assert.equal(event.precinctsReporting, 1);
  assert.equal(event.percent, 0.22);
  assert.equal(event.candidates.gibala, 40);
  assert.equal(event.candidates.piatkowska, 18);
  assert.equal(event.added.length, 1);
  assert.equal(event.added[0].nr, 1);
  const first = event.districts.find((row) => row.dzielnica === "Dzielnica I");
  assert.equal(first.reporting, 1);
  assert.equal(first.votes.gibala, 40);
  assert.equal(first.votes.piatkowska, 18);
  const special = event.districts.find((row) => row.dzielnica === "Obwody specjalne");
  assert.equal(special.reporting, 0);
  assert.ok(special.precincts > 0);
  const again = nextHistory(history, { previous: next, next, districts, source: history.source, page: history.page });
  assert.equal(again.events.length, 1);
});

function line(id, votes) {
  return message([
    [3, zig(votes)],
    [8, zig(id)],
  ]);
}

function message(pairs) {
  return Buffer.concat(pairs.map(([fn, value]) => (typeof value === "string" || Buffer.isBuffer(value) ? fieldBytes(fn, value) : fieldVarint(fn, value))));
}

function fieldVarint(fn, value) {
  return Buffer.concat([varint((fn << 3) | 0), varint(value)]);
}

function fieldBytes(fn, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([varint((fn << 3) | 2), varint(bytes.length), bytes]);
}

function varint(value) {
  let n = BigInt(value);
  const out = [];
  while (n > 127n) {
    out.push(Number((n & 127n) | 128n));
    n >>= 7n;
  }
  out.push(Number(n));
  return Buffer.from(out);
}

function zig(value) {
  const n = BigInt(value);
  return (n << 1n) ^ (n < 0n ? -1n : 0n);
}
