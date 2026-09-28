# Handover: Kraków mayoral election map, second round

This is the site for the second round of the Kraków mayoral by-election, on 11 October 2026 (PKW municipality 4485). It was copied from the first-round repository, `Terra-Cracovianum/Krakow-Wybory-Prezydenckie-27-Wrzesnia-2026`, which stays online as an archive. It is a static page. There is no build step, no bundler, and no application server.

The short Polish project note is [README.md](../README.md). This file is the one to trust when the two disagree.

## What you are looking at

On election night the page shows Kraków, every polling place, and the official count as it arrives. The left column is the result. The map only changes which area is in frame. The result card is ordinary HTML on top of the map, so panning and zooming do not move it.

The ballot has two names, in alphabetical order: 1 Łukasz Gibała, 2 Monika Jadwiga Piątkowska. In the first round (27 September, 454/454 commissions) Gibała had 93 042 votes (36,38%) and Piątkowska 76 514 (29,91%) of 255 785 valid votes. Nobody had more than half, so these two go to the second round.

`data/results.json` starts in `awaiting` with `round: 2`, `precinctsReporting: 0`, no city totals, and one `{ "reported": false }` object for every precinct 1–454.

When every commission has reported, and the file is not marked as sample data, three things appear together:

- a red ticker across the top, naming the winner and both vote counts
- a card over the map naming the winner and showing both candidates
- a short burst of confetti in the winner's colour, once per browser tab

On an exact tie the card says “Remis” and names nobody, and there is no confetti.

## Run it

From the repository root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. Opening `index.html` as a file will fail, because the page fetches JSON.

GitHub Pages serves the site at `https://terra-cracovianum.github.io/Krakow-Wybory-Prezydenckie-Druga-Tura-11-Pazdziernika/` once Pages is switched on (Settings → Pages → `main`, `/`). The canonical URL and the `og:*` tags in `index.html` already use that address.

Libraries, loaded from unpkg in `index.html`:

- Leaflet 1.9.4
- MapLibre GL 5.24.0
- `@maplibre/maplibre-gl-leaflet` 0.1.0

The basemap is the OpenFreeMap Positron style (`https://tiles.openfreemap.org/styles/positron`), and it only appears when zoomed in. The font is the system font (SF Pro on Apple devices), so nothing is downloaded.

## Files

| Path | Role |
| --- | --- |
| `index.html` | Shell, copy, Open Graph tags, library tags. |
| `js/map.js` | The whole application. One file, no modules, no imports. |
| `css/styles.css` | Layout, including the phone rules. |
| `data/candidates.json` | Ballot order, names, colours, and `feminine` (picks “Prezydent” or “Prezydentka”). |
| `data/results.json` | The only file the count lives in. |
| `data/precincts.geojson` | 412 polygons, precincts 1–412. Property `nr`, property `dzielnica`. |
| `data/districts.geojson` | 18 districts dissolved from those polygons. Property `dzielnica`, property `nrs` (string numbers). |
| `data/stations.geojson` | 250 polling places. A place lists every precinct that votes there in `obwody`. |
| `data/commissions.geojson` | One point per precinct, 1–454. The page never fetches this file. It is a reference copy of the commission list. |
| `druga-tura.jpg` | 1200×630 baseline JPEG used as the link-preview image. |

`js/map.js` starts in `init()`. That function loads the five JSON/GeoJSON files the page needs (`candidates`, `results`, `precincts`, `stations`, `districts`), draws the city, and wires the controls. Everything else is a function in the same file. Search for the function name from this document.

## Results file

`data/results.json` is the contract. The page does not compute a city total by walking precincts for the headline numbers. It reads the city fields, and it reads `precincts` for the map, the station table, and district sums.

```json
{
  "status": "final",
  "round": 2,
  "updatedAt": "2026-10-12T01:00:00+02:00",
  "precinctsTotal": 454,
  "precinctsReporting": 454,
  "eligible": 591000,
  "ballots": 300000,
  "validCards": 299900,
  "validVotes": 298000,
  "invalidVotes": 1900,
  "candidates": { "gibala": 150000, "piatkowska": 148000 },
  "precincts": {
    "1": {
      "reported": true,
      "eligible": 1518,
      "ballots": 700,
      "validCards": 700,
      "validVotes": 695,
      "invalidVotes": 5,
      "votes": { "gibala": 350, "piatkowska": 345 }
    }
  }
}
```

