const numberFormat = new Intl.NumberFormat("pl-PL");

const state = {
  candidates: [],
  results: null,
  stations: null,
  precinctFeatures: null,
  districts: null,
  districtLayer: null,
  view: "precincts",
  district: null,
  highlightNr: null,
  map: null,
  cityBounds: null,
  focusFeature: null,
};

const query = document.querySelector("#query");
const hits = document.querySelector("#hits");

init().catch((error) => {
  const label = document.querySelector("#status-label");
  if (label) label.textContent = "Nie udało się wczytać mapy";
  else document.querySelector("#status").textContent = "Nie udało się wczytać mapy";
  console.error(error);
});

countVisit();

function countVisit() {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return;
  const seen = "krakow-wybory-2-tura-visit";
  try {
    if (localStorage.getItem(seen)) return;
  } catch {
    return;
  }
  fetch("https://abacus.jasoncameron.dev/hit/terra-cracovianum.github.io/krakow-wybory-2-tura-visits", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) return;
      try {
        localStorage.setItem(seen, "1");
      } catch {
        /* the visit is already recorded */
      }
    })
    .catch(() => {});
}

async function init() {
  const [candidateFile, results, precincts, stations, districts] = await Promise.all([
    fetch("data/candidates.json").then((response) => response.json()),
    fetch("data/results.json").then((response) => response.json()),
    fetch("data/precincts.geojson").then((response) => response.json()),
    fetch("data/stations.geojson").then((response) => response.json()),
    fetch("data/districts.geojson").then((response) => response.json()),
  ]);

  state.candidates = candidateFile.candidates;
  state.results = results;
  state.stations = stations;
  state.precinctFeatures = precincts;
  state.districts = districts;

  readPalette();
  placeRace();
  renderSummary();
  renderCandidates();

  const cityBounds = L.geoJSON(precincts).getBounds();
  state.cityBounds = cityBounds;
  const map = L.map("map", {
    zoomControl: false,
    zoomSnap: 0,
    zoomDelta: 1,
    minZoom: 10,
    maxZoom: 18,
    maxBounds: cityBounds.pad(1.4),
    maxBoundsViscosity: 1,
    worldCopyJump: false,
  });
  // Leaflet treats 3px of movement during a click as a drag and drops the
  // click. A trackpad tap easily moves that much, so allow a little more
  // before a press counts as dragging the map (Leaflet 1.9.4, pinned).
  if (map.dragging && map.dragging._draggable) map.dragging._draggable.options.clickTolerance = 8;
  new ResetControl({ position: "bottomright" }).addTo(map);
  L.control.zoom({ position: "bottomright", zoomInTitle: "Przybliż", zoomOutTitle: "Oddal" }).addTo(map);
  const basemap = L.maplibreGL({
    style: "https://tiles.openfreemap.org/styles/positron",
  }).addTo(map);
  state.basemap = basemap;
  // The plugin's resize handler recenters the canvas without changing its
  // pixel size, so a narrower map leaves the city shifted off the precincts.
  map.off("resize", basemap._resize, basemap);
  basemap._resize = function () {
    resizeBasemap(this);
  };
  map.on("resize", basemap._resize, basemap);
  map.attributionControl.addAttribution(
    '<a href="https://openfreemap.org/">OpenFreeMap</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · obwody: <a href="https://msip.krakow.pl/">MSIP Kraków</a>'
  );

  const precinctLayer = L.geoJSON(precincts, {
    style: stylePrecinct,
    onEachFeature(feature, layer) {
      const nr = feature.properties.nr;
      layer.on({
        mouseover(event) {
          if (String(nr) !== String(state.highlightNr)) {
            setHover(event.target, hoverPrecinct(feature), () => precinctLayer.resetStyle(event.target));
          }
          showHoverCard(event, precinctCard(nr), `p${nr}`);
        },
        mousemove(event) {
          moveHoverCard(event);
        },
        mouseout(event) {
          clearHover(event.target);
          bringSelectedToFront();
          hideHoverCard(`p${nr}`);
        },
        click(event) {
          L.DomEvent.stopPropagation(event);
          if (peekFirst(event, precinctCard(nr), `p${nr}`)) return;
          openPrecinct(nr);
        },
      });
    },
  }).addTo(map);
  state.precinctLayer = precinctLayer;
  state.borderLayer = L.geoJSON(districts, { style: borderStyle, interactive: false }).addTo(map);
  state.dotLayer = specialDots().addTo(map);
  map.on("click", () => hideHoverCard());
  // Leaving the map, or starting to drag, clears any outline left behind.
  map.getContainer().addEventListener("mouseleave", () => {
    clearHover();
    hideHoverCard();
  });
  map.on("dragstart zoomstart", () => clearHover());
  map.on("zoom zoomend", fadeBasemap);
  const districtLayer = L.geoJSON(districts, {
    style: styleDistrict,
    onEachFeature(feature, layer) {
      layer.on({
        mouseover(event) {
          if (feature.properties.dzielnica !== state.district) {
            setHover(event.target, hoverDistrict(feature), () => districtLayer.resetStyle(event.target));
          }
          showHoverCard(event, districtCard(feature), `d${feature.properties.dzielnica}`);
        },
        mousemove(event) {
          moveHoverCard(event);
        },
        mouseout(event) {
          clearHover(event.target);
          bringSelectedDistrictToFront();
          hideHoverCard(`d${feature.properties.dzielnica}`);
        },
        click(event) {
          L.DomEvent.stopPropagation(event);
          if (peekFirst(event, districtCard(feature), `d${feature.properties.dzielnica}`)) return;
          hideHoverCard();
          selectDistrict(feature.properties.dzielnica);
        },
      });
    },
  });
  state.districtLayer = districtLayer;
  state.map = map;
  renderLegend();
  renderDistrictMenu();
  document.querySelector("#mode-precincts").addEventListener("click", () => setMapView("precincts"));
  document.querySelector("#mode-turnout").addEventListener("click", () => setMapView("turnout"));
  document.querySelector("#hover-card").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open]");
    if (!button) return;
    const key = button.dataset.open;
    hideHoverCard();
    if (key.startsWith("d")) selectDistrict(key.slice(1));
    else openPrecinct(key.slice(1));
  });
  bindSheet();
  watchLayout();
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  const repaint = () => {
    readPalette();
    paintPrecincts();
    paintDistricts();
    renderLegend();
  };
  if (scheme.addEventListener) scheme.addEventListener("change", repaint);
  document.querySelector("#mode-districts").addEventListener("click", () => {
    if (state.view === "districts") {
      const menu = document.querySelector("#district-menu");
      menu.hidden = !menu.hidden;
      if (state.district) fitDistrict(state.district, true);
      else fitCity(true);
      return;
    }
    setMapView("districts");
  });
  document.querySelector("#district-menu").addEventListener("click", (event) => {
    const button = event.target.closest("[data-district]");
    if (!button) return;
    selectDistrict(button.dataset.district);
  });
  fitCity();
  fadeBasemap();
  const refitSoon = () => {
    if (settling) return;
    map.invalidateSize({ animate: false, pan: false });
    if (placeIsOpen() && state.focusFeature) fitPrecinct(false);
    else if (state.view === "districts" && state.district) fitDistrict(state.district, false);
    else fitCity();
    syncBasemap();
  };
  map.on("resize", refitSoon);
  const refitObserver = new ResizeObserver(refitSoon);
  refitObserver.observe(document.querySelector("#map"));
  refitObserver.observe(document.querySelector(".panel"));
  document.fonts.ready.then(refitSoon);

  query.addEventListener("input", () => renderHits(query.value));
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== query) {
      event.preventDefault();
      query.focus();
    }
    if (event.key === "Escape") {
      const menu = document.querySelector("#district-menu");
      if (state.view === "districts" && menu && !menu.hidden) {
        menu.hidden = true;
        return;
      }
      closeSheet();
    }
  });
}

const pathEdge = { lineJoin: "round", lineCap: "round" };

// Map colours live in CSS (light and dark), so the map follows the theme.
const palette = {};

function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  palette.neutral = read("--map-neutral", "#ebe8e3");
  palette.empty = read("--map-empty", "#e3e3e8");
  palette.line = read("--map-line", "#ffffff");
  palette.dotEmpty = read("--map-dot-empty", "#c7c7cc");
  palette.gap = parseFloat(read("--map-gap", "2.4")) || 2.4;
  palette.hair = parseFloat(read("--map-hair", "0.8")) || 0.8;
  palette.selected = read("--ink", "#1d1d1f");
  palette.turnout = read("--turnout", "#2f5f8f");
}

// Lead in percentage points of the two-candidate vote: under 5, 5–10, 10–20, 20–30, 30 and more.
const MARGIN_STEPS = [5, 10, 20, 30];
const MARGIN_STRENGTH = [0.22, 0.4, 0.58, 0.78, 1];
// Turnout: under 35%, 35–40, 40–45, 45–50, 50–55, 55% and more.
const TURNOUT_STEPS = [35, 40, 45, 50, 55];
const TURNOUT_STRENGTH = [0.16, 0.32, 0.48, 0.64, 0.82, 1];

function stepIndex(value, steps) {
  let index = 0;
  while (index < steps.length && value >= steps[index]) index += 1;
  return index;
}

