// Turns the PKW protobuf for Kraków (gmina 4485) into the site's results
// format. The downloaded file is one Uzupelniajace message. Its top level is
// still the first round (27 September). The runoff is the nested secondRound.
// Reading the top level would publish September votes as October votes, so
// this file refuses to do that.

import { buildResults } from "./pkw-results.mjs";

export { buildResults };

export const PKW_BLOB_URL = "https://wybory.gov.pl/wojtburmistrz_2024_2029/data/details/4485.blob";
export const PKW_PAGE_URL = "https://wybory.gov.pl/wojtburmistrz_2024_2029/pl/4485/wyniki";

// Candidate ids from the PKW committees in the same file (Kandydat.id).
const PKW_CANDIDATE_IDS = {
  5020512: "gibala",
  5019538: "piatkowska",
};

/**
 * @param {Buffer | Uint8Array | string} raw  the PKW blob, or the site's own JSON
 * @param {{ candidates: { id: string, ballot?: number }[] }} context
 */
export function toResults(raw, { candidates }) {
  const bytes = asBytes(raw);
  if (bytes[0] === 0x7b) {
    const data = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (data && data.precincts && Number.isInteger(data.precinctsTotal)) return data;
    throw new Error("Plik JSON nie jest plikiem wyników tej strony.");
  }
  const decoded = decodeRunoff(bytes);
  const { rows, updatedAt, totals } = rowsFromRunoff(decoded, candidates);
  const results = buildResults(rows, { candidates, updatedAt, totals });
  results.source = PKW_BLOB_URL;
  results.page = PKW_PAGE_URL;
  results.pkwFile = decoded.file || "";
  return results;
}

/** Short description for the watcher log. Does not publish anything. */
export function inspectPkw(raw) {
  const decoded = decodeRunoff(asBytes(raw));
  return {
    file: decoded.file,
    updatedAt: stamp(decoded.updatedAt),
    commissions: decoded.commissions.length,
    protocols: decoded.protocols.length,
    page: PKW_PAGE_URL,
    blob: PKW_BLOB_URL,
  };
}

function asBytes(raw) {
  if (typeof raw === "string") return Buffer.from(raw);
  if (Buffer.isBuffer(raw)) return raw;
  return Buffer.from(raw);
}

function decodeRunoff(bytes) {
  const top = decodeUzupelniajace(bytes);
  const round = top.secondRound;
  if (!round || !round.commissions.length) {
    throw new Error(
      "Plik PKW nie zawiera drugiej tury (secondRound). Nie publikuję wyników pierwszej tury."
    );
  }
  if (round.file && !round.file.includes("tura_2")) {
    throw new Error(`Plik drugiej tury ma niespodziewaną nazwę: ${round.file}`);
  }
  return round;
}

function rowsFromRunoff(round, candidates) {
  const byId = new Map();
  for (const protocol of round.protocols) {
    if (byId.has(protocol.id)) throw new Error(`Powtórzony protokół ${protocol.id}`);
    byId.set(protocol.id, protocol);
  }
  const claimed = new Set();
  const rows = round.commissions.map((commission) => {
    const protocol = byId.get(commission.id);
    if (!protocol) {
      return { nr: commission.nr, reported: false };
    }
    claimed.add(protocol.id);
    return {
      nr: commission.nr,
      reported: true,
      eligible: protocol.eligible,
      ballots: protocol.ballots,
      validCards: protocol.validCards,
      validVotes: protocol.validVotes,
      invalidVotes: protocol.invalidVotes,
      votes: votesFor(protocol, candidates),
    };
  });
  const numbers = new Set(rows.map((row) => row.nr));
  if (numbers.size !== rows.length) throw new Error("Powtórzony numer obwodu w drugiej turze.");
  const unmatched = round.protocols.filter((protocol) => !claimed.has(protocol.id));
  if (unmatched.length) {
    throw new Error(`${unmatched.length} protokołów drugiej tury nie pasuje do numeru obwodu.`);
  }
  const totals = round.city ? cityTotals(round.city, candidates) : undefined;
  return { rows, updatedAt: stamp(round.updatedAt), totals };
}

function votesFor(protocol, candidates) {
  const votes = {};
  for (const candidate of candidates) votes[candidate.id] = 0;
  const shortBallot = protocol.lines.length <= candidates.length;
  for (const line of protocol.lines) {
    const id = candidateKey(line, candidates, shortBallot);
    if (!id || !(id in votes)) continue;
    votes[id] += line.votes;
  }
  return votes;
}

