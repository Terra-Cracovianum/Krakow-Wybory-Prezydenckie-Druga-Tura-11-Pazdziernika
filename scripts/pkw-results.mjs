// Shared shape of data/results.json. PKW leaves out fields that are zero;
// buildResults fills them in and sums the city, unless PKW states the totals.

const TOTAL = 454;

const NUMBERS = ["eligible", "ballots", "validCards", "validVotes", "invalidVotes"];

export function buildResults(rows, { candidates, updatedAt, totals } = {}) {
  const byNr = new Map(rows.map((row) => [String(row.nr), row]));
  const precincts = {};
  for (let nr = 1; nr <= TOTAL; nr += 1) {
    const row = byNr.get(String(nr));
    if (!row || !row.reported) {
      precincts[String(nr)] = row && Number.isFinite(row.eligible) ? { reported: false, eligible: row.eligible } : { reported: false };
      continue;
    }
    const clean = { reported: true };
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