function mixHex(from, to, amount) {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const channel = (shift) => {
    const x = (a >> shift) & 255;
    const y = (b >> shift) & 255;
    return Math.round(x + (y - x) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function tally(nrs) {
  const [first, second] = state.candidates;
  const sum = { reported: 0, a: 0, b: 0, valid: 0, eligible: 0, cards: 0 };
  for (const nr of nrs || []) {
    const row = state.results.precincts[String(nr)];
    if (!row || !row.reported) continue;
    sum.reported += 1;
    const votes = row.votes || {};
    if (typeof votes[first.id] === "number") sum.a += votes[first.id];
    if (typeof votes[second.id] === "number") sum.b += votes[second.id];
    if (typeof row.validVotes === "number") sum.valid += row.validVotes;
    if (typeof row.eligible === "number") sum.eligible += row.eligible;
    const cards = typeof row.validCards === "number" ? row.validCards : row.ballots;
    if (typeof cards === "number") sum.cards += cards;
  }
  return sum;
}

function marginColor(sum) {
  const both = sum.a + sum.b;
  if (!sum.reported || both <= 0) return null;
  if (sum.a === sum.b) return palette.neutral.startsWith("#") ? palette.neutral : "#ebe8e3";
  const [first, second] = state.candidates;
  const lead = sum.a > sum.b ? first : second;
  const points = (Math.abs(sum.a - sum.b) / both) * 100;
  return mixHex(palette.neutral, lead.color, MARGIN_STRENGTH[stepIndex(points, MARGIN_STEPS)]);
}

function turnoutColor(sum) {
  if (!sum.reported || sum.eligible <= 0) return null;
  const turnout = (100 * sum.cards) / sum.eligible;
  return mixHex(palette.neutral, palette.turnout, TURNOUT_STRENGTH[stepIndex(turnout, TURNOUT_STEPS)]);
}

function fillFor(nrs) {
  const sum = tally(nrs);
  return state.view === "turnout" ? turnoutColor(sum) : marginColor(sum);
}

function stylePrecinct(feature) {
  const selected = String(feature.properties.nr) === String(state.highlightNr);
  return areaStyle(fillFor([feature.properties.nr]), selected, Boolean(state.highlightNr && !selected), "precinct");
}

function styleDistrict(feature) {
  const selected = feature.properties.dzielnica === state.district;
  return areaStyle(fillFor(feature.properties.nrs), selected, Boolean(state.district && !selected), "district");
}

// Districts are separated by a wider gap in the page colour, not a dark
// line. The dissolved outlines never match precinct edges to the pixel;
// a gap hides that, and the city edge simply fades into the page.
function borderStyle() {
  return { color: palette.line, weight: palette.gap, opacity: 1, fill: false, interactive: false, ...pathEdge };
}

function areaStyle(fill, selected, dim, kind) {
  const district = kind === "district";
  return {
    color: selected ? palette.selected : palette.line,
    weight: selected ? 2.6 : district ? palette.gap : palette.hair,
    opacity: 1,
    fillColor: fill || palette.empty,
    fillOpacity: dim ? 0.4 : 1,
    ...pathEdge,
  };
}

// Two looks: the selected area has a thick outline with a halo; an area
// under the pointer while something is selected is only a preview, full
// colour again with a thin, softer outline.
const PREVIEW = { opacity: 0.55, weight: 1.4, fillOpacity: 1 };

function hoverPrecinct(feature) {
  const base = { ...stylePrecinct(feature), color: palette.selected };
  return state.highlightNr ? { ...base, ...PREVIEW } : { ...base, weight: 1.6 };
}

function hoverDistrict(feature) {
  const base = { ...styleDistrict(feature), color: palette.selected };
  return state.district ? { ...base, ...PREVIEW, weight: 1.8 } : { ...base, weight: 2.2 };
}

function markSelected(shape, selected) {
  if (shape._path) shape._path.classList.toggle("is-selected", selected);
}

// Only one area is outlined at a time. Browsers sometimes skip "mouseout"
// when shapes are reordered under the pointer, so each new hover first
// clears the previous one instead of trusting that event.
let hovered = null;

function setHover(layer, style, reset) {
  // Moving a shape in the page under the pointer makes browsers drop the
  // click that is under way, so a shape already hovered is left alone.
  if (hovered && hovered.layer === layer) return;
  if (hovered) clearHover();
  hovered = { layer, reset };
  layer.setStyle(style);
  toFront(layer);
  // The selected area always stays above a preview.
  bringSelectedToFront();
  bringSelectedDistrictToFront();
}

// Re-append a shape only when it is not already the top one.
function toFront(layer) {
  const path = layer._path;
  if (path && path.parentNode && path.parentNode.lastChild !== path) layer.bringToFront();
}

function clearHover(layer) {
  if (!hovered || (layer && hovered.layer !== layer)) return;
  const { reset } = hovered;
  hovered = null;
  reset();
}

function bringBordersToFront() {
  if (state.borderLayer && state.map && state.map.hasLayer(state.borderLayer)) state.borderLayer.bringToFront();
}

// Commissions 413–454 (hospitals, care homes, prisons) have no polygon, so they get a dot.
function specialNumbers() {
  const numbers = [];
  for (let nr = 1; nr <= state.results.precinctsTotal; nr += 1) {
    if (!precinctShapeFeature(nr)) numbers.push(String(nr));
  }
  return numbers;
}

function precinctShapeFeature(nr) {
  if (!state.precinctIndex) {
    state.precinctIndex = new Set(state.precinctFeatures.features.map((feature) => String(feature.properties.nr)));
  }
  return state.precinctIndex.has(String(nr));
}

function specialDots() {
  const group = L.layerGroup();
  state.dots = [];
  for (const nr of specialNumbers()) {
    const index = stationIndexFor(nr);
    if (index < 0) continue;
    const [lng, lat] = state.stations.features[index].geometry.coordinates;
    const dot = L.circleMarker([lat, lng], dotStyle(nr));
    dot.nr = nr;
    dot.on({
      mouseover(event) {
        if (String(nr) !== String(state.highlightNr)) {
          const look = state.highlightNr ? { color: palette.selected, ...PREVIEW } : { color: palette.selected, weight: 2 };
          setHover(event.target, look, () => event.target.setStyle(dotStyle(nr)));
        }
        showHoverCard(event, precinctCard(nr), `p${nr}`);
      },
      mousemove(event) {
        moveHoverCard(event);
      },
      mouseout(event) {
        clearHover(event.target);
        hideHoverCard(`p${nr}`);
      },
      click(event) {
        L.DomEvent.stopPropagation(event);
        if (peekFirst(event, precinctCard(nr), `p${nr}`)) return;
        openPrecinct(nr);
      },
    });
    group.addLayer(dot);
    state.dots.push(dot);
  }
  return group;
}

function dotStyle(nr) {
  const row = precinctRow(nr);
  const valid = row && row.reported && typeof row.validVotes === "number" ? row.validVotes : 0;
  const selected = String(nr) === String(state.highlightNr);
  const fill = fillFor([nr]);
  // Before a result the dot is a small solid grey point, not an empty ring.
  const size = fill ? 3.5 + Math.min(3, Math.sqrt(valid) / 7) : 2.6;
  return {
    radius: (phoneLayout() ? 0.72 : 1) * size,
    color: selected ? palette.selected : palette.line,
    weight: selected ? 2.4 : fill ? 1.2 : 0.8,
    opacity: 1,
    fillColor: fill || palette.dotEmpty,
    fillOpacity: state.highlightNr && !selected ? 0.4 : 1,
  };
}

function paintDots() {
  for (const dot of state.dots || []) {
    dot.setStyle(dotStyle(dot.nr));
    if (String(dot.nr) === String(state.highlightNr)) dot.bringToFront();
  }
}

function openPrecinct(nr) {
  const stationIndex = stationIndexFor(nr);
  if (stationIndex < 0) return;
  hideHoverCard();
  if (state.view === "districts") showPrecinctMap();
  openStation(stationIndex, nr);
}

// Hover card: follows the pointer on a computer. On a touch screen the first
// tap shows it with a button, and a second tap on the same area opens it.
let hoverKey = null;

function touchOnly() {
  return window.matchMedia("(hover: none)").matches;
}

function showHoverCard(event, html, key) {
  if (touchOnly()) return;
  const card = document.querySelector("#hover-card");
  hoverKey = key;
  card.innerHTML = html;
  card.hidden = false;
  card.classList.remove("is-pinned");
  moveHoverCard(event);
}

function moveHoverCard(event) {
  const card = document.querySelector("#hover-card");
  if (card.hidden || !event.containerPoint) return;
  const stage = card.parentElement.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  let x = event.containerPoint.x + 16;
  let y = event.containerPoint.y + 16;
  if (x + width > stage.width - 8) x = event.containerPoint.x - width - 16;
  if (y + height > stage.height - 8) y = event.containerPoint.y - height - 16;
  card.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}

function hideHoverCard(key) {
  if (key && key !== hoverKey) return;
  const card = document.querySelector("#hover-card");
  card.hidden = true;
  hoverKey = null;
  state.peek = null;
}

function peekFirst(event, html, key) {
  if (!touchOnly() || state.peek === key) return false;
  const card = document.querySelector("#hover-card");
  card.innerHTML = html + `<button type="button" class="card-open" data-open="${escapeHtml(key)}">Pokaż szczegóły</button>`;
  card.hidden = false;
  card.classList.add("is-pinned");
  hoverKey = key;
  state.peek = key;
  moveHoverCard(event);
  return true;
}

function precinctCard(nr) {
  const index = stationIndexFor(nr);
  const station = index >= 0 ? state.stations.features[index].properties : null;
  const special = !precinctShapeFeature(nr);
  const kicker = special ? `Obwód ${nr} · komisja odrębna` : `Obwód ${nr}`;
  const place = station ? `<p class="card-place">${escapeHtml(station.siedziba)}</p><p class="card-address">${escapeHtml(address(station))}</p>` : "";
  return `<p class="card-kicker">${kicker}</p>${place}${cardNumbers(tally([nr]))}`;
}

function districtCard(feature) {
  const key = feature.properties.dzielnica;
  const roman = key.replace("Dzielnica ", "");
  const sum = tally(feature.properties.nrs);
  return `<p class="card-kicker">Dzielnica ${escapeHtml(roman)}</p><p class="card-place">${escapeHtml(DISTRICT_TITLE[key] || key)}</p>
    <p class="card-address">${sum.reported} z ${feature.properties.nrs.length} ${obwodNoun(feature.properties.nrs.length)} policzone</p>${cardNumbers(sum)}`;
}

function cardNumbers(sum) {
  if (!sum.reported) return `<p class="card-wait">Jeszcze nie policzono</p>`;
  const [first, second] = state.candidates;
  const both = sum.a + sum.b;
  const width = both > 0 ? (sum.a / both) * 100 : 50;
  const turnout = sum.eligible > 0 ? formatPercent((100 * sum.cards) / sum.eligible) : "—";
  return `<div class="card-duel">
      <span style="--c:${first.color}"><b>${percentLabel(sum.a, sum.valid)}</b>${escapeHtml(first.short)}</span>
      <span style="--c:${second.color}"><b>${percentLabel(sum.b, sum.valid)}</b>${escapeHtml(second.short)}</span>
    </div>
    <div class="split" aria-hidden="true"><span style="width:${width}%;background:${first.color}"></span><span style="background:${second.color}"></span></div>
    <p class="card-meta">Frekwencja ${turnout} · ${formatCount(sum.valid)} ${voteNoun(sum.valid)}</p>`;
}

// Street map only when zoomed in far enough to look for a building.
function fadeBasemap() {
  const map = state.map;
  const basemap = state.basemap;
  if (!map || !basemap || !basemap._container) return;
  const zoom = map.getZoom();
  const amount = Math.max(0, Math.min(1, (zoom - 13) / 1.4));
  basemap._container.style.opacity = String(amount);
  map.getPane("overlayPane").style.opacity = String(1 - amount * 0.35);
}

const ResetControl = L.Control.extend({
  onAdd() {
    const box = L.DomUtil.create("div", "leaflet-bar reset-control");
    const button = L.DomUtil.create("a", "", box);
    button.href = "#";
    button.title = "Cały Kraków";
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", "Pokaż cały Kraków");
    button.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.on(button, "click", (event) => {
      L.DomEvent.preventDefault(event);
      hideHoverCard();
      if (placeIsOpen()) closeSheet();
      else if (state.district) selectDistrict("");
      else {
        state.map.stop();
        state.map.setZoom(state.map.getMinZoom(), { animate: false });
        fitCity();
      }
    });
    return box;
  },
});

function bringSelectedToFront() {
  const nr = state.highlightNr;
  if (!nr || !state.precinctLayer) return;
  state.precinctLayer.eachLayer((shape) => {
    if (String(shape.feature.properties.nr) === String(nr)) toFront(shape);
  });
}

function bringSelectedDistrictToFront() {
  if (!state.district || !state.districtLayer) return;
  state.districtLayer.eachLayer((shape) => {
    if (shape.feature.properties.dzielnica === state.district) toFront(shape);
  });
}

function paintDistricts() {
  const layer = state.districtLayer;
  if (!layer) return;
  layer.eachLayer((shape) => {
    layer.resetStyle(shape);
    const selected = shape.feature.properties.dzielnica === state.district;
    markSelected(shape, selected);
    if (selected) shape.bringToFront();
  });
}

const DISTRICT_TITLE = {
  "Dzielnica I": "Stare Miasto",
  "Dzielnica II": "Grzegórzki",
  "Dzielnica III": "Prądnik Czerwony",
  "Dzielnica IV": "Prądnik Biały",
  "Dzielnica V": "Krowodrza",
  "Dzielnica VI": "Bronowice",
  "Dzielnica VII": "Zwierzyniec",
  "Dzielnica VIII": "Dębniki",
  "Dzielnica IX": "Łagiewniki-Borek Fałęcki",
  "Dzielnica X": "Swoszowice",
  "Dzielnica XI": "Podgórze Duchackie",
  "Dzielnica XII": "Bieżanów-Prokocim",
  "Dzielnica XIII": "Podgórze",
  "Dzielnica XIV": "Czyżyny",
  "Dzielnica XV": "Mistrzejowice",
  "Dzielnica XVI": "Bieńczyce",
  "Dzielnica XVII": "Wzgórza Krzesławickie",
  "Dzielnica XVIII": "Nowa Huta",
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII"];

function districtRank(name) {
  const index = ROMAN.indexOf(String(name).replace("Dzielnica ", ""));
  return index < 0 ? 99 : index;
}

function setMapView(view) {
  if (placeIsOpen()) closeSheet();
  clearHover();
  hideHoverCard();
  state.view = view;
  state.district = null;
  state.highlightNr = null;
  const districts = view === "districts";
  const map = state.map;
  if (districts) {
    map.removeLayer(state.precinctLayer);
    map.removeLayer(state.dotLayer);
    state.districtLayer.addTo(map);
  } else {
    map.removeLayer(state.districtLayer);
    state.precinctLayer.addTo(map);
    state.dotLayer.addTo(map);
  }
  if (!map.hasLayer(state.borderLayer)) state.borderLayer.addTo(map);
  bringBordersToFront();
  syncModeButtons();
  document.querySelector("#district-menu").hidden = !districts;
  paintPrecincts();
  paintDistricts();
  renderLegend();
  renderDistrictMenu();
  fitCity(true);
}

function selectDistrict(key) {
  state.district = key || null;
  state.highlightNr = null;
  paintDistricts();
  renderDistrictMenu();
  document.querySelector("#district-menu").hidden = true;
  if (!state.district) {
    if (placeIsOpen()) closeSheet();
    else fitCity(true);
    return;
  }
  showDistrict(state.district);
  fitDistrict(state.district, true);
}

function fitDistrict(key, animate) {
  const map = state.map;
  if (!map || !state.districtLayer) return;
  let target = null;
  state.districtLayer.eachLayer((shape) => {
    if (shape.feature.properties.dzielnica === key) target = shape;
  });
  if (!target) return;
  const pad = viewPadding();
  map.fitBounds(withSurroundings(target.getBounds(), 0.42), {
    paddingTopLeft: L.point(pad.paddingTopLeft.x + 12, 36),
    paddingBottomRight: pad.paddingBottomRight.add([24, 36]),
    animate: animate !== false,
    maxZoom: 14,
  });
}

function syncModeButtons() {
  for (const view of ["precincts", "districts", "turnout"]) {
    document.querySelector(`#mode-${view}`).setAttribute("aria-pressed", String(state.view === view));
  }
}

function renderLegend() {
  const box = document.querySelector("#map-legend");
  const empty = `<span class="legend-note"><i style="background:${palette.empty}"></i>Nie policzono</span>`;
  const dots = state.view === "districts" ? "" : `<span class="legend-note"><i class="is-dot"></i>Szpitale, DPS, areszty</span>`;
  if (state.view === "turnout") {
    const swatches = TURNOUT_STRENGTH.map((amount) => `<i style="background:${mixHex(palette.neutral, palette.turnout, amount)}"></i>`).join("");
    box.innerHTML = `<p class="legend-title">Frekwencja</p>
      <div class="legend-ramp">${swatches}</div>
      <p class="legend-scale"><span>poniżej ${TURNOUT_STEPS[0]}%</span><span>${TURNOUT_STEPS[TURNOUT_STEPS.length - 1]}% i więcej</span></p>
      <div class="legend-notes">${empty}${dots}</div>`;
    return;
  }
  const [first, second] = state.candidates;
  const side = (candidate) => MARGIN_STRENGTH.map((amount) => `<i style="background:${mixHex(palette.neutral, candidate.color, amount)}"></i>`);
  const swatches = [...side(first).reverse(), ...side(second)].join("");
  box.innerHTML = `<p class="legend-heads"><span style="--c:${first.color}">${escapeHtml(first.short)}</span><span style="--c:${second.color}">${escapeHtml(second.short)}</span></p>
    <div class="legend-ramp is-split">${swatches}</div>
    <p class="legend-scale"><span>+30 pkt</span><span>wyrównane</span><span>+30 pkt</span></p>
    <div class="legend-notes">${empty}${dots}</div>`;
}

function renderDistrictMenu() {
  const list = document.querySelector("#district-list");
  const whole = document.querySelector('#district-menu [data-district=""]');
  if (whole) whole.setAttribute("aria-pressed", String(!state.district));
  const features = [...state.districts.features].sort(
    (a, b) => districtRank(a.properties.dzielnica) - districtRank(b.properties.dzielnica)
  );
  list.innerHTML = features.map((feature) => {
    const key = feature.properties.dzielnica;
    const fill = marginColor(tally(feature.properties.nrs));
    const roman = key.replace("Dzielnica ", "");
    const dot = fill ? `<i style="background:${fill}"></i>` : "";
    return `<button type="button" data-district="${escapeHtml(key)}" aria-pressed="${state.district === key}">
      <span>${roman}</span><strong>${escapeHtml(DISTRICT_TITLE[key] || key)}</strong>${dot}
    </button>`;
  }).join("");
}

function paintPrecincts() {
  const layer = state.precinctLayer;
  if (!layer) return;
  layer.eachLayer((shape) => {
    layer.resetStyle(shape);
  });
  if (state.borderLayer) state.borderLayer.setStyle(borderStyle());
  bringBordersToFront();
  layer.eachLayer((shape) => {
    const selected = String(shape.feature.properties.nr) === String(state.highlightNr);
    markSelected(shape, selected);
    if (selected) shape.bringToFront();
  });
  paintDots();
}

function leaderOf(nr) {
  const row = state.results.precincts[nr];
  if (!row || !row.reported) return null;
  let best = null;
  for (const candidate of state.candidates) {
    if (candidate.withdrawn) continue;
    const votes = row.votes[candidate.id];
    if (typeof votes !== "number") continue;
    if (!best || votes > best.votes) best = { ...candidate, votes };
  }
  return best;
}

function stationIndexFor(nr) {
  return state.stations.features.findIndex((feature) =>
    feature.properties.obwody.includes(String(nr))
  );
}

let fitting = false;
let settling = false;
let focusDone = null;
let cancelGlide = () => {};

function withSurroundings(bounds, fraction) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const latSpan = Math.max(ne.lat - sw.lat, 0.008);
  const lngSpan = Math.max(ne.lng - sw.lng, 0.01);
  return L.latLngBounds(
    [sw.lat - latSpan * fraction, sw.lng - lngSpan * fraction],
    [ne.lat + latSpan * fraction, ne.lng + lngSpan * fraction]
  );
}

// On a computer the open district list sits over the map's left edge, so
// the city is framed to the right of it.
function menuInset(mapEl) {
  const menu = document.querySelector("#district-menu");
  if (!menu || menu.hidden || phoneLayout()) return 0;
  const box = menu.getBoundingClientRect();
  return box.width ? Math.max(0, box.right - mapEl.left + 16) : 0;
}

function viewPadding() {
  const mapEl = document.querySelector("#map").getBoundingClientRect();
  const zoom = document.querySelector(".leaflet-control-zoom");
  const zoomBox = zoom ? zoom.getBoundingClientRect() : null;
  let right = zoomBox && zoomBox.width ? 56 : 16;
  if (zoomBox && zoomBox.width) right = Math.max(right, mapEl.right - zoomBox.left + 10);
  return {
    // On a compact screen the view switch sits on top of the map and the
    // legend strip at the bottom, so the city is framed between them.
    paddingTopLeft: L.point(menuInset(mapEl) || 16, compactLayout() ? 54 : 16),
    paddingBottomRight: L.point(right, compactLayout() ? (phoneLayout() ? 72 : 48) : 16),
  };
}

// `force` refits even when the city is already in view, e.g. when the
// district list opens or closes and the free space changes.
function fitCity(force) {
  const map = state.map;
  if (!map || fitting === "city") return;
  if (map._loaded) {
    if (focusDone) {
      map.off("moveend", focusDone);
      focusDone = null;
    }
    map.stop();
  }
  fitting = false;
  const size = map.getSize();
  if (size.x < 40 || size.y < 40) return;
  const pad = viewPadding();
  // A phone has little room, so the city gets a thinner margin there.
  const frame = withSurroundings(state.cityBounds, phoneLayout() ? 0.04 : 0.16);
  map.setMinZoom(0);
  const fitted = map.getBoundsZoom(frame, false, pad.paddingTopLeft.add(pad.paddingBottomRight));
  if (!Number.isFinite(fitted)) return;
  map.setMinZoom(fitted);
  const zoom = map._loaded ? map.getZoom() : null;
  if (!force && zoom != null && map.getBounds().contains(frame) && zoom <= fitted + 0.01) return;
  fitting = "city";
  const glide = Boolean(force) && map._loaded && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  map.fitBounds(frame, { ...pad, animate: glide, duration: 0.45 });
  fitting = false;
}

function easeCity() {
  glideCity();
}

function placeIsOpen() {
  return !document.querySelector("#place-view").hidden;
}

function precinctShape(nr) {
  let found = null;
  state.precinctLayer.eachLayer((shape) => {
    if (String(shape.feature.properties.nr) === String(nr)) found = shape;
  });
  return found;
}

function boundsForNumbers(numbers) {
  let bounds = null;
  for (const nr of numbers) {
    const shape = precinctShape(nr);
    if (!shape) continue;
    const next = shape.getBounds();
    bounds = bounds ? bounds.extend(next) : next;
  }
  return bounds;
}

function focusView() {
  const feature = state.focusFeature;
  if (!feature) return null;
  if (state.highlightNr) {
    const shape = precinctShape(state.highlightNr);
    if (shape) return shape.getBounds();
  }
  const bounds = boundsForNumbers(feature.properties.obwody);
  if (bounds) return bounds;
  const [lng, lat] = feature.geometry.coordinates;
  return L.latLng(lat, lng).toBounds(450);
}

function focusPadding() {
  const mapEl = document.querySelector("#map").getBoundingClientRect();
  const chip = document.querySelector("#pkw-wait");
  const zoom = document.querySelector(".leaflet-control-zoom");
  let top = 48;
  if (chip) top = Math.max(top, chip.getBoundingClientRect().bottom - mapEl.top + 16);
  const zoomBox = zoom ? zoom.getBoundingClientRect() : null;
  let right = zoomBox && zoomBox.width ? 56 : 24;
  if (zoomBox && zoomBox.width) right = Math.max(right, mapEl.right - zoomBox.left + 10);
  return {
    paddingTopLeft: L.point(24, top),
    paddingBottomRight: L.point(right, 24),
  };
}

function fitPrecinct(animate) {
  const map = state.map;
  const bounds = focusView();
  if (!map || !bounds) return;
  const size = map.getSize();
  if (size.x < 40 || size.y < 40) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = animate !== false && !reduce;
  if (map._loaded) map.stop();
  if (focusDone) map.off("moveend", focusDone);
  let settled = false;
  let timer = 0;
  const done = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    map.off("moveend", done);
    if (focusDone === done) focusDone = null;
    fitting = false;
    syncBasemap();
  };
  focusDone = done;
  fitting = true;
  map.once("moveend", done);
  timer = window.setTimeout(done, motion ? 900 : 50);
  map.fitBounds(withSurroundings(bounds, 0.42), { ...focusPadding(), maxZoom: 15, animate: motion, duration: 0.6 });
}

function resizeBasemap(layer) {
  if (!layer || !layer._glMap || !layer._map || !layer._container) return;
  const size = layer.getSize();
  layer._container.style.width = size.x + "px";
  layer._container.style.height = size.y + "px";
  const canvas = layer._glMap._actualCanvas;
  if (canvas) L.DomUtil.setTransform(canvas, L.point(0, 0), 1);
  layer._zooming = false;
  layer._glMap.resize();
  layer._update();
}

function syncBasemap() {
  const map = state.map;
  if (!map) return;
  map.eachLayer((layer) => {
    if (layer._glMap) resizeBasemap(layer);
  });
}

function glideCity() {
  const map = state.map;
  if (!map) return;
  cancelGlide();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const panel = document.querySelector(".panel");
  const apply = () => {
    settling = false;
    map.invalidateSize({ animate: false, pan: false });
    if (placeIsOpen() && state.focusFeature) fitPrecinct(true);
    else if (state.view === "districts" && state.district) fitDistrict(state.district, true);
    else {
      fitCity();
      syncBasemap();
    }
  };
  if (reduce) {
    cancelGlide = () => {};
    apply();
    return;
  }
  settling = true;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelGlide = () => {};
    panel.removeEventListener("transitionend", onEnd);
    window.clearTimeout(fallback);
    apply();
  };
  const onEnd = (event) => {
    if (event.target !== panel) return;
    if (event.propertyName !== "width" && event.propertyName !== "flex-basis") return;
    finish();
  };
  panel.addEventListener("transitionend", onEnd);
  const fallback = window.setTimeout(finish, 700);
  const startWidth = panel.getBoundingClientRect().width;
  const unchanged = window.setTimeout(() => {
    if (!finished && panel.getBoundingClientRect().width === startWidth) finish();
  }, 80);
  cancelGlide = () => {
    finished = true;
    settling = false;
    panel.removeEventListener("transitionend", onEnd);
    window.clearTimeout(fallback);
    window.clearTimeout(unchanged);
  };
}

function openStation(index, nr) {
  hideHoverCard();
  state.highlightNr = nr ? String(nr) : null;
  paintPrecincts();
  showPlace(state.stations.features[index], state.highlightNr);
  hits.hidden = true;
  query.blur();
}

// A phone held upright gets the bottom sheet. A phone on its side keeps the
// desktop layout, only tighter. Both are "compact": the race moves into the
// panel as its headline, so the map keeps all its height.
const PHONE_QUERY = "(max-width: 860px) and (orientation: portrait)";
const COMPACT_QUERY = `${PHONE_QUERY}, (orientation: landscape) and (max-height: 560px)`;

function phoneLayout() {
  return window.matchMedia(PHONE_QUERY).matches;
}

function compactLayout() {
  return window.matchMedia(COMPACT_QUERY).matches;
}

function placeRace() {
  const race = document.querySelector("#race");
  const panel = document.querySelector(".panel");
  const main = document.querySelector(".main");
  if (!race || !panel || !main) return;
  const compact = compactLayout();
  document.documentElement.classList.toggle("is-compact", compact);
  if (compact && race.parentElement !== panel) panel.insertBefore(race, document.querySelector("#city-view"));
  if (!compact && race.parentElement !== main) main.appendChild(race);
}

function watchLayout() {
  const relayout = () => {
    placeRace();
    if (!state.map) return;
    state.map.invalidateSize({ animate: false, pan: false });
    if (placeIsOpen() && state.focusFeature) fitPrecinct(false);
    else if (state.view === "districts" && state.district) fitDistrict(state.district, false);
    else fitCity(true);
    syncBasemap();
    paintDots();
  };
  for (const query of [PHONE_QUERY, COMPACT_QUERY]) {
    const list = window.matchMedia(query);
    if (list.addEventListener) list.addEventListener("change", relayout);
  }
}

function setDetent(detent) {
  const panel = document.querySelector(".panel");
  if (panel.dataset.detent === detent) return;
  panel.dataset.detent = detent;
}

// Phone bottom sheet: drag the handle, or tap it to step between heights.
function bindSheet() {
  const panel = document.querySelector(".panel");
  const handle = panel.querySelector(".sheet-handle");
  const order = ["peek", "half", "full"];
  let start = null;
  handle.addEventListener("pointerdown", (event) => {
    if (!phoneLayout()) return;
    start = { y: event.clientY, height: panel.getBoundingClientRect().height, moved: false };
    handle.setPointerCapture(event.pointerId);
    panel.classList.add("is-dragging");
    settling = true;
  });
  handle.addEventListener("pointermove", (event) => {
    if (!start) return;
    const delta = start.y - event.clientY;
    if (Math.abs(delta) > 4) start.moved = true;
    const max = window.innerHeight * 0.9;
    panel.style.height = `${Math.max(120, Math.min(max, start.height + delta))}px`;
  });
  const release = (event) => {
    if (!start) return;
    const moved = start.moved;
    const height = panel.getBoundingClientRect().height;
    start = null;
    panel.classList.remove("is-dragging");
    panel.style.removeProperty("height");
    if (moved) {
      const share = height / window.innerHeight;
      setDetent(share < 0.36 ? "peek" : share < 0.7 ? "half" : "full");
    } else {
      const next = order[(order.indexOf(panel.dataset.detent) + 1) % order.length];
      setDetent(next);
    }
    if (event && handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    settleSheet();
  };
  handle.addEventListener("pointerup", release);
  handle.addEventListener("pointercancel", release);
}

function settleSheet() {
  settling = true;
  window.setTimeout(() => {
    settling = false;
    const map = state.map;
    if (!map) return;
    map.invalidateSize({ animate: false, pan: false });
    if (placeIsOpen() && state.focusFeature) fitPrecinct(true);
    else if (state.view === "districts" && state.district) fitDistrict(state.district, true);
    else fitCity();
    syncBasemap();
  }, 360);
}

function showPlace(feature, highlightNr) {
  const city = document.querySelector("#city-view");
  const place = document.querySelector("#place-view");
  const panel = document.querySelector(".panel");
  state.focusFeature = feature;
  const columns = feature.properties.obwody.length + (feature.properties.obwody.length > 1 ? 1 : 0);
  panel.classList.remove("is-district");
  panel.classList.add("is-place");
  panel.style.setProperty("--place-cols", String(columns));
  city.hidden = true;
  place.hidden = false;
  place.innerHTML = stationPopup(feature, highlightNr);
  place.scrollTop = 0;
  bindPlaceActions(place);
  if (phoneLayout() && panel.dataset.detent === "peek") setDetent("half");
  requestAnimationFrame(() => easeCity());
}

function showDistrict(key) {
  const feature = state.districts.features.find((item) => item.properties.dzielnica === key);
  if (!feature) return;
  const city = document.querySelector("#city-view");
  const place = document.querySelector("#place-view");
  const panel = document.querySelector(".panel");
  state.focusFeature = null;
  panel.classList.remove("is-place");
  panel.classList.add("is-district");
  panel.style.removeProperty("--place-cols");
  city.hidden = true;
  place.hidden = false;
  place.innerHTML = districtSheet(feature);
  place.scrollTop = 0;
  bindPlaceActions(place);
  if (phoneLayout() && panel.dataset.detent === "peek") {
    setDetent("half");
    settleSheet();
  }
}

function bindPlaceActions(place) {
  place.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", closeSheet);
  });
}