The numbers above are only there to show the shape of the file. They are not results.

`candidates` and each precinct `votes` object use the ids from `data/candidates.json`.

`status` is `awaiting` before any protocol, `partial` while some commissions are in, and `final` when `precinctsReporting` equals `precinctsTotal`. The label on the page keys off `precinctsReporting` more than off the string. `round` is `2`. When the count is finished, it changes the status line to “Wyniki drugiej tury”.

`sample: true` is optional. If it is set, the amber example banner stays visible, the map chip says the figures are not PKW, and the ticker, runoff card, and confetti stay hidden. Real results must not set it.

A precinct is counted only when `reported` is `true`. Until then the polygon is grey (`#d7deda`) and the station table shows “—”.

There must be one precinct object for every number from 1 to 454, including commissions that reported all zeros. PKW omits numeric fields that are zero on the wire. An importer still has to write those zeros and set `reported: true`, or the page will treat the commission as missing.

## How a number is calculated

Turnout on the city card is `validCards / eligible`, not `ballots / eligible`, and not the stored `turnout` field when `validCards` and `eligible` are both numbers. That is `officialTurnout`. A station row and a district row use the same rule in `turnoutOf`: `validCards` if it is a number, otherwise `ballots`, divided by `eligible`. `formatPercent` rounds with `pkwRound` to two decimal places and formats with `pl-PL`, so 43.5 displays as `43,50%`.

`pkwRound` is round-half-away-from-the-string-form PKW uses: shift with `Number(`${value}e${digits}`)`, round, shift back. Candidate shares are `(100 * votes) / validVotes` through that function (`percentLabel`). The denominator is valid votes, not valid cards and not eligible voters.

On a finished count the winner is whoever has more votes in `results.candidates` (`renderRunoff`). With two candidates that is also more than half of the valid votes. If both have the same number, nobody is named.

The `withdrawn` checks in `leaderOf`, `voteCell`, `stationPopup` and `renderRunoff` are left over from the first round, when Hoffman withdrew. No second-round candidate has the flag, so they do nothing. They were kept to keep the diff small.

Polish plurals are `voteNoun` and `obwodNoun`. Only exactly one uses the singular (`1 głos`, `1 obwód`). Numbers ending in 2, 3 or 4 use the small plural, except 12–14 (`2 głosy`, `22 obwody`, `12 głosów`). Everything else uses the large plural (`5 głosów`, `21 głosów`, `25 obwodów`). The first-round code wrongly wrote `21 głos`; that is fixed here.

District figures are not stored. `placeTotals` sums the reported precincts whose numbers are in that district’s `nrs`: eligible, ballots, valid cards, valid votes, invalid votes, and each candidate. If any reported row is missing a numeric field, that sum becomes `null` and the cell shows “—”. The district turnout then uses the same `validCards / eligible` rule.

## Geography

Precincts 1–412 are territorial. They have polygons in `precincts.geojson` and they are dissolved into the 18 city districts in `districts.geojson`. Official names are hardcoded in `DISTRICT_TITLE` in `js/map.js` (I Stare Miasto through XVIII Nowa Huta). The GeoJSON only says `Dzielnica I` and so on.

Precincts 413–454 are commissions in hospitals, care homes, and prisons. They have a point on a polling place and a protocol in `results.json`. They have no neighbourhood polygon, so they belong to no district. They still count in the city total, and search can open them. Number 417 is the hospital on Siemiradzkiego. Number 444 is one commission, not a sum of others.

`stations.geojson` groups precincts that share a building. Several `obwody` on one feature means one address and several columns in the station table. Clicking a precinct polygon calls `stationIndexFor`, which finds the station whose `obwody` contains that number.

`districts.geojson` was built by dissolving the precinct polygons. Interior rings smaller than about 0.00005 square degrees were dropped, because Leaflet was stroking them as dark dashes inside the district. Do not put those slivers back.

