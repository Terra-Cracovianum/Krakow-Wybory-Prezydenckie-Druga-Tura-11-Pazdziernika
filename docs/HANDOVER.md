# Handover: Kraków mayoral election map, second round

This is the site for the second round of the Kraków mayoral by-election, on 11 October 2026 (PKW municipality 4485). It was copied from the first-round repository, `Terra-Cracovianum/Krakow-Wybory-Prezydenckie-27-Wrzesnia-2026`, which stays online as an archive. It is a static page. There is no build step, no bundler, and no application server.

The short Polish project note is [README.md](../README.md). This file is the one to trust when the two disagree.

## What you are looking at

On election night the page shows Kraków, every polling place, and the official count as it arrives. The left column is the result. The map only changes which area is in frame. The result card is ordinary HTML on top of the map, so panning and zooming do not move it.

The ballot has two names, in alphabetical order: 1 Łukasz Gibała, 2 Monika Jadwiga Piątkowska. In the first round (27 September, 454/454 commissions) Gibała had 93 042 votes (36,38%) and Piątkowska 76 514 (29,91%) of 255 785 valid votes. Nobody had more than half, so these two go to the second round.

`data/results.json` starts in `awaiting` with `round: 2`, `precinctsReporting: 0`, no city totals, and one `{ "reported": false }` object for every precinct 1–454.

When every commission has reported, and the file is not marked as sample data, three things appear together:

- a tall blue ticker across the top, in Gibała's colour (`#1f6fe0`), naming the winner and both vote counts
- a card over the map naming the winner and showing both candidates
- the full-screen winner announcement with confetti (see below)

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
| `druga-tura-2.jpg` | 1200×630 baseline JPEG used as the link-preview image. |

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

The district outlines (`state.borderLayer`, not interactive) sit on top of the precinct view as gaps in the page colour, not dark lines: `--map-gap` wide between districts and `--map-hair` between precincts (thinner in dark mode). The dissolved outlines never match precinct edges to the pixel, and a gap hides that. The city has no outline of its own; `--map-lift` gives the SVG pane a soft shadow instead. A special commission with no result yet is a small solid `--map-dot-empty` point. At city zoom there is no street map. The precincts sit on the plain `--map-bg`, as on 231elections. Leaflet's drag threshold is raised from 3 to 8 px (`clickTolerance`), so a trackpad click that wobbles a little still selects a precinct instead of starting a drag. `fadeBasemap` fades the OpenFreeMap layer in between zoom 13 and 14.4, and lightens the precincts slightly so the streets show through. In dark mode the basemap canvas is inverted with a CSS filter.

There are two outline states. The selected precinct or district (`state.highlightNr`, `state.district`) has a 2.6 px outline and a halo in the page colour (`is-selected`, set by `markSelected`), and always stays on top. While something is selected, the area under the pointer is only a preview (`PREVIEW`): full colour again, with a thin outline at 55% opacity. Hovering on a computer shows `#hover-card`, which follows the pointer (`precinctCard`, `districtCard`). On a touch screen (`hover: none`), the first tap shows the same card with a “Pokaż szczegóły” button. A second tap on the same area opens it (`peekFirst`).

`withSurroundings` expands a bounds by a fraction of its span (minimum span 0.008° latitude and 0.01° longitude). `fitCity` uses fraction `0.16`. `fitDistrict` uses `0.42` and `maxZoom` 14. `fitPrecinct` uses `0.42` and `maxZoom` 15. The city fit also sets `minZoom` so the user cannot zoom the city out of the frame. On a computer, when the district list is open, `viewPadding` adds the list's measured width (`menuInset`), so the city is framed to the right of it. Opening or closing the list calls `fitCity(true)`, which refits even when the city is already in view. `maxBounds` is `cityBounds.pad(1.4)`, so the map can move far enough for that on narrow laptops.

Camera moves go through `moveCamera` in three modes. **fly** (`flyToBounds`, 0.9 s) arcs in when a precinct or district is opened from the whole city, and arcs out when going back (`fitCity(true, "fly")` from “Miasto”, Escape, the whole-city button, “Całe miasto” and switching views). **pan** slides at the current scale when switching from one open station or district to another (`state.focusMode`, set in `openStation`); if the new area does not fit at that scale it makes a short 0.6 s hop out instead of a snap. **jump** is used for resizing, rotating and reduced motion. `holdCamera` marks how long a move runs, and `refitSoon` waits for it instead of cutting it short. `glideCity` and `settleSheet` resize the map while `settling` is still true, so Leaflet's resize event cannot snap the view before the animation starts.

