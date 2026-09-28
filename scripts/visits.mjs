#!/usr/bin/env node
// Shows the site's visit counts, split at the polls closing
// (Sunday 11 October 2026, 21:00 Polish time):
//
//   node scripts/visits.mjs
//
// "Wejścia" counts every page load; "osoby" counts each browser once per
// period. The page records them (js/map.js, countVisit); this only reads.

const BASE = "https://abacus.jasoncameron.dev/get/terra-cracovianum.github.io/krakow-2-tura";
const rows = [
  ["Do 11.10, 21:00", "przed"],
  ["Po 11.10, 21:00", "po"],
];

const read = async (key) => {
  try {
    const response = await fetch(`${BASE}-${key}`, { signal: AbortSignal.timeout(15000) });
    if (response.status === 404) return 0;
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.value === "number" ? body.value : null;
  } catch {
    return null;
  }
};

const table = [];
let visits = 0;
let people = 0;
for (const [label, period] of rows) {
  const [v, p] = await Promise.all([read(`${period}-wejscia`), read(`${period}-osoby`)]);
  table.push({ Okres: label, Wejścia: v ?? "brak odpowiedzi", Osoby: p ?? "brak odpowiedzi" });
  visits += v || 0;
  people += p || 0;
}
table.push({ Okres: "Razem", Wejścia: visits, Osoby: people });
console.table(table);