Four addresses were missing from the MSIP point layer and were taken from OpenStreetMap: Lubelska 29, Wadowicka 8W, Henryka Siemiradzkiego 1, Forteczna 22.

Sources:

- Commission list: `https://wybory.gov.pl/wojtburmistrz_2024_2029/pl/4485/organy_wyborcze/komisje_obwodowe`
- Precinct polygons: MSIP Kraków, layer “Aktualny podział na obwody wyborcze”
- Building points: `https://msip.um.krakow.pl/arcgis/rest/services/Obserwatorium/K05_Wybory_Dzielnice/MapServer`
- Candidates: the Kraków election commission notice of 14 September 2026

## Map colour and framing

The map uses one two-sided scale, so a narrow lead looks narrow. `tally` sums the reported precincts in a list: both candidates' votes, valid votes, eligible voters, and valid cards (or ballots). `marginColor` takes the lead in points of the two-candidate vote, `|a − b| / (a + b) × 100`, and puts it in one of five steps: under 5, 5–10, 10–20, 20–30, and 30 or more. Each step mixes the leader's colour (`candidates.json`) into the neutral `--map-neutral` at `MARGIN_STRENGTH` 0.22, 0.4, 0.58, 0.78 and 1. An exact tie is the neutral colour. An unreported precinct is `--map-empty`.

The Frekwencja view (`state.view === "turnout"`) uses the same precinct layer with `turnoutColor`: `validCards / eligible` in six steps (under 35%, 35–40, 40–45, 45–50, 50–55, 55% and more), mixed into `--turnout`.

All map colours are CSS variables on `:root`, with a dark-mode set under `prefers-color-scheme: dark`. `readPalette` copies them into `palette`, and the map repaints when the system theme changes. `--map-neutral` and `--turnout` must stay hex, because `mixHex` parses them.

Commissions 413–454 have no polygon. `specialDots` draws each one as a small circle at its polling place, using the same colours. The size grows gently with valid votes. The legend calls them “Szpitale, DPS, areszty”.

The district outlines (`state.borderLayer`, not interactive) sit on top of the precinct view. At city zoom there is no street map. The precincts sit on the plain `--map-bg`, as on 231elections. `fadeBasemap` fades the OpenFreeMap layer in between zoom 13 and 14.4, and lightens the precincts slightly so the streets show through. In dark mode the basemap canvas is inverted with a CSS filter.

Hovering on a computer shows `#hover-card`, which follows the pointer (`precinctCard`, `districtCard`). On a touch screen (`hover: none`), the first tap shows the same card with a “Pokaż szczegóły” button. A second tap on the same area opens it (`peekFirst`).

`withSurroundings` expands a bounds by a fraction of its span (minimum span 0.008° latitude and 0.01° longitude). `fitCity` uses fraction `0.16`. `fitDistrict` uses `0.42` and `maxZoom` 14. `fitPrecinct` uses `0.42` and `maxZoom` 15. The city fit also sets `minZoom` so the user cannot zoom the city out of the frame.

The MapLibre layer’s own resize handler recentres the canvas without resizing it, which shoves the city off the polygons when the left column changes width. `init` replaces that handler with `resizeBasemap`. Leave that override in place.

## What the screen does

`setMapView("precincts" | "districts" | "turnout")` swaps the GeoJSON layers. Precincts and turnout share the precinct layer and the dots. Choosing Dzielnice while that view is already on toggles the district menu. Escape closes the menu first, then the sheet.

Clicking a district calls `selectDistrict`. The sheet is `showDistrict`: it fills `#place-view` and adds `is-district` on `.panel`. It does not add `is-place`. `is-place` is what widens the column for the station table (`--place-cols`). The district sheet must stay on the narrow column, 360px (`min(360px, calc(100% - 320px))`).

The city view and the district sheet share `duelMarkup`: two percentages facing each other, one split bar with a tick at 50%, and the lead in points (“Gibała +4,92 pkt przewagi”). Before any result, the city view shows the first-round share from `firstRound` in `candidates.json`.

The district sheet shows the roman number and the official name, a sentence with the precinct count, turnout, counted precincts, valid votes, and the duel. It does not list the precinct numbers: a reader who wants a single precinct switches to Obwody.