The MapLibre layer’s own resize handler recentres the canvas without resizing it, which shoves the city off the polygons when the left column changes width. `init` replaces that handler with `resizeBasemap`. Leave that override in place.

## What the screen does

`setMapView("precincts" | "districts" | "turnout")` swaps the GeoJSON layers. Precincts and turnout share the precinct layer and the dots. Choosing Dzielnice while that view is already on toggles the district menu. Escape closes the menu first, then the sheet.

Clicking a district calls `selectDistrict`. The sheet is `showDistrict`: it fills `#place-view` and adds `is-district` on `.panel`. It does not add `is-place`. `is-place` is what widens the column for the station table (`--place-cols`). The district sheet must stay on the narrow column, 360px (`min(360px, calc(100% - 320px))`).

Under the map sits the race to 50% (`renderRace`, `#race`). Each candidate's bar is their share of counted valid votes, the same figure printed above it, so the two bars fill the track and the 50% line is the middle of those votes. Whoever has more than half (`votes * 2 > validVotes`) is past the line: the middle says “Wygrywa …”, the line turns their colour (`is-crossed`), and `announceWinner` plays. It plays once more when every commission is in. Under it, a thinner bar shows the first round (27 September) from `firstRound` in `candidates.json`: Gibała 36.38% from the left, Piątkowska 29.91% from the right, and the grey middle is the other candidates. It spans the same width, so both 50% lines line up. On every load, `animateRace` fills both bars from the edges toward the middle and counts the percentages and votes up with them (easing out over about 1.7 s; the first-round bar starts 0.5 s later). With reduced motion, everything shows its final value at once.

Colours: Gibała is blue (`#1f6fe0`) and Piątkowska is red (`#e5343f`), both in `candidates.json`. The turnout view is teal (`--turnout`), so it cannot be mistaken for either candidate.

Before the first result, the top of the panel shows a countdown (`#countdown`, `startCountdown` and `renderCountdown`, ticking every second). The times are fixed in `js/map.js` in Polish time: `SILENCE_AT` 2026-10-10 00:00 (the start of the election silence, midnight between Friday and Saturday), `POLLS_OPEN_AT` 2026-10-11 07:00 and `POLLS_CLOSE_AT` 21:00. It counts down to the polls opening, with a line counting down to the silence. During the silence that line says it is on until 21:00 on Sunday. While the polls are open it counts down to closing, and after 21:00 it says the polls are closed. It disappears once `precinctsReporting` is above 0. Change the three dates for another election.

The city view and the district sheet share `duelMarkup`: two percentages facing each other, one split bar with a tick at 50% (district sheet only; the city uses the race under the map), and the lead in points (“Gibała +4,92 pkt przewagi”). Before any result, the city view shows the first-round share from `firstRound` in `candidates.json`.

The district sheet shows the roman number and the official name, a sentence with the precinct count, turnout, counted precincts, valid votes, and the duel. It does not list the precinct numbers: a reader who wants a single precinct switches to Obwody.

“Miasto” (`data-close`) and “Całe miasto” (`data-district=""`) call `closeSheet`. That clears the highlight, clears `state.district`, and fits the city again.

Search (`#query`) matches a station’s precinct numbers, building name, street, or building number. An exact precinct number sorts above a substring. `/` focuses the box when it is not already focused.

There are two compact layouts. A phone held upright (`PHONE_QUERY`: `max-width: 860px` and portrait) gets the bottom sheet. A phone on its side (landscape, `max-height: 560px`) keeps the desktop layout, only tighter. In both, JS sets `html.is-compact` and `placeRace` moves the race into the panel as its headline, where the city duel is hidden. The legend becomes a one-line strip, and the header fits on one line. Rotating the phone re-runs this (`watchLayout`). The upright layout: The map is on top and the column becomes a bottom sheet with three heights, set by `data-detent` on `.panel`: `peek` (the title and the duel), `half` (50dvh) and `full` (88dvh). Drag the handle to resize, or tap it to step through the heights (`bindSheet`). `settleSheet` refits the map after the sheet moves. Opening a station or district from `peek` raises the sheet to `half`. When the count is finished, the runoff card collapses to a strip.

