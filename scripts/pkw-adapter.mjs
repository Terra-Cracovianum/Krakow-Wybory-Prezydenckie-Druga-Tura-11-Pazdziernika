// Turns the PKW data into the site's results format (see docs/HANDOVER.md,
// "Results file"). Everything here is shared except readCommissions(), which
// has to match the exact file PKW publishes for the runoff. That address is
// only known on election day, so readCommissions() is the one piece to fill
// in then: return one row per commission, in the shape described below.

const TOTAL = 454;

/**
 * @param {string} raw  the downloaded PKW file (already un-gzipped)
 * @param {{ candidates: { id: string }[] }} context
 */
export function toResults(raw, { candidates }) {
  const data = JSON.parse(raw);
  // The site's own format passes straight through (useful for tests and
  // for a hand-made file in an emergency).
  if (data && data.precincts && Number.isInteger(data.precinctsTotal)) return data;
  const { rows, updatedAt, totals } = readCommissions(data, candidates);
  return buildResults(rows, { candidates, updatedAt, totals });
}

/**
 * Election day: map the PKW file to rows like
 *   { nr: 12, reported: true, eligible: 1518, ballots: 660, validCards: 660,
 *     validVotes: 655, invalidVotes: 5, votes: { gibala: 330, piatkowska: 325 } }
 * `nr` is the commission number 1–454. PKW leaves out fields that are zero;
 * buildResults() fills them in, so just pass what PKW has. Optionally also
 * return the city `totals` exactly as PKW states them, and `updatedAt`.
 */
function readCommissions(data, candidates) {
  throw new Error(
    "Format danych PKW nie jest jeszcze zmapowany w scripts/pkw-adapter.mjs (readCommissions). " +
      "Podaj adres PKW z dnia wyborów, a funkcja zostanie dopasowana do tego pliku."
  );
}

const NUMBERS = ["eligible", "ballots", "validCards", "validVotes", "invalidVotes"];

export function buildResults(rows, { candidates, updatedAt, totals } = {}) {
  const byNr = new Map(rows.map((row) => [String(row.nr), row]));
  const precincts = {};
  for (let nr = 1; nr <= TOTAL; nr += 1) {
    const row = byNr.get(String(nr));
    if (!row || !row.reported) {
      // Keep an eligible count PKW already publishes; it tightens the
      // "winner decided" check on the site.
      precincts[String(nr)] = row && Number.isFinite(row.eligible) ? { reported: false, eligible: row.eligible } : { reported: false };
      continue;
    }
    const clean = { reported: true };
    // A counted commission with all zeros is still counted: write the zeros.
    for (const key of NUMBERS) clean[key] = Number(row[key]) || 0;
    clean.votes = {};
    for (const candidate of candidates) clean.votes[candidate.id] = Number((row.votes || {})[candidate.id]) || 0;
    precincts[String(nr)] = clean;
  }
  const counted = Object.values(precincts).filter((row) => row.reported);
  const sum = (pick) => counted.reduce((total, row) => total + pick(row), 0);
  const city = {};
  for (const key of NUMBERS) city[key] = totals && Number.isFinite(totals[key]) ? totals[key] : sum((row) => row[key]);
  const cityVotes = {};
  for (const candidate of candidates) {
    const stated = totals && totals.votes && totals.votes[candidate.id];
    cityVotes[candidate.id] = Number.isFinite(stated) ? stated : sum((row) => row.votes[candidate.id]);
  }
  const reporting = counted.length;
  return {
    status: reporting === 0 ? "awaiting" : reporting >= TOTAL ? "final" : "partial",
    round: 2,
    updatedAt: updatedAt || new Date().toISOString(),
    precinctsTotal: TOTAL,
    precinctsReporting: reporting,
    ...city,
    turnout: city.eligible > 0 ? Math.round((10000 * city.validCards) / city.eligible) / 100 : null,
    candidates: cityVotes,
    precincts,
  };
}
