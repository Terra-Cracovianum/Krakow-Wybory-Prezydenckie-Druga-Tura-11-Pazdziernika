// Appends one snapshot whenever more commissions are counted.
// Each event stores the city and the districts at that moment, plus only the
// commissions that became counted since the previous file, so the page can
// rebuild the map at any hour without keeping a full copy every time.

const SPECIAL = "Obwody specjalne";

export function nextHistory(history, { previous, next, districts, source, page }) {
  const was = previous.precinctsReporting || 0;
  const now = next.precinctsReporting || 0;
  const base = {
    source: source || history?.source || "",
    page: page || history?.page || "",
    events: Array.isArray(history?.events) ? history.events : [],
  };
  if (now <= was) return base;
  const added = [];
  for (let nr = 1; nr <= next.precinctsTotal; nr += 1) {
    const row = next.precincts[String(nr)];
    const old = previous.precincts && previous.precincts[String(nr)];
    if (!row || !row.reported || (old && old.reported)) continue;
    added.push({
      nr,
      eligible: row.eligible || 0,
      ballots: row.ballots || 0,
      validCards: row.validCards || 0,
      validVotes: row.validVotes || 0,
      invalidVotes: row.invalidVotes || 0,
      votes: { ...(row.votes || {}) },
    });
  }
  if (added.length !== now - was) {
    throw new Error(`Historia: przybyło ${now - was} obwodów, a w pliku jest ${added.length} nowych.`);
  }
  const valid = Number(next.validVotes) || 0;
  const shares = {};
  for (const [id, votes] of Object.entries(next.candidates || {})) {
    shares[id] = valid > 0 ? Math.round((10000 * votes) / valid) / 100 : 0;
  }
  base.events.push({
    at: next.updatedAt,
    precinctsReporting: now,
    precinctsTotal: next.precinctsTotal,
    percent: next.precinctsTotal > 0 ? Math.round((10000 * now) / next.precinctsTotal) / 100 : 0,
    eligible: next.eligible ?? null,
    ballots: next.ballots ?? null,
    validCards: next.validCards ?? null,
    validVotes: next.validVotes ?? null,
    invalidVotes: next.invalidVotes ?? null,
    turnout: next.turnout ?? null,
    candidates: { ...(next.candidates || {}) },
    shares,
    districts: districtRollup(next, districts),
    added,
  });
  return base;
}

export function districtRollup(results, districts) {
  const home = new Map();
  const rows = [];
  for (const feature of districts.features || []) {
    const name = feature.properties.dzielnica;
    const numbers = feature.properties.nrs || [];
    for (const nr of numbers) home.set(String(nr), name);
    rows.push(blank(name, numbers.length));
  }
  const byName = new Map(rows.map((row) => [row.dzielnica, row]));
  let specialCount = 0;
  for (let nr = 1; nr <= results.precinctsTotal; nr += 1) {
    if (!home.has(String(nr))) specialCount += 1;
  }
  const special = blank(SPECIAL, specialCount);
  rows.push(special);
  byName.set(SPECIAL, special);
  for (let nr = 1; nr <= results.precinctsTotal; nr += 1) {
    const precinct = results.precincts[String(nr)];
    if (!precinct || !precinct.reported) continue;
    const bucket = byName.get(home.get(String(nr)) || SPECIAL);
    bucket.reporting += 1;
    bucket.validVotes += precinct.validVotes || 0;
    for (const [id, votes] of Object.entries(precinct.votes || {})) {
      bucket.votes[id] = (bucket.votes[id] || 0) + votes;
    }
  }
  return rows;
}

function blank(dzielnica, precincts) {
  return { dzielnica, precincts, reporting: 0, validVotes: 0, votes: {} };
}