On a computer, the top right of the map has the progress card `#pkw-wait` (`renderPkwChip`): “Czekamy na wyniki PKW”, then “Wyniki spływają” with the share of commissions counted in large type and “246 z 454 obwodów”, then “Wyniki pełne · 100%”, with a thin progress bar. It is hidden on phones, where the header status line shows the same. `.count-line` is kept for screen readers only. The winner card `#runoff` is hidden, because the race under the map names the winner; `renderRunoff` still drives the ticker and the confetti.

## Finished count, confetti, visits

`renderRunoff` runs only when `sample` is absent and `precinctsReporting >= precinctsTotal`. It writes `#runoff` and calls `renderTicker`. The ticker copies its sentence into `#ticker-live` once, for the screen reader, and duplicates the visible track until it is at least twice the viewport. `prefers-reduced-motion` leaves a single static line. The sentence is “Druga tura, 11 października 2026. Prezydentem Krakowa zostaje {name}, {n} głosów ({percent}). {second name}, {n} głosów.” (`tickerLine`). It uses “Prezydentką” when the winner has `feminine: true`.

`countVisit` skips `localhost` and `127.0.0.1`. Visits are split at the polls closing (`POLLS_CLOSE_AT`, Sunday 21:00): period `przed` before, `po` after. Each period has two abacus counters under `terra-cracovianum.github.io`: `krakow-2-tura-{period}-wejscia` (every page load) and `krakow-2-tura-{period}-osoby` (once per browser per period, remembered in `localStorage` key `krakow-2-tura-osoba-{period}`). `node scripts/visits.mjs` prints all four. The “Razem” row adds the periods, so someone who visited in both counts twice there. Both sites are served from `terra-cracovianum.github.io` and share browser storage, which is why every key has `2-tura` in it. Do not put an admin key in the repository or in this document.

## Winner decided before the full count