function showPrecinctMap() {
  state.view = "precincts";
  state.district = null;
  if (state.map.hasLayer(state.districtLayer)) state.map.removeLayer(state.districtLayer);
  if (!state.map.hasLayer(state.precinctLayer)) state.precinctLayer.addTo(state.map);
  if (!state.map.hasLayer(state.dotLayer)) state.dotLayer.addTo(state.map);
  bringBordersToFront();
  syncModeButtons();
  document.querySelector("#district-menu").hidden = true;
  paintDistricts();
  renderLegend();
  renderDistrictMenu();
}

function closeSheet() {
  const city = document.querySelector("#city-view");
  const place = document.querySelector("#place-view");
  if (place.hidden) return;
  place.hidden = true;
  place.innerHTML = "";
  city.hidden = false;
  const panel = document.querySelector(".panel");
  panel.classList.remove("is-place", "is-district");
  panel.style.removeProperty("--place-cols");
  state.highlightNr = null;
  state.focusFeature = null;
  state.district = null;
  paintPrecincts();
  paintDistricts();
  renderDistrictMenu();
  requestAnimationFrame(() => easeCity());
}

function renderHits(raw) {
  const term = raw.trim().toLocaleLowerCase("pl-PL");
  if (!term) {
    hits.hidden = true;
    hits.innerHTML = "";
    return;
  }
  const matches = [];
  state.stations.features.forEach((feature, index) => {
    const props = feature.properties;
    const haystack = [
      props.obwody.join(" "),
      props.siedziba,
      props.ulica,
      props.nrBud,
    ]
      .join(" ")
      .toLocaleLowerCase("pl-PL");
    const exact = props.obwody.some((nr) => nr === term);
    if (exact || haystack.includes(term)) matches.push({ feature, index, exact });
  });
  matches.sort((a, b) => Number(b.exact) - Number(a.exact));
  const shown = matches.slice(0, 8);
  hits.hidden = shown.length === 0;
  hits.innerHTML = shown
    .map(({ feature, index }) => {
      const props = feature.properties;
      return `<li><button type="button" data-index="${index}"><strong>${escapeHtml(props.siedziba)}</strong><small>obwody ${escapeHtml(props.obwody.join(", "))} · ${escapeHtml(address(props))}</small></button></li>`;
    })
    .join("");
  hits.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => openStation(Number(button.dataset.index)));
  });
}