function candidateKey(line, candidates, shortBallot) {
  if (PKW_CANDIDATE_IDS[line.id]) return PKW_CANDIDATE_IDS[line.id];
  const name = fold(line.name);
  if (name.includes("gibala")) return "gibala";
  if (name.includes("piatkow")) return "piatkowska";
  if (!shortBallot) return "";
  const byBallot = candidates.find((candidate) => candidate.ballot === line.nr);
  return byBallot ? byBallot.id : "";
}

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cityTotals(protocol, candidates) {
  return {
    eligible: protocol.eligible,
    ballots: protocol.ballots,
    validCards: protocol.validCards,
    validVotes: protocol.validVotes,
    invalidVotes: protocol.invalidVotes,
    votes: votesFor(protocol, candidates),
  };
}

function stamp(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

function decodeUzupelniajace(buf) {
  const out = { commissions: [], protocols: [], file: "", updatedAt: 0, city: null, secondRound: null };
  for (const field of fields(buf)) {
    if (field.fn === 2 && field.wt === 0) out.updatedAt = sint32(field.v);
    else if (field.fn === 15 && field.wt === 2) out.commissions.push(decodeCommission(field.v));
    else if (field.fn === 20 && field.wt === 2) out.protocols.push(decodeProtocol(field.v));
    else if (field.fn === 24 && field.wt === 2) out.secondRound = decodeUzupelniajace(field.v);
    else if (field.fn === 25 && field.wt === 2) out.city = decodeProtocol(field.v);
    else if (field.fn === 30 && field.wt === 2) out.file = utf8(field.v);
  }
  return out;
}

function decodeCommission(buf) {
  let numer = 0;
  let id = 0;
  for (const field of fields(buf)) {
    if (field.fn === 2 && field.wt === 2) {
      for (const inner of fields(field.v)) {
        if (inner.fn === 1 && inner.wt === 0) numer = int32(inner.v);
        else if (inner.fn === 6 && inner.wt === 0) id = int32(inner.v);
      }
    }
  }
  if (!Number.isInteger(numer) || numer < 1) throw new Error("Obwód PKW bez numeru.");
  return { nr: numer, id };
}

function decodeProtocol(buf) {
  const protocol = {
    id: 0,
    eligible: 0,
    ballots: 0,
    validCards: 0,
    validVotes: 0,
    invalidVotes: 0,
    lines: [],
  };
  for (const field of fields(buf)) {
    if (field.wt === 0 && field.fn === 2) protocol.id = sint32(field.v);
    else if (field.wt === 0 && field.fn === 5) protocol.eligible = sint32(field.v);
    else if (field.wt === 0 && field.fn === 10) protocol.ballots = sint32(field.v);
    else if (field.wt === 0 && field.fn === 25) protocol.validCards = sint32(field.v);
    else if (field.wt === 0 && field.fn === 26) protocol.invalidVotes = sint32(field.v);
    else if (field.wt === 0 && field.fn === 27) protocol.validVotes = sint32(field.v);
    else if (field.wt === 2 && field.fn === 28) protocol.lines.push(decodeLine(field.v));
  }
  return protocol;
}

function decodeLine(buf) {
  const line = { nr: 0, name: "", votes: 0, id: 0 };
  for (const field of fields(buf)) {
    if (field.wt === 0 && field.fn === 1) line.nr = sint32(field.v);
    else if (field.wt === 2 && field.fn === 2) line.name = utf8(field.v);
    else if (field.wt === 0 && field.fn === 3) line.votes = sint32(field.v);
    else if (field.wt === 0 && field.fn === 8) line.id = sint32(field.v);
  }
  return line;
}

function fields(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const key = readVarint(buf, i);
    i = key.i;
    const fn = Number(key.n >> 3n);
    const wt = Number(key.n & 7n);
    if (wt === 0) {
      const value = readVarint(buf, i);
      i = value.i;
      out.push({ fn, wt, v: value.n });
    } else if (wt === 2) {
      const len = readVarint(buf, i);
      i = len.i;
      const size = Number(len.n);
      out.push({ fn, wt, v: buf.subarray(i, i + size) });
      i += size;
    } else if (wt === 1) {
      i += 8;
    } else if (wt === 5) {
      i += 4;
    } else {
      throw new Error(`Nieznany typ pola PKW ${wt}`);
    }
  }
  return out;
}

function readVarint(buf, i) {
  let n = 0n;
  let shift = 0n;
  while (i < buf.length) {
    const byte = buf[i];
    i += 1;
    n |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { n, i };
    shift += 7n;
    if (shift > 70n) throw new Error("Uszkodzony plik PKW.");
  }
  throw new Error("Urwany plik PKW.");
}

function sint32(n) {
  const z = (n >> 1n) ^ -(n & 1n);
  return Number(z);
}

function int32(n) {
  const v = Number(n & 0xffffffffn);
  return v >= 0x80000000 ? v - 0x100000000 : v;
}

function utf8(buf) {
  return Buffer.from(buf).toString("utf8");
}
