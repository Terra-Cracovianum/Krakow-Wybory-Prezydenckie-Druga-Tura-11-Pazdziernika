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
    maxBounds: cityBounds.pad(0.85),
    maxBoundsViscosity: 1,
    worldCopyJump: false,
  });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const basemap = L.maplibreGL({
    style: "https://tiles.openfreemap.org/styles/positron",
  }).addTo(map);
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
      layer.on({
        mouseover(event) {
          if (state.highlightNr) return;
          event.target.setStyle(hoverPrecinct(feature));
          event.target.bringToFront();
        },
        mouseout(event) {
          precinctLayer.resetStyle(event.target);
          bringSelectedToFront();
        },
        click() {
          const stationIndex = stationIndexFor(feature.properties.nr);
          if (stationIndex >= 0) openStation(stationIndex, feature.properties.nr);
        },
      });
    },
  }).addTo(map);
  state.precinctLayer = precinctLayer;
  const districtLayer = L.geoJSON(districts, {
    style: styleDistrict,
    onEachFeature(feature, layer) {
      layer.on({
        mouseover(event) {
          if (state.district) return;
          event.target.setStyle(hoverDistrict(feature));
          event.target.bringToFront();
        },
        mouseout(event) {
          districtLayer.resetStyle(event.target);
          bringSelectedDistrictToFront();
        },
        click() {
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
  document.querySelector("#mode-districts").addEventListener("click", () => {
    if (state.view === "districts") {
      const menu = document.querySelector("#district-menu");
      menu.hidden = !menu.hidden;
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

function stylePrecinct(feature) {
  const lead = outcomeForNumbers([feature.properties.nr]);
  const selected = String(feature.properties.nr) === String(state.highlightNr);
  return areaStyle(lead, selected, Boolean(state.highlightNr && !selected), "precinct");
}

function styleDistrict(feature) {
  const lead = outcomeForNumbers(feature.properties.nrs);
  const selected = feature.properties.dzielnica === state.district;
  return areaStyle(lead, selected, Boolean(state.district && !selected), "district");
}

function areaStyle(lead, selected, dim, kind) {
  const district = kind === "district";
  if (!lead) {
    return {
      color: "rgba(255,255,255,0.85)",
      weight: district ? 1.2 : 0.4,
      opacity: 1,
      fillColor: "#d7deda",
      fillOpacity: dim ? 0.28 : 0.55,
      ...pathEdge,
    };
  }
  return {
    color: selected ? "#172026" : "rgba(255,255,255,0.92)",
    weight: selected ? 1.6 : district ? 1.1 : 0.4,
    opacity: 1,
    fillColor: choropleth(lead.color, lead.share),
    fillOpacity: dim ? 0.34 : 0.9,
    ...pathEdge,
  };
}

function hoverPrecinct(feature) {
  const base = stylePrecinct(feature);
  return { ...base, color: "#ffffff", weight: 1.4, fillOpacity: Math.min(0.98, base.fillOpacity + 0.08) };
}

function hoverDistrict(feature) {
  const base = styleDistrict(feature);
  return { ...base, color: "#172026", weight: 2, fillOpacity: Math.min(0.98, base.fillOpacity + 0.06) };
}

function bringSelectedToFront() {
  const nr = state.highlightNr;
  if (!nr || !state.precinctLayer) return;
  state.precinctLayer.eachLayer((shape) => {
    if (String(shape.feature.properties.nr) === String(nr)) shape.bringToFront();
  });
}

function bringSelectedDistrictToFront() {
  if (!state.district || !state.districtLayer) return;
  state.districtLayer.eachLayer((shape) => {
    if (shape.feature.properties.dzielnica === state.district) shape.bringToFront();
  });
}

function paintDistricts() {
  const layer = state.districtLayer;
  if (!layer) return;
  layer.eachLayer((shape) => {
    layer.resetStyle(shape);
    if (shape.feature.properties.dzielnica === state.district) shape.bringToFront();
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

function outcomeForNumbers(nrs) {
  const votes = {};
  let valid = 0;
  let reported = false;
  for (const nr of nrs || []) {
    const row = state.results.precincts[String(nr)];
    if (!row || !row.reported) continue;
    reported = true;
    if (typeof row.validVotes === "number") valid += row.validVotes;
    for (const candidate of state.candidates) {
      if (candidate.withdrawn) continue;
      const value = row.votes && row.votes[candidate.id];
      if (typeof value === "number") votes[candidate.id] = (votes[candidate.id] || 0) + value;
    }
  }
  if (!reported) return null;
  let best = null;
  for (const candidate of state.candidates) {
    if (candidate.withdrawn) continue;
    const count = votes[candidate.id] || 0;
    if (!best || count > best.votes) best = { candidate, votes: count };
  }
  if (!best) return null;
  return { ...best.candidate, votes: best.votes, share: valid > 0 ? best.votes / valid : 0 };
}

function choropleth(hex, share) {
  const amount = 0.34 + Math.max(0, Math.min(1, (share - 0.25) / 0.25)) * 0.66;
  const value = parseInt(hex.slice(1), 16);
  const mix = (channel) => Math.round(244 + (channel - 244) * amount);
  return `rgb(${mix((value >> 16) & 255)}, ${mix((value >> 8) & 255)}, ${mix(value & 255)})`;
}

function setMapView(view) {
  if (placeIsOpen()) closeSheet();
  state.view = view;
  state.district = null;
  state.highlightNr = null;
  const districts = view === "districts";
  if (districts) {
    state.map.removeLayer(state.precinctLayer);
    state.districtLayer.addTo(state.map);
  } else {
    state.map.removeLayer(state.districtLayer);
    state.precinctLayer.addTo(state.map);
  }
  document.querySelector("#mode-precincts").setAttribute("aria-pressed", String(!districts));
  document.querySelector("#mode-districts").setAttribute("aria-pressed", String(districts));
  document.querySelector("#district-menu").hidden = !districts;
  paintPrecincts();
  paintDistricts();
  renderLegend();
  renderDistrictMenu();
  fitCity();
}

function selectDistrict(key) {
  state.district = key || null;
  state.highlightNr = null;
  paintDistricts();
  renderDistrictMenu();
  document.querySelector("#district-menu").hidden = true;
  if (!state.district) {
    if (placeIsOpen()) closeSheet();
    else fitCity();
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
  const menu = document.querySelector("#district-menu");
  const pad = viewPadding();
  map.fitBounds(withSurroundings(target.getBounds(), 0.42), {
    paddingTopLeft: L.point((menu && !menu.hidden ? 220 : 28) + pad.paddingTopLeft.x, 36),
    paddingBottomRight: pad.paddingBottomRight.add([24, 36]),
    animate: animate !== false,
    maxZoom: 14,
  });
}

function renderLegend() {
  const box = document.querySelector("#map-legend");
  const source = state.view === "districts" ? state.districts.features : state.precinctFeatures.features;
  const seen = new Map();
  for (const feature of source) {
    const lead = outcomeForNumbers(state.view === "districts" ? feature.properties.nrs : [feature.properties.nr]);
    if (lead && !seen.has(lead.id)) seen.set(lead.id, lead);
  }
  const rows = [...seen.values()].sort((a, b) => a.ballot - b.ballot);
  box.innerHTML = rows.map((lead) => {
    const pale = choropleth(lead.color, 0.25);
    const full = choropleth(lead.color, 0.55);
    return `<span class="legend-row"><i style="background:linear-gradient(90deg, ${pale}, ${full})"></i>${escapeHtml(lead.short)}</span>`;
  }).join("") + (rows.length ? `<p class="legend-scale"><span>25%</span><span>50%</span></p>` : "");
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
    const lead = outcomeForNumbers(feature.properties.nrs);
    const roman = key.replace("Dzielnica ", "");
    const dot = lead ? `<i style="background:${lead.color}"></i>` : "";
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
    if (String(shape.feature.properties.nr) === String(state.highlightNr)) shape.bringToFront();
  });
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

function viewPadding() {
  const mapEl = document.querySelector("#map").getBoundingClientRect();
  const zoom = document.querySelector(".leaflet-control-zoom");
  let right = 56;
  if (zoom) right = Math.max(right, mapEl.right - zoom.getBoundingClientRect().left + 10);
  return {
    paddingTopLeft: L.point(16, 16),
    paddingBottomRight: L.point(right, 16),
  };
}

function fitCity() {
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
  const frame = withSurroundings(state.cityBounds, 0.16);
  map.setMinZoom(0);
  const fitted = map.getBoundsZoom(frame, false, pad.paddingTopLeft.add(pad.paddingBottomRight));
  if (!Number.isFinite(fitted)) return;
  map.setMinZoom(fitted);
  const zoom = map._loaded ? map.getZoom() : null;
  if (zoom != null && map.getBounds().contains(frame) && zoom <= fitted + 0.01) return;
  fitting = "city";
  map.fitBounds(frame, { ...pad, animate: false });
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
  let right = 56;
  if (zoom) right = Math.max(right, mapEl.right - zoom.getBoundingClientRect().left + 10);
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
  state.highlightNr = nr ? String(nr) : null;
  paintPrecincts();
  showPlace(state.stations.features[index], state.highlightNr);
  hits.hidden = true;
  query.blur();
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
  bindPlaceActions(place);
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
  bindPlaceActions(place);
}

function bindPlaceActions(place) {
  place.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", closeSheet);
  });
  place.querySelectorAll("[data-obwod]").forEach((button) => {
    button.addEventListener("click", () => openListedPrecinct(button.dataset.obwod));
  });
}

function openListedPrecinct(nr) {
  showPrecinctMap();
  const index = stationIndexFor(nr);
  if (index >= 0) openStation(index, nr);
}

function showPrecinctMap() {
  state.view = "precincts";
  state.district = null;
  if (state.map.hasLayer(state.districtLayer)) state.map.removeLayer(state.districtLayer);
  if (!state.map.hasLayer(state.precinctLayer)) state.precinctLayer.addTo(state.map);
  document.querySelector("#mode-precincts").setAttribute("aria-pressed", "true");
  document.querySelector("#mode-districts").setAttribute("aria-pressed", "false");
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
  title.textContent = results.round === 2 ? "Wyniki drugiej tury" : "Wyniki pełne";
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
      <strong>${escapeHtml(candidate.name)}</strong>
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
  document.querySelector("#candidates").innerHTML = candidateList(state.results.candidates, state.results.validVotes);
}

function candidateList(votesById, validVotes) {
  const max = Math.max(
    0,
    ...state.candidates.map((candidate) =>
      typeof votesById[candidate.id] === "number" ? votesById[candidate.id] : 0
    )
  );
  return state.candidates
    .map((candidate) => {
      const votes = votesById[candidate.id];
      const width = max > 0 && typeof votes === "number" ? (votes / max) * 100 : 0;
      const label = percentLabel(votes, validVotes);
      const share = label === "—" ? "" : `<span class="sep"> · </span><span class="share">${label}</span>`;
      const leader = max > 0 && votes === max && !candidate.withdrawn ? " is-leader" : "";
      return `<li class="candidate${candidate.withdrawn ? " withdrawn" : ""}${leader}">
        <header>
          <span class="swatch" style="background:${candidate.color}"></span>
          <h2 title="${escapeHtml(candidate.name)}">${candidate.ballot}. ${escapeHtml(candidate.short)}</h2>
          <span class="count">${formatCount(votes)}${share}</span>
        </header>
        <p class="meta">${escapeHtml(candidate.committee)}</p>
        ${candidate.note ? `<p class="note">${escapeHtml(candidate.note)}</p>` : ""}
        <div class="bar" aria-hidden="true"><span style="width:${width}%;background:${candidate.color}"></span></div>
      </li>`;
    })
    .join("");
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
        <th scope="row"><span class="who"><span class="swatch" style="background:${candidate.color}"></span><span>${escapeHtml(candidate.short)}</span>${note}</span></th>
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
  const chips = numbers
    .map((nr) => `<button type="button" class="obwod-chip" data-obwod="${escapeHtml(nr)}">${escapeHtml(nr)}</button>`)
    .join("");
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
    <div class="obwod-chips" aria-label="Obwody dzielnicy">${chips}</div>
    <section class="totals" aria-label="Wynik dzielnicy">
      <div><span>Frekwencja</span><strong>${turnoutOf(total)}</strong></div>
      <div><span>Obwody</span><strong>${counted}</strong></div>
      <div><span>Ważne głosy</span><strong>${formatCount(total.validVotes)}</strong></div>
    </section>
    <ol class="candidates">${candidateList(total.votes, total.validVotes)}</ol>`;
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