function renderSummary() {
  const results = state.results;
  const status = document.querySelector("#status");
  const statusLabel = document.querySelector("#status-label");
  const statusMeta = document.querySelector("#status-meta");
  const statusMeter = document.querySelector(".status-meter");
  const sample = document.querySelector("#sample");
  sample.hidden = !results.sample;
  const flowing = !results.sample && results.precinctsReporting > 0 && results.precinctsReporting < results.precinctsTotal;
  const share = results.precinctsTotal > 0 ? (results.precinctsReporting / results.precinctsTotal) * 100 : 0;
  status.classList.toggle("is-flowing", flowing);
  statusMeter.hidden = !flowing;
  statusMeta.hidden = !flowing;
  if (flowing) status.style.setProperty("--share", String(share));
  if (results.sample) {
    statusLabel.textContent = "Podgląd przykładowych wyników";
  } else if (results.status === "awaiting" || results.precinctsReporting === 0) {
    statusLabel.textContent = "Oczekiwanie na wyniki";
  } else if (flowing) {
    statusLabel.textContent = "Wyniki spływają";
    statusMeta.textContent = `${formatShare(share)} · ${numberFormat.format(results.precinctsReporting)} z ${numberFormat.format(results.precinctsTotal)}`;
  } else {
    statusLabel.textContent = results.round === 2 ? "Wyniki drugiej tury" : "Wyniki pełne";
  }
  document.querySelector("#turnout").textContent = formatPercent(officialTurnout(results));
  const reporting = document.querySelector("#reporting");
  const counted = document.createElement("b");
  counted.textContent = numberFormat.format(results.precinctsReporting);
  const ofTotal = document.createElement("em");
  ofTotal.textContent = ` / ${numberFormat.format(results.precinctsTotal)}`;
  reporting.replaceChildren(counted, ofTotal);
  document.querySelector("#valid").textContent = formatCount(results.validVotes);
  renderProgress();
  renderPkwChip();
  renderRunoff();
  renderRace();
  startCountdown();
}

