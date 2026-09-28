# Wybory prezydenta Krakowa · druga tura, 11 października 2026

Statyczna strona na wieczór wyborczy drugiej tury: mapa Krakowa, wszystkie lokale i obwody oraz dwoje kandydatów — Łukasz Gibała i Monika Jadwiga Piątkowska. W pierwszej turze (27 września 2026) nikt nie przekroczył połowy głosów: Gibała 36,38%, Piątkowska 29,91%. Strona pierwszej tury zostaje jako archiwum: [Krakow-Wybory-Prezydenckie-27-Wrzesnia-2026](https://terra-cracovianum.github.io/Krakow-Wybory-Prezydenckie-27-Wrzesnia-2026/).

Szczegóły techniczne są w [docs/HANDOVER.md](docs/HANDOVER.md).

## Co jest na mapie

- 454 obwodowe komisje wyborcze, numery 1–454, z listy PKW dla gminy Kraków: 412 stałych i 42 odrębne. Numer 417 to Szpital na Siemiradzkiego. Numer 444 to jeden obwód, nie suma.
- 250 lokali (kilka obwodów bywa w jednym budynku). Mapa nie stawia przy nich kropek.
- 412 obwodów stałych (poligony) z warstwy MSIP „Aktualny podział na obwody wyborcze”. Kliknięcie obwodu otwiera lokal. Komisje odrębne, bez poligonu, są w wyszukiwarce.

Lista komisji: [PKW, komisje obwodowe, gmina 4485](https://wybory.gov.pl/wojtburmistrz_2024_2029/pl/4485/organy_wyborcze/komisje_obwodowe). Podkład: [OpenFreeMap](https://openfreemap.org/), styl Positron. Położenie budynków: [MSIP Kraków, K05_Wybory_Dzielnice](https://msip.um.krakow.pl/arcgis/rest/services/Obserwatorium/K05_Wybory_Dzielnice/MapServer). Cztery adresy z listy PKW nie miały punktu w MSIP (Lubelska 29, Wadowicka 8W, Henryka Siemiradzkiego 1, Forteczna 22) — ich współrzędne pochodzą z OpenStreetMap.

## Jak wgrać wyniki

Jedyny plik do zmiany to [`data/results.json`](data/results.json). Teraz stoi na `"status": "awaiting"`, `"round": 2` i 454 obwodach z `"reported": false`. Wpisuj tylko oficjalne liczby PKW. Pole `"sample": true` zostawia baner, że dane są przykładowe — przy prawdziwych wynikach go nie ustawiaj.

- `status`: `awaiting`, dopóki nie ma liczb; po pierwszych obwodach `partial`; po komplecie `final`
- `updatedAt`: czas aktualizacji, np. `"2026-10-11T22:40:00+02:00"`
- `round`: `2`
- `precinctsReporting` i `precinctsTotal` (454)
- `eligible`, `ballots`, `validCards`, `validVotes`, `invalidVotes`
- `candidates`: głosy w całym mieście, klucze `gibala` i `piatkowska` jak w [`data/candidates.json`](data/candidates.json)
- `precincts`: jeden wpis na numer obwodu. Uzupełniony obwód ma `"reported": true`. Dopóki `reported` jest `false`, obwód zostaje szary, a w raporcie lokalu widać „—”
  - `eligible`, `ballots`, `validCards`, `validVotes`, `invalidVotes`
  - `votes`: `{ "gibala": …, "piatkowska": … }`

Frekwencja to `validCards / eligible` (gdy brakuje `validCards`, strona bierze `ballots`). Po policzeniu wszystkich 454 obwodów strona pokazuje pasek „Ważne”, kartę z osobą, która dostała więcej ważnych głosów, i konfetti. Przy równej liczbie głosów pisze „Remis” i nikogo nie ogłasza.

Nie dopisujemy wyników z sondaży ani ze zrzutów nieoficjalnych. Kolory przy nazwiskach służą tylko do czytania mapy.

## GitHub Pages

Settings → Pages → Deploy from a branch → `main` → `/ (root)`. Strona nie wymaga budowania. Adres: `https://terra-cracovianum.github.io/Krakow-Wybory-Prezydenckie-Druga-Tura-11-Pazdziernika/`.

Podgląd linku na X, Facebooku i w komunikatorach bierze się z `druga-tura.jpg` (1200×630, baseline JPEG) oraz znaczników w `index.html`. Adres obrazu jest stały, bez parametru w URL. Żeby zmienić obraz, wgraj plik pod nową nazwą i popraw znaczniki.