`decidedWinner` names a winner early only when it is certain: the lead in votes is larger than every vote still possible in the commissions not counted yet. For each open commission the ceiling (`voteCeiling`) is its eligible voters (the PKW number when the results file carries it, otherwise the first round's, from `data/eligible-round1.json`), plus 10% and 50 more for voters added on the day with a certificate. For commissions 413–454 (hospitals, care homes, prisons), whose lists change from day to day, it is twice that number plus 50. When it holds, `#decided` shows “Zwycięzca rozstrzygnięty” with the winner and the numbers behind it. The race itself already says “Wygrywa” once that person has more than half of the counted votes.

## Winner announcement

`announceWinner` opens a full-screen broadcast-style sequence (`#win`, about six seconds) once someone has more than half of the counted valid votes (`renderRace`), and again when the full count names a winner in `renderRunoff`. It never opens on `sample` data, and never while the history slider is replaying. It plays on every page load while that lead holds, and once more on the same page when PKW has counted every commission (`winStage`: `decided`, then `final`), even if the reader closed the first one. If it is open when the full count arrives, it starts again with the final figures. It replaced the small confetti burst (`celebrateCount` is gone). “Zobacz mapę wyników” or Escape closes it.

The sequence: colour sweeps; the winner's share of the counted valid votes climbs to the 50% line and past it; the Kraków skyline rises (Pałac Wielopolskich, the mayor's seat; the Wawel cathedral towers; St Mary's); the portrait, the name, the “Prezydent/Prezydentka Krakowa” ribbon, a sentence, three figures and a running strip follow, with confetti from both corners. Pictures are in `img/zwyciezca/` (WebP, transparent). The surname shrinks to fit (`fitWinnerName`). On a phone held upright the portrait, the palace and the two towers sit a little below the top edge, still clear of the “Rozstrzygnięte” badge, and the words sit in the band under that. The close button is at the top left and the mute button at the top right. Reduced motion shows the end state at once.

Every figure comes from `data/results.json`. Before the full count the overlay says “Rozstrzygnięte”, gives the lead and the number of uncounted commissions, and says the count goes on and the figures will still change; the figures are “w policzonych” and “obwodów policzonych”. If a new count arrives while it is open, `fillWinner` updates the figures in place. After the full count it says “Wynik PKW”.

The mockups made for this feature used invented numbers. They are not results and must never be published or committed. Nobody knows the final result until PKW counts it.

## Background music

`result's are in.mp3` plays in a loop under the whole page from the moment it opens, including while someone is just looking at the map. The buildup does not start. The file fades out at the end and the loop begins again. It is mastered at about −10 LUFS, and `#bed` starts at volume `0.35`. When the winner animation opens, `playVictory` restarts that same file from the beginning at volume `0.7` and leaves it playing after the animation closes. `#sound-toggle` silences it. The choice is remembered in `localStorage` key `krakow-2-tura-muzyka` (`off` or `on`). A browser that blocks sound until a gesture starts the track on the first tap or key, including a tap on the winner animation. The winner announcement names whoever has more than half of the counted votes.

## Live updates

The page fetches `data/results.json` every 30 seconds, and again when the tab comes back into view (`startPolling`, `refreshResults`). It redraws only when `updatedAt` or `precinctsReporting` changed. The race glides from the numbers on screen to the new ones, and an open station or district sheet is refreshed in place.

## Caching

`index.html` loads `css/styles.css?v=…` and `js/map.js?v=…`. GitHub Pages lets browsers keep files for 10 minutes, and phones do, so bump that version string whenever the CSS or JS changes, or visitors may see the old layout. `results.json` is fetched with `cache: "no-store"` so a reload always shows the newest count.

## Link preview

`og:image` and `twitter:image` point at `druga-tura-2.jpg` on the published host. The file is a baseline JPEG, 1200×630. X dropped the picture when an earlier image URL had a query string, and it kept showing an older card until the image path itself changed. Replace the file by publishing a new filename and updating both tags. Do not add `?v=`.

The image is not generated by the page. It was drawn from the district polygons in both candidates' colours, with no claim about who leads. After the count, publish a new file (for example `wynik-druga-tura-2.jpg`) coloured by the district leaders and update the tags.

## Publishing the count on election night

`scripts/pkw-watch.mjs` downloads the PKW data every 30 seconds. `scripts/pkw-adapter.mjs` turns it into the results format, and whenever PKW reports more counted commissions than the site shows, the watcher writes `data/results.json`. With `--push` it also commits “Refresh the PKW count to N commissions, P percent.” and pushes to `main`. It stops at 100%. A rejected push is rebased and retried. It never publishes a file that fails `validate` (every commission present, `precinctsReporting` matching the counted rows, votes for both candidates).

The runoff is the nested `secondRound` inside `https://wybory.gov.pl/wojtburmistrz_2024_2029/data/details/4485.blob` (the human page is `https://wybory.gov.pl/wojtburmistrz_2024_2029/pl/4485/wyniki`). The top of that file is still the first round, and `scripts/pkw-adapter.mjs` ignores it. A commission is counted when the second round has a protocol whose id matches that commission. PKW leaves out numeric fields that are zero. `buildResults` in `scripts/pkw-results.mjs` fills those zeros in, keeps unreported commissions as `{ "reported": false }`, and sums the city totals, unless PKW states them. Each time the counted number rises, `scripts/pkw-history.mjs` appends one event to `data/history.json` (time, percent, candidate split, district totals, and only the newly counted commissions). The page slider rebuilds the map from those events.

Two ways to run it:

- **GitHub Actions** (`.github/workflows/pkw-live.yml`, “Wyniki PKW na żywo”). Run it by hand, or let it start itself at 20:50 on 11 October. The Kraków blob is the default address; a repository variable `PKW_URL` replaces it. It commits as Adam, and after each push it asks Pages to rebuild in case a push made with the workflow token does not start one. The same run appends `data/history.json`.
- **Backup, on a computer:** `node scripts/pkw-watch.mjs --push` in a clone of the repository, with the owner's git identity. It uses the Kraków blob unless `--url` or `PKW_URL` says otherwise.

Test runs: `--dry-run` writes nothing, `--once` checks one time, and `--format results` accepts a file that is already in the site's format.

Rules the importer keeps:

- Publish only PKW numbers. No polls, no photographs of a television, no partial arithmetic you cannot tie to a protocol.
- A counted commission with all zeros is still counted. Write the zeros and `reported: true`.
- Turnout in the file may be stored, but the page recomputes it from `validCards / eligible`.
- Do not commit an admin key.

## What is left

1. **Ballot order.** Gibała is PKW candidate `5020512` and Piątkowska is `5019538`. On a two-name protocol the ballot number is the fallback (1 Gibała, 2 Piątkowska). Check that against the official notice if a protocol arrives with different ids and no names.
2. **Start the watcher** if the 20:50 schedule has already passed (see above).
3. **Pages.** Turn on GitHub Pages for `main` and `/`.
4. **Link preview after the count.** A new image coloured by the winner, under a new filename.

Leave these alone unless a real bug forces it:

- `withSurroundings` and the three fit functions
- the MapLibre resize override
- `placeTotals` including `validCards`
- precincts 413–454 staying out of district geometry
- the `is-place` versus `is-district` split
- `pkwRound`