function renderPkwChip() {
  const results = state.results;
  const chip = document.querySelector("#pkw-wait");
  const title = document.querySelector("#pkw-title");
  const detail = document.querySelector("#pkw-detail");
  const total = results.precinctsTotal;
  const reported = results.precinctsReporting;
  const share = total > 0 ? (reported / total) * 100 : 0;
  chip.style.setProperty("--share", String(share));
  const countLine = `${numberFormat.format(reported)} z ${numberFormat.format(total)} obwodów`;
  const countedShare = `<b>${formatShare(share)}</b><span>${numberFormat.format(reported)} z ${numberFormat.format(total)} obwodów</span>`;
  if (results.sample) {
    chip.dataset.state = "sample";
    title.textContent = "Podgląd, nie wyniki PKW";
    detail.textContent = countLine;
    return;
  }
  if (results.status === "awaiting" || reported === 0) {
    chip.dataset.state = "awaiting";
    title.textContent = "Czekamy na wyniki PKW";
    detail.textContent = countLine;
    return;
  }
  if (reported < total) {
    chip.dataset.state = "partial";
    title.textContent = "Wyniki spływają";
    detail.innerHTML = countedShare;
    return;
  }
  chip.dataset.state = "full";
  title.textContent = "Wyniki pełne";
  detail.innerHTML = countedShare;
}

