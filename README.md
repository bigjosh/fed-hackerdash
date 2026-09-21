# FEDLIGHT

A movie-style hacker dashboard: cyberpunk meets Minority Report. Thirteen live panels tell one
story. NULLSEC's Operation FEDLIGHT is hunting WRAITH through the streets of Paris against a
countdown to a grid wipe, while handler **Agent Fed** runs the show over a secure uplink.

- **Live Paris map**: real OpenStreetMap streets, the Seine, the Périphérique and all 20
  arrondissements. WRAITH's red dot drives the actual road network while the intercept units
  close in (among them UNIT FEDORA and K-9 KONA).
- **ENHANCE**: a rainy traffic-camera frame that zooms, sharpens and OCRs a French licence
  plate.
- **Urgent 7-segment countdown** that escalates to a zero-hour takeover.
- **Green CRT terminal** that types on its own and takes your commands (`help`, `status`,
  `override`, `matrix`…).
- **Other panels**: node mesh, proxy-trace globe, cipher break, core telemetry, voice
  intercept, radar, biometric scan, target dossier and event log.
- **Handler calls**: Agent Fed checks in at story beats.

Some things are hidden. They're for people who know the phrase.

## Run

Open `index.html`. It's a single standalone file with everything inlined; it also works offline,
except the fonts.

| key | does |
|---|---|
| `E` | enhance the camera feed |
| `T` | restart the proxy trace |
| `` ` `` or `/` | focus the terminal |
| `I` | trigger an intrusion |
| `M` | toggle audio |
| `F` | fullscreen |

URL options: `?t=90` sets the countdown in seconds, `?seed=42` makes a run repeatable, `?still`
reduces motion, and `?solo=map&w=640&h=420` shows one panel alone.

## Develop

```bash
python build.py            # index.html (inlined, served by GitHub Pages), dev.html (links src/), dist/fedlight.html
python tools/shot.py       # real-time headless screenshot + console errors + fps (pip install playwright)
python tools/paris_data.py # re-fetch and re-encode the Paris map data (cached in tools/.cache)
```

`src/js/core.js` holds the runtime (event bus, mission clock, frame loop and panel registry).
`src/js/shell.js` handles the chrome, and `src/css/base.css` the layout and tokens. There is one
file per panel in `src/js/panels/`, and the shared Paris dataset is `src/js/data/paris.js`. The
panel API and event catalog are in `CONTRACT.md`.

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available
under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/).
`src/js/data/paris.js` is a derived database of that data and is shared under the same licence.

Everything else is fiction: NULLSEC, WRAITH, the KAIZEN MORRIGAN GT and the grid wipe are made
up. The fonts are Michroma, Chakra Petch, JetBrains Mono and VT323 via Google Fonts.