“Miasto” (`data-close`) and “Całe miasto” (`data-district=""`) call `closeSheet`. That clears the highlight, clears `state.district`, and fits the city again.

Search (`#query`) matches a station’s precinct numbers, building name, street, or building number. An exact precinct number sorts above a substring. `/` focuses the box when it is not already focused.

The phone layout starts at `max-width: 860px`. The map is on top and the column becomes a bottom sheet with three heights, set by `data-detent` on `.panel`: `peek` (the title and the duel), `half` (50dvh) and `full` (88dvh). Drag the handle to resize, or tap it to step through the heights (`bindSheet`). `settleSheet` refits the map after the sheet moves. Opening a station or district from `peek` raises the sheet to `half`. When the count is finished, the runoff card collapses to a strip.

Progress is shown once, in the header status line. `#pkw-wait` and `.count-line` are still filled by the script, but they are hidden.

## Finished count, confetti, visits

`renderRunoff` runs only when `sample` is absent and `precinctsReporting >= precinctsTotal`. It writes `#runoff` and calls `renderTicker`. The ticker copies its sentence into `#ticker-live` once, for the screen reader, and duplicates the visible track until it is at least twice the viewport. `prefers-reduced-motion` leaves a single static line. The sentence is “Druga tura, 11 października 2026. Prezydentem Krakowa zostaje {name}, {n} głosów ({percent}). {second name}, {n} głosów.” (`tickerLine`). It uses “Prezydentką” when the winner has `feminine: true`.

`celebrateCount` reads `sessionStorage` key `krakow-wybory-2-tura-confetti`. Reduced motion skips it. It does not run again in the same tab.

`countVisit` skips `localhost` and `127.0.0.1`. Otherwise it hits `https://abacus.jasoncameron.dev/hit/terra-cracovianum.github.io/krakow-wybory-2-tura-visits` once per browser, remembered in `localStorage` key `krakow-wybory-2-tura-visit`. The public read URL is `https://abacus.jasoncameron.dev/get/terra-cracovianum.github.io/krakow-wybory-2-tura-visits`. Both sites are served from `terra-cracovianum.github.io`, so they share browser storage; that is why every key has `2-tura` in it. Do not put an admin key in the repository or in this document.

## Link preview

`og:image` and `twitter:image` point at `druga-tura.jpg` on the published host. The file is a baseline JPEG, 1200×630. X dropped the picture when an earlier image URL had a query string, and it kept showing an older card until the image path itself changed. Replace the file by publishing a new filename and updating both tags. Do not add `?v=`.

The image is not generated by the page. It was drawn from the district polygons in both candidates' colours, with no claim about who leads. After the count, publish a new file (for example `wynik-druga-tura.jpg`) coloured by the district leaders and update the tags.

## What is not in this repository

Nothing here polls PKW. During the first round a separate script, not committed, read:

`https://wybory.gov.pl/wojtburmistrz_2024_2029/data/details/4485.blob`

and wrote `data/results.json`. The second-round address will not automatically be that URL. Open the official Kraków page on wybory.gov.pl and confirm the blob before writing an importer.

Rules that importer has to keep:

- Publish only PKW numbers. No polls, no photographs of a television, no partial arithmetic you cannot tie to a protocol.
- A counted commission with all zeros is still counted. Write the zeros and `reported: true`.
- Turnout in the file may be stored, but the page recomputes it from `validCards / eligible`.
- Do not commit an admin key, and do not commit beside `results.json` unless you mean to publish that snapshot.

## What is left

1. **PKW importer.** Nothing in this repository fetches results yet. Get the second-round data address from the official Kraków page on wybory.gov.pl, then write a script that writes `data/results.json` following the rules above.
2. **Ballot order.** Check the numbers 1 Gibała and 2 Piątkowska against the official Kraków election commission notice for the second round.
3. **Pages.** Turn on GitHub Pages for `main` and `/`.
4. **Link preview after the count.** A new image coloured by the winner, under a new filename.

Leave these alone unless a real bug forces it:

- `withSurroundings` and the three fit functions
- the MapLibre resize override
- `placeTotals` including `validCards`
- precincts 413–454 staying out of district geometry
- the `is-place` versus `is-district` split
- `pkwRound`