function renderRunoff() {
  const card = document.querySelector("#runoff");
  const results = state.results;
  const complete = !results.sample && results.precinctsTotal > 0 && results.precinctsReporting >= results.precinctsTotal;
  card.hidden = !complete;
  if (!complete) {
    hideTicker();
    return;
  }
  const ranked = state.candidates
    .filter((candidate) => !candidate.withdrawn)
    .map((candidate) => ({
      candidate,
      votes: typeof results.candidates[candidate.id] === "number" ? results.candidates[candidate.id] : 0,
    }))
    .sort((a, b) => b.votes - a.votes || a.candidate.ballot - b.candidate.ballot);
  const valid = results.validVotes;
  const shown = ranked.slice(0, 2);
  const [leader, runnerUp] = shown;
  const tie = !leader || leader.votes === 0 || (runnerUp && runnerUp.votes === leader.votes);
  const elected = !tie;
  card.classList.toggle("is-elected", elected);
  document.querySelector("#runoff-kicker").textContent =
    `Policzone · ${numberFormat.format(results.precinctsReporting)} z ${numberFormat.format(results.precinctsTotal)}`;
  document.querySelector("#runoff-title").textContent = elected
    ? `${electedWord(leader.candidate)} Krakowa: ${leader.candidate.short}`
    : "Remis";
  document.querySelector("#runoff-when").textContent = elected
    ? "Więcej ważnych głosów w drugiej turze"
    : "Kandydaci mają tyle samo ważnych głosów";
  document.querySelector("#runoff-places").innerHTML = shown
    .map((row, index) => runoffPlace(row, index + 1, valid))
    .join("");
  renderTicker(shown, elected);
  if (elected) celebrateCount(shown.slice(0, 1));
}

function electedWord(candidate) {
  return candidate.feminine ? "Prezydentka" : "Prezydent";
}

function hideTicker() {
  document.querySelector("#ticker").hidden = true;
  document.documentElement.classList.remove("has-ticker");
  document.querySelector("#ticker-live").textContent = "";
  document.querySelector("#ticker-track").replaceChildren();
}

function renderTicker(shown, elected) {
  const ticker = document.querySelector("#ticker");
  const track = document.querySelector("#ticker-track");
  const text = tickerLine(shown, elected);
  document.querySelector("#ticker-live").textContent = text;
  ticker.hidden = false;
  document.documentElement.classList.add("has-ticker");
  track.replaceChildren();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const unit = document.createElement("span");
  unit.textContent = text;
  track.appendChild(unit);
  if (reduce) return;
  const unitWidth = unit.getBoundingClientRect().width;
  if (unitWidth < 1) return;
  const viewport = track.parentElement.clientWidth;
  const copies = Math.max(2, Math.ceil((viewport * 2) / unitWidth));
  for (let index = 1; index < copies; index += 1) track.appendChild(unit.cloneNode(true));
  track.style.setProperty("--shift", `${unitWidth}px`);
  track.style.setProperty("--ticker-time", `${Math.max(16, unitWidth / 70)}s`);
}

function tickerLine(shown, elected) {
  const valid = state.results.validVotes;
  const line = (row) =>
    `${row.candidate.name}, ${formatCount(row.votes)} ${voteNoun(row.votes)} (${percentLabel(row.votes, valid)})`;
  const rest = shown.slice(1).map((row) => ` ${line(row)}.`).join("");
  if (!elected) {
    return `Druga tura, 11 października 2026. Remis: ${shown.map(line).join(" i ")}.`;
  }
  const verb = shown[0].candidate.feminine ? "Prezydentką" : "Prezydentem";
  return `Druga tura, 11 października 2026. ${verb} Krakowa zostaje ${line(shown[0])}.${rest}`;
}

function voteNoun(votes) {
  const value = Math.abs(votes);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (value === 1) return "głos";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "głosy";
  return "głosów";
}

function celebrateCount(rows) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const seen = "krakow-wybory-2-tura-confetti";
  try {
    if (sessionStorage.getItem(seen)) return;
    sessionStorage.setItem(seen, "1");
  } catch {
    return;
  }
  const layer = document.querySelector("#confetti");
  const colors = rows.map((row) => row.candidate.color);
  colors.push("#f3e6d4");
  for (let index = 0; index < 46; index += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.28}s`;
    piece.style.animationDuration = `${1.55 + Math.random() * 0.7}s`;
    piece.style.setProperty("--drift", `${Math.round((Math.random() - 0.5) * 140)}px`);
    piece.style.setProperty("--spin", `${Math.round((Math.random() - 0.5) * 420)}deg`);
    piece.style.width = `${6 + (index % 3) * 2}px`;
    piece.style.height = `${9 + (index % 4) * 2}px`;
    layer.appendChild(piece);
  }
  window.setTimeout(() => layer.replaceChildren(), 2600);
}

function runoffPlace(row, place, valid) {
  const { candidate, votes } = row;
  const width = typeof valid === "number" && valid > 0 ? (votes / valid) * 100 : 0;
  return `<li class="runoff-place">
    <span class="runoff-mark" style="background:${candidate.color}">${place}</span>
    <span class="runoff-copy">
      <strong>${escapeHtml(displayName(candidate))}</strong>
      <span>${formatCount(votes)} · ${percentLabel(votes, valid)}</span>
    </span>
    <span class="runoff-bar" aria-hidden="true"><span style="width:${width}%;background:${candidate.color}"></span></span>
  </li>`;
}

function countedSoFar() {
  let ballots = 0;
  let valid = 0;
  let precincts = 0;
  for (const row of Object.values(state.results.precincts)) {
    if (!row.reported) continue;
    precincts += 1;
    if (typeof row.ballots === "number") ballots += row.ballots;
    if (typeof row.validVotes === "number") valid += row.validVotes;
  }
  return { ballots, valid, precincts };
}

function renderProgress() {
  const results = state.results;
  const counted = countedSoFar();
  const total = results.precinctsTotal;
  const waiting = counted.precincts === 0;
  const status = document.querySelector("#progress-status");
  const percent = formatShare(total > 0 ? (counted.precincts / total) * 100 : 0);
  status.textContent = waiting
    ? "Oczekiwanie"
    : counted.precincts >= total
      ? "Policzone"
      : `${percent} policzone`;
  document.querySelector("#progress-precincts").textContent = waiting
    ? "—"
    : `${numberFormat.format(counted.precincts)} / ${numberFormat.format(total)}`;
  document.querySelector("#progress-ballots").textContent = waiting ? "—" : formatCount(counted.ballots);
  document.querySelector("#progress-valid").textContent = waiting ? "—" : formatCount(counted.valid);
  const share = total > 0 ? (counted.precincts / total) * 100 : 0;
  document.querySelector("#progress-bar").style.width = `${share}%`;
}

function renderCandidates() {
  document.querySelector("#duel").innerHTML = duelMarkup(state.results.candidates, state.results.validVotes, true);
}

// Two candidates facing each other, with one bar split between them.
function duelMarkup(votesById, validVotes, city) {
  const [first, second] = state.candidates;
  const votesOf = (candidate) => (votesById && typeof votesById[candidate.id] === "number" ? votesById[candidate.id] : null);
  const a = votesOf(first);
  const b = votesOf(second);
  const counted = a !== null && b !== null && typeof validVotes === "number" && validVotes > 0;
  const lead = counted && a !== b ? (a > b ? first : second) : null;
  const side = (candidate, votes, align) => {
    const detail = counted
      ? `${formatCount(votes)} ${voteNoun(votes)}`
      : city && candidate.firstRound
        ? `I tura: ${formatPercent(candidate.firstRound.share)}`
        : "";
    const ahead = lead && lead.id === candidate.id ? " is-ahead" : "";
    return `<div class="duel-side ${align}${ahead}" style="--c:${candidate.color}">
        <span class="duel-name" title="${escapeHtml(candidate.name)}">${escapeHtml(city ? displayName(candidate) : candidate.short)}</span>
        <strong class="duel-pct">${counted ? percentLabel(votes, validVotes) : "—"}</strong>
        <span class="duel-votes">${detail}</span>
      </div>`;
  };
  const both = counted ? a + b : 0;
  const width = both > 0 ? (a / both) * 100 : 50;
  let note = "";
  if (counted) {
    note = lead
      ? `<p class="duel-lead"><b style="color:${lead.color}">${escapeHtml(lead.short)} +${formatPoints((100 * Math.abs(a - b)) / validVotes)}</b> przewagi</p>`
      : `<p class="duel-lead"><b>Remis</b></p>`;
  }
  // The city duel leaves the bar to the race under the map.
  const bar = city
    ? ""
    : `<div class="split is-large${counted ? "" : " is-empty"}" aria-hidden="true">
      <span style="width:${width}%;background:${first.color}"></span><span style="background:${second.color}"></span><i></i>
    </div>`;
  return `<div class="duel-grid">${side(first, a, "is-left")}${side(second, b, "is-right")}</div>${bar}${note}`;
}

// The race to 50%, under the map. Each candidate grows from their own end:
// share of counted valid votes × share of commissions counted. The grey
// middle is what is still uncounted, so the bars close in on the 50% line
// as the count goes on. Only the full count names a winner.
function renderRace() {
  const box = document.querySelector("#race");
  if (!box) return;
  const results = state.results;
  const [first, second] = state.candidates;
  const total = results.precinctsTotal || 0;
  const reported = results.sample ? 0 : Math.min(results.precinctsReporting || 0, total);
  const progress = total > 0 ? reported / total : 0;
  const valid = results.validVotes;
  const votesOf = (candidate) => (typeof results.candidates[candidate.id] === "number" ? results.candidates[candidate.id] : null);
  const a = votesOf(first);
  const b = votesOf(second);
  const counted = reported > 0 && a !== null && b !== null && typeof valid === "number" && valid > 0;
  const widthA = counted ? (a / valid) * progress * 100 : 0;
  const widthB = counted ? (b / valid) * progress * 100 : 0;
  const complete = counted && reported >= total;
  const winner = complete && a !== b ? (a > b ? first : second) : null;
  const side = (candidate, votes, align) => {
    // The numbers count up together with the bar (see animateRace).
    const figure = counted
      ? `<strong data-count="${(100 * votes) / valid}" data-kind="share">0,00%</strong><span data-count="${votes}" data-kind="votes">0 głosów</span>`
      : `<strong>—</strong><span>czekamy na wyniki</span>`;
    const won = winner && winner.id === candidate.id ? " is-winner" : "";
    return `<div class="race-side ${align}${won}" style="--c:${candidate.color}">
        <span class="race-name">${escapeHtml(displayName(candidate))}</span>
        <span class="race-figure">${figure}</span>
      </div>`;
  };
  let middle;
  if (winner) middle = `<b style="color:${winner.color}">Wygrywa ${escapeHtml(winner.short)}</b>`;
  else if (complete) middle = "<b>Remis</b>";
  else if (counted) middle = "<b>50%</b> wygrywa";
  else middle = "Kto pierwszy przekroczy <b>50%</b>?";
  const remaining = total - reported;
  const foot = complete
    ? `Policzono wszystkie ${numberFormat.format(total)} komisje`
    : counted
      ? `Policzono ${numberFormat.format(reported)} z ${numberFormat.format(total)} ${obwodNoun(total)} · szary środek to ${numberFormat.format(remaining)} jeszcze niepoliczonych`
      : `Czekamy na pierwsze wyniki PKW · 0 z ${numberFormat.format(total)} ${obwodNoun(total)}`;

  // First round, 27 September, as a thinner reference bar. The grey middle
  // is everyone else on that ballot.
  const pastA = first.firstRound ? first.firstRound.share : 0;
  const pastB = second.firstRound ? second.firstRound.share : 0;
  const others = Math.max(0, 100 - pastA - pastB);
  const past = pastA || pastB
    ? `<div class="race-past" aria-label="I tura, 27 września: ${escapeHtml(first.short)} ${formatPercent(pastA)}, ${escapeHtml(second.short)} ${formatPercent(pastB)}, pozostali ${formatPercent(others)}">
        <div class="race-track is-past" aria-hidden="true">
          <span class="race-bar is-left" data-width="${pastA}" style="--c:${first.color}"></span>
          <span class="race-bar is-right" data-width="${pastB}" style="--c:${second.color}"></span>
          <i class="race-line"></i>
        </div>
        <p class="race-past-labels" aria-hidden="true">
          <span><b class="race-past-num" style="--c:${first.color}" data-count="${pastA}" data-kind="share">0,00%</b></span>
          <span class="race-past-tag">I tura, 27 września<span class="race-past-others"> · pozostali kandydaci ${formatPercent(others)}</span></span>
          <span><b class="race-past-num" style="--c:${second.color}" data-count="${pastB}" data-kind="share">0,00%</b></span>
        </p>
      </div>`
    : "";

  box.classList.toggle("is-complete", complete);
  box.classList.remove("is-crossed");
  if (winner) box.style.setProperty("--win", winner.color);
  box.innerHTML = `<div class="race-head">${side(first, a, "is-left")}<p class="race-middle">${middle}</p>${side(second, b, "is-right")}</div>
    <div class="race-track is-main" aria-hidden="true">
      <span class="race-bar is-left" data-width="${widthA}" style="--c:${first.color}"></span>
      <span class="race-bar is-right" data-width="${widthB}" style="--c:${second.color}"></span>
      <i class="race-line"></i>
    </div>
    ${past}
    <p class="race-foot">${foot}</p>`;
  animateRace(box, Boolean(winner));
}

// Fill in from both edges toward the middle, counting the numbers up with
// the bars. The main race goes first; the first-round bar follows.
function animateRace(box, crowned) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const groups = [
    { root: box.querySelector(".race-track.is-main"), extra: box.querySelectorAll(".race-head [data-count]"), delay: 150, duration: 1700 },
    { root: box.querySelector(".race-past"), extra: [], delay: 650, duration: 1300 },
  ].filter((group) => group.root);
  const ease = (t) => 1 - Math.pow(1 - t, 4);
  const paint = (group, amount) => {
    group.root.querySelectorAll(".race-bar").forEach((bar) => {
      bar.style.width = `${Number(bar.dataset.width) * amount}%`;
    });
    [...group.root.querySelectorAll("[data-count]"), ...group.extra].forEach((node) => {
      const target = Number(node.dataset.count);
      const value = target * amount;
      if (node.dataset.kind === "share") node.textContent = formatPercent(value);
      else {
        const whole = Math.round(value);
        node.textContent = `${formatCount(whole)} ${voteNoun(whole)}`;
      }
    });
  };
  const crown = () => { if (crowned) box.classList.add("is-crossed"); };
  if (reduce) {
    groups.forEach((group) => paint(group, 1));
    crown();
    return;
  }
  groups.forEach((group) => paint(group, 0));
  const start = performance.now();
  const step = (now) => {
    let running = false;
    for (const group of groups) {
      const t = Math.min(1, Math.max(0, (now - start - group.delay) / group.duration));
      paint(group, ease(t));
      if (t < 1) running = true;
    }
    if (running) requestAnimationFrame(step);
    else crown();
  };
  requestAnimationFrame(step);
}

function displayName(candidate) {
  const words = candidate.name.split(" ");
  return words.length > 2 ? `${words[0]} ${words[words.length - 1]}` : candidate.name;
}

// Election day, Polish time (CEST, UTC+2). Silence starts at midnight
// between Friday and Saturday and lasts until the polls close.
const SILENCE_AT = Date.parse("2026-10-10T00:00:00+02:00");
const POLLS_OPEN_AT = Date.parse("2026-10-11T07:00:00+02:00");
const POLLS_CLOSE_AT = Date.parse("2026-10-11T21:00:00+02:00");
let countdownTimer = 0;

function startCountdown() {
  const box = document.querySelector("#countdown");
  if (!box) return;
  const results = state.results;
  const waiting = !results.sample && !(results.precinctsReporting > 0);
  window.clearInterval(countdownTimer);
  box.hidden = !waiting;
  if (!waiting) return;
  renderCountdown(box);
  countdownTimer = window.setInterval(() => renderCountdown(box), 1000);
}

function renderCountdown(box) {
  const now = Date.now();
  if (now >= POLLS_CLOSE_AT) {
    window.clearInterval(countdownTimer);
    box.innerHTML = `<p class="countdown-title">Lokale zamknięte</p><p class="countdown-note">Czekamy na pierwsze wyniki PKW.</p>`;
    box.setAttribute("aria-label", "Lokale zamknięte. Czekamy na pierwsze wyniki PKW.");
    return;
  }
  const voting = now >= POLLS_OPEN_AT;
  const target = voting ? POLLS_CLOSE_AT : POLLS_OPEN_AT;
  const left = splitTime(target - now);
  // Days only while there is at least one; the last night shows hours.
  const showDays = !voting && left.days > 0;
  const tiles = [
    ...(showDays ? [[left.days, dayNoun(left.days)]] : []),
    [left.hours, "godz."],
    [left.minutes, "min"],
    [left.seconds, "sek"],
  ]
    .map(([value, unit], index) => `<span class="countdown-tile"><b>${showDays && index === 0 ? value : pad2(value)}</b><small>${unit}</small></span>`)
    .join("");
  let note;
  if (voting) {
    note = `<p class="countdown-note"><span>Głosujesz w swoim obwodzie · znajdź lokal poniżej</span></p>`;
  } else if (now >= SILENCE_AT) {
    note = `<p class="countdown-note is-silence"><i></i><span>Trwa cisza wyborcza · do zamknięcia lokali w niedzielę o 21:00</span></p>`;
  } else {
    const silence = splitTime(SILENCE_AT - now);
    const days = silence.days > 0 ? `${silence.days} ${dayNoun(silence.days)} ` : "";
    note = `<p class="countdown-note is-silence-soon"><i></i><span>Cisza wyborcza za <b>${days}${pad2(silence.hours)}:${pad2(silence.minutes)}:${pad2(silence.seconds)}</b> · od północy z piątku na sobotę</span></p>`;
  }
  const title = voting ? "Lokale otwarte · do zamknięcia zostało" : "Otwarcie lokali za";
  box.innerHTML = `<p class="countdown-title">${title}</p>
    <div class="countdown-tiles${showDays ? "" : " is-three"}" aria-hidden="true">${tiles}</div>${note}`;
  const spoken = voting
    ? `Lokale otwarte do 21:00.`
    : `Lokale otwierają się w niedzielę 11 października o 7:00, za ${left.days} ${dayNoun(left.days)} i ${left.hours} godz.`;
  box.setAttribute("aria-label", spoken);
}

function splitTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dayNoun(days) {
  return days === 1 ? "dzień" : "dni";
}

function formatPoints(value) {
  const rounded = pkwRound(value, 2);
  return `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rounded)} pkt`;
}

function stationPopup(feature, highlightNr) {
  const props = feature.properties;
  const numbers = [...props.obwody].sort((a, b) => Number(a) - Number(b));
  const showTotal = numbers.length > 1;
  const total = showTotal ? placeTotals(numbers) : null;
  const heads = numbers.map((nr) => columnHead(nr, String(nr) === String(highlightNr))).join("");
  const totalHead = showTotal
    ? `<th scope="col" class="is-total"><span class="nr-label">Razem</span><span class="nr-note">${total.reportedCount} z ${numbers.length}</span></th>`
    : "";
  const stats = [
    ["Uprawnieni", (row) => formatCount(row && row.eligible), (sum) => formatCount(sum.eligible)],
    ["Frekwencja", turnoutOf, turnoutOf],
    ["Ważne", (row) => formatCount(row && row.validVotes), (sum) => formatCount(sum.validVotes)],
    ["Nieważne", (row) => formatCount(row && row.invalidVotes), (sum) => formatCount(sum.invalidVotes)],
  ];
  const statRows = stats
    .map(([label, cell, totalCell]) => {
      const tds = numbers
        .map((nr) => statCell(cell(precinctRow(nr))))
        .join("");
      const tail = showTotal ? statCell(totalCell(total), "is-total") : "";
      const last = label === "Nieważne" ? " is-break" : "";
      return `<tr class="is-stat${last}"><th scope="row">${label}</th>${tds}${tail}</tr>`;
    })
    .join("");
  const candidateRows = state.candidates
    .map((candidate) => {
      const note = candidate.withdrawn ? `<span class="withdrawn-note">wycofany</span>` : "";
      const tds = numbers.map((nr) => voteCell(candidate, precinctRow(nr), nr, highlightNr)).join("");
      const tail = showTotal ? voteTotalCell(candidate, total) : "";
      return `<tr>
        <th scope="row" class="is-candidate" style="--c:${candidate.color}"><span class="who"><span>${escapeHtml(candidate.short)}</span>${note}</span></th>
        ${tds}${tail}
      </tr>`;
    })
    .join("");
  return `<div class="place-toolbar">
      <button type="button" class="place-back" data-close>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3.2L5.2 8 10 12.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Miasto
      </button>
      <button type="button" class="sheet-close" data-close aria-label="Zamknij">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.2 3.2l9.6 9.6M12.8 3.2L3.2 12.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
    </div>
    <header class="popup-place">
      <p class="popup-kicker">Lokal wyborczy</p>
      <h3>${escapeHtml(props.siedziba)}</h3>
      <p class="place">${escapeHtml(address(props))}</p>
    </header>
    <div class="popup-blocks">
      <table class="result-table">
        <caption>Wyniki obwodów w tym lokalu</caption>
        <thead>
          <tr>
            <th class="result-corner" scope="col"><span class="nr-label">Obwód</span></th>
            ${heads}
            ${totalHead}
          </tr>
        </thead>
        <tbody>${statRows}${candidateRows}</tbody>
      </table>
    </div>`;
}

function districtSheet(feature) {
  const numbers = [...feature.properties.nrs].sort((a, b) => Number(a) - Number(b));
  const total = placeTotals(numbers);
  const roman = feature.properties.dzielnica.replace("Dzielnica ", "");
  const title = DISTRICT_TITLE[feature.properties.dzielnica] || feature.properties.dzielnica;
  const counted = `<b>${numberFormat.format(total.reportedCount)}</b><em> / ${numberFormat.format(numbers.length)}</em>`;
  return `<div class="place-toolbar">
      <button type="button" class="place-back" data-close>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3.2L5.2 8 10 12.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Miasto
      </button>
      <button type="button" class="sheet-close" data-close aria-label="Zamknij">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.2 3.2l9.6 9.6M12.8 3.2L3.2 12.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
    </div>
    <header class="popup-place">
      <p class="popup-kicker">Dzielnica ${escapeHtml(roman)}</p>
      <h3>${escapeHtml(title)}</h3>
      <p class="place">${numberFormat.format(numbers.length)} ${obwodNoun(numbers.length)}</p>
    </header>
    <section class="totals" aria-label="Wynik dzielnicy">
      <div><span>Frekwencja</span><strong>${turnoutOf(total)}</strong></div>
      <div><span>Obwody</span><strong>${counted}</strong></div>
      <div><span>Ważne głosy</span><strong>${formatCount(total.validVotes)}</strong></div>
    </section>
    <section class="duel">${duelMarkup(total.votes, total.validVotes, false)}</section>`;
}

function obwodNoun(count) {
  const value = Math.abs(count);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (value === 1) return "obwód";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "obwody";
  return "obwodów";
}

function precinctRow(nr) {
  return state.results.precincts[String(nr)] || null;
}

function columnHead(nr) {
  return `<th scope="col"><span class="nr">${escapeHtml(nr)}</span></th>`;
}

function statCell(text, extra = "") {
  const empty = text === "—" ? " is-empty" : "";
  const cls = `${extra}${empty}`.trim();
  return `<td${cls ? ` class="${cls}"` : ""}>${text}</td>`;
}

function placeTotals(numbers) {
  const rows = numbers.map((nr) => precinctRow(nr)).filter((row) => row && row.reported);
  const votes = {};
  for (const candidate of state.candidates) votes[candidate.id] = sumVotes(rows, candidate.id);
  return {
    reportedCount: rows.length,
    eligible: sumField(rows, "eligible"),
    ballots: sumField(rows, "ballots"),
    validCards: sumField(rows, "validCards"),
    validVotes: sumField(rows, "validVotes"),
    invalidVotes: sumField(rows, "invalidVotes"),
    votes,
  };
}

function sumField(rows, key) {
  if (!rows.length) return null;
  let total = 0;
  for (const row of rows) {
    if (typeof row[key] !== "number") return null;
    total += row[key];
  }
  return total;
}

function sumVotes(rows, id) {
  if (!rows.length) return null;
  let total = 0;
  for (const row of rows) {
    const value = row.votes && row.votes[id];
    if (typeof value !== "number") return null;
    total += value;
  }
  return total;
}

function officialTurnout(results) {
  const cards = typeof results.validCards === "number" ? results.validCards : results.ballots;
  if (typeof cards !== "number" || typeof results.eligible !== "number" || results.eligible <= 0) return results.turnout;
  return (100 * cards) / results.eligible;
}

function turnoutOf(row) {
  if (!row || typeof row.eligible !== "number" || row.eligible <= 0) return "—";
  const cards = typeof row.validCards === "number" ? row.validCards : row.ballots;
  if (typeof cards !== "number") return "—";
  return percentLabel(cards, row.eligible);
}

function voteCell(candidate, row, nr) {
  const votes = row && row.votes ? row.votes[candidate.id] : null;
  if (candidate.withdrawn) return countCell(votes, "is-withdrawn");
  const valid = row && row.reported ? row.validVotes : null;
  const leader = leaderOf(nr);
  const ahead = leader && leader.id === candidate.id ? " is-ahead" : "";
  return countCell(votes, ahead, valid, candidate.color);
}

function voteTotalCell(candidate, total) {
  const votes = total.votes[candidate.id];
  if (candidate.withdrawn) return countCell(votes, "is-total is-withdrawn");
  return countCell(votes, "is-total", total.validVotes, candidate.color);
}

function countCell(votes, extra = "", valid = null, color = "") {
  const empty = typeof votes !== "number" ? " is-empty" : "";
  const cls = `${extra}${empty}`.trim();
  if (typeof votes !== "number" || valid == null) {
    return `<td${cls ? ` class="${cls}"` : ""}><span class="nums"><strong>${formatCount(votes)}</strong></span></td>`;
  }
  const width = valid > 0 ? (votes / valid) * 100 : 0;
  return `<td${cls ? ` class="${cls}"` : ""}>
      <span class="nums"><strong>${formatCount(votes)}</strong><em>${percentLabel(votes, valid)}</em></span>
      <span class="meter" aria-hidden="true"><span style="width:${width}%;background:${color}"></span></span>
    </td>`;
}

function address(props) {
  return `${titleCase(props.ulica)} ${props.nrBud}`;
}

function titleCase(value) {
  return value
    .toLocaleLowerCase("pl-PL")
    .replace(/(^|[\s\-„”"'])(\p{L})/gu, (_, prefix, letter) => prefix + letter.toLocaleUpperCase("pl-PL"));
}

function formatCount(value) {
  return typeof value === "number" ? numberFormat.format(value) : "—";
}

function pkwRound(value, digits) {
  const shifted = Number(`${value}e${digits}`);
  return Number(`${Math.round(shifted)}e-${digits}`);
}

function formatShare(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  const rounded = pkwRound(value, 2);
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(rounded)}%`;
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  const rounded = pkwRound(value, 2);
  return `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rounded)}%`;
}

function percentLabel(votes, valid) {
  if (typeof votes !== "number" || typeof valid !== "number" || valid <= 0) return "—";
  return formatPercent((100 * votes) / valid);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
