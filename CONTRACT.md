# FEDLIGHT — panel contract

A movie-grade "hacker dashboard": **cyberpunk meets Minority Report**. Thirteen live panels on one
screen tell one story. Operation **FEDLIGHT** (fictional agency **NULLSEC**) is hunting target
**WRAITH**, who is driving a black **KAIZEN MORRIGAN GT** through the fictional megacity
**NEW HALCYON**. A countdown runs to a **grid wipe**. Traffic cameras catch the car and the
camera panel **ENHANCES** until the licence plate resolves. The map shows a **red dot moving
along roads**, and a **green CRT terminal** hacks away while it all happens. The screen should
feel **complicated and bustling**: dense micro-labels, tick marks, numeric readouts, blinking
indicators, constant but purposeful motion.

Everything is fictional. Never reference real agencies (FBI/NSA/CIA/Interpol-as-org etc.), real
people or real brands.

## Files

```
src/shell.html          markup: top bar, 13 panel frames, ticker, overlays   (owner: lead — DO NOT EDIT)
src/css/base.css        tokens, layout, panel frame, global fx             (owner: lead — DO NOT EDIT)
src/js/core.js          HD runtime: bus, loop, mission clock, registry       (owner: lead — DO NOT EDIT)
src/js/shell.js         top bar, ticker, reticle, banner, takeover, hotkeys  (owner: lead — DO NOT EDIT)
src/js/panels/<id>.js   one file per panel                                   (owner: that panel's builder)
src/css/panels/<id>.css one file per panel (optional)                        (owner: that panel's builder)
build.py                python build.py → dev.html, index.html, dist/fedlight.html
tools/shot.py           real-time headless screenshots + console/error capture
```

Only touch the files for the panels you were assigned. If you believe core/base/shell needs a
change, do not make it; describe it in your final report (`core_requests`).

## Panel API

```js
HD.panel('map', (ctx) => {
  // build DOM inside ctx.el (the panel body: position:relative, overflow:hidden, sized by the grid)
  const c = ctx.canvas();                 // DPR-aware canvas absolutely filling ctx.el; auto-resized
  const off = ctx.on('target:camera', (d) => { ... });
  return {
    fps: 60,                              // optional tick-rate cap (default: every frame)
    resize(w, h) { ... },                 // body size in CSS px; canvases are already refit
    tick(now, dt) { ... },                // now = performance.now() ms, dt = seconds (≤0.25)
  };
});
```

The factory runs once on boot. `resize` is called right after mount and whenever the body size
changes. `tick` runs only while the panel is on screen and the tab is visible.

`ctx` fields:

| field | what |
|---|---|
| `ctx.el` | panel body element. Put everything inside it. |
| `ctx.frame` | the whole `<section class="panel">` (for dataset/class toggles only). |
| `ctx.width`, `ctx.height` | current body size (CSS px). |
| `ctx.canvas({parent, dprMax=2, alpha=true, className})` | new canvas filling `parent` (default `ctx.el`). `parent` must be positioned with a definite size. Returns `{canvas, ctx, w, h, dpr, fit(), clear()}`; draw in CSS px. Refit automatically before your `resize`. |
| `ctx.meta(text)` | sets the right-side header readout (keep it ≤ ~18 chars, uppercase). |
| `ctx.flash(level, ms)` | frame flash: `'alert'` (red strobe), `'warn'` (amber), `'ok'` (green). |
| `ctx.on(evt, fn)` / `ctx.emit(evt, data)` | event bus (see catalog). `on` returns an unsubscribe fn. |
| `ctx.alert(level, msg)` | shorthand for emitting an `alert` (`level`: `'info'`, `'warn'`, `'crit'`). |
| `ctx.state` | `HD.state`, shared story state (below). |
| `ctx.mission` | mission clock: `remaining()` ms, `progress()` 0..1, `total`, `phase`, `cycle`, `add(ms)`, `reset()`. |
| `ctx.color` | palette hex strings for canvas: `bg bg2 holo holo2 ice text dim faint neon amber threat phosphor phosphorDim`. |
| `ctx.rgba(name or hex, alpha)` | `'rgba(…)'` string, cached. `ctx.rgba('holo', .4)`. |
| `ctx.util` | `clamp lerp damp(a,b,lambda,dt) map ease.{linear,inQuad,outQuad,outCubic,inOutCubic,outExpo,outBack} pad hex randHex(len,r) ip(r) mac(r) fmtClock(date, offsetH) fmtDuration(ms)→{h,m,s,cs,text} el(tag,cls,text) CHARS.{hex,alnum,kata,glyph} scramble(el,text,{duration,chars})→Promise` |
| `ctx.rng(seed)` | seeded PRNG fn with `.range(a,b) .int(a,b) .pick(arr) .chance(p) .sign() .gauss() .shuffle(arr)`. Seed yours from `HD.seed ^ <panel constant>` so `?seed=N` gives repeatable screenshots. |
| `ctx.rand` | shared session PRNG. |
| `ctx.words` | `city, districts[], streets[], cities[{name,cc,lat,lon}], handles[], units[]`. |
| `ctx.audio` | `enabled`, `beep(freq, ms, type, gain)`, `chirp(f1, f2, ms, type, gain)`. No-op unless the user enabled audio. Keep gains ≤ 0.05. |
| `ctx.reducedMotion` | true under `prefers-reduced-motion` or `?still`. Then: no flashing/strobing, slower drift, no shake; content still updates. |

Globals also available: `HD.bus`, `HD.state`, `HD.mission`, `HD.util`, `HD.seed`, `HD.fontsReady`.

### Shared story state — `HD.state`

```js
HD.state.target = {
  codename: 'WRAITH', realName: '[REDACTED]', aliases: ['SABLE','M1RR0R','NULLKATANA'],
  vehicle: 'KAIZEN MORRIGAN GT', vehicleColor: 'MATTE BLACK',
  plate: 'KZ7·R4X9',        // canonical plate (random per session). Enhance "reveals" it.
  plateRevealed: false,     // set true by the enhance panel on its first successful read
  street, district, speed, heading, x, y,   // written by the map panel
  faceSeed,                 // seed for any procedural face
}
HD.state.phase   // 'elevated' | 'severe' | 'critical' | 'final' | 'zero'
```

## Event catalog

Emit only the events your panel owns. Payload fields are required unless marked optional.
Every panel must stay alive **standalone** (`?solo=<id>`): never *depend* on another panel's
events to animate. Run your own ambient timers, and treat bus events as spice that interrupts or
redirects them.

| event | emitted by | payload |
|---|---|---|
| `mission:phase` | core | `{phase, remaining}` — phase thresholds: >120 s elevated, ≤120 s severe, ≤60 s critical, ≤10 s final, 0 zero |
| `mission:zero` | core | `{cycle}` — the shell shows a 7 s takeover, then core calls `reset()` |
| `mission:reset` | core | `{total, cycle}` — a new cycle starts (re-seed/restart your story beats) |
| `mission:adjust` | core | `{deltaMs, remaining}` — someone bought time (`HD.mission.add`) |
| `intrusion` | shell | `{source}` — hostile intrusion banner is on screen for ~2.6 s; glitch/scramble/spike in response |
| `alert` | anyone | `{level:'info'\|'warn'\|'crit', msg, source, panel, time}` — use `ctx.alert(level,msg)`. Event log + ticker show these. Keep it to meaningful beats (≈ one per 5–15 s per panel at most). |
| `ui:enhance` | shell hotkey E, terminal cmd | `{source}` |
| `ui:trace` | shell hotkey T, terminal cmd | `{source}` |
| `ui:terminal` | shell hotkey ` or / | `{source}` — focus the terminal input |
| `ui:intrusion` | hotkey I, terminal cmd | `{source}` — the shell handles it |
| `target:move` | map | `{x, y, street, district, speed, heading, lat, lon}` about 4×/s (x,y normalized 0..1; speed km/h; heading degrees, 0 = north, clockwise) |
| `target:camera` | map | `{camId, street, district}` — target passed a traffic camera (at most one per 8 s) |
| `enhance:start` | enhance | `{camId}` |
| `enhance:result` | enhance | `{camId, plate, confidence, match}` — plate read; `match` = 'WRAITH' |
| `face:match` | face | `{codename, confidence}` |
| `trace:hop` | trace | `{index, total, city, cc, ip, latency}` |
| `trace:complete` | trace | `{city, lat, lon, hops}` |
| `net:compromise` | netgraph | `{ip, host, owned, total}` |
| `decrypt:progress` | decrypt | `{pct, file}` — at most every 10 % |
| `decrypt:complete` | decrypt | `{key, file}` |
| `voice:match` | spectrum | `{codename, confidence, phrase}` |
| `fonts:ready` | core | `{}` — webfonts loaded; re-render any cached text layers |
| `ui:layout` | terminal cmd `layout` | `{source}` — toggle LAYOUT mode (the shell handles it) |
| `layout:mode` | shell | `{editing}` — LAYOUT mode opened or locked; panel bodies get no pointer events while editing |
| `layout:change` | shell | `{id}` — a panel was moved or resized (`id` null for reset/lock). Drop cached client rects. Size changes still arrive through `resize(w, h)` |
| `boot` | core | `{panels}` |

## Look & feel

Palette (CSS tokens in base.css; the same hex values sit in `ctx.color` for canvas):

| token | hex | role |
|---|---|---|
| `--bg` | `#02050a` | ground |
| `--holo` | `#5ff3ff` | holographic chrome: lines, labels, primary data |
| `--holo-2` | `#2bb6d6` | secondary lines |
| `--ice` | `#dff8ff` | brightest readouts, locked/resolved values |
| `--text` / `--text-dim` / `--text-faint` | `#a9dce8` / `#5d8793` / `#2d4d57` | body / labels / grid |
| `--neon` | `#ff2a6d` | cyberpunk accent: stamps, secondary highlights, glitch |
| `--amber` | `#ffb627` | warnings, predicted routes, pending |
| `--threat` | `#ff2340` | the target, critical states, countdown |
| `--phosphor` | `#3dff7f` | CRT terminal green; "OK/owned by us" states |

Fonts (loaded from Google Fonts; always give the fallback stack):
- `var(--f-display)` Michroma: wide, Eurostile-like. Titles and big stamps only, uppercase, letter-spaced.
- `var(--f-ui)` Chakra Petch: UI labels, 600 weight, uppercase, letter-spacing .12–.2em.
- `var(--f-mono)` JetBrains Mono: numbers, IPs, hex, readouts. `tabular-nums`.
- `var(--f-crt)` VT323: the green CRT terminal only.

Canvas font strings: `'500 10px "JetBrains Mono", Consolas, monospace'`,
`'600 10px "Chakra Petch", "Segoe UI", sans-serif'`, `'11px Michroma, "Arial Black", sans-serif'`.
Minimum text size is **9 CSS px**; primary readouts are 11 px or more.

Rules:
- The look is thin 1 px lines, corner brackets, tick marks, chamfered edges and translucent holo fills. No rounded "cards", no emoji and no drop-shadow soup.
- Glow is a spice: canvas `shadowBlur` is expensive, so use it on at most a handful of shapes per frame. Otherwise use pre-rendered glow sprites (offscreen canvas), a second wide low-alpha stroke, or `globalCompositeOperation = 'lighter'`.
- Red belongs to the target and to danger. Cyan is ours. Green belongs to the terminal and "success". Amber means warning or prediction. Magenta is the cyberpunk accent.
- Text must never overflow its box. Clip with ellipsis, or drop low-priority columns at small sizes. `container-type: inline-size` on your root plus `@container` rules works well for DOM panels.
- Scope all CSS under `[data-panel="<id>"]` and prefix classes with a short panel prefix (`.term-`, `.map-`, `.enh-` …). Never style bare elements globally.
- The page is always dark. Paint your own backgrounds where you need them. Your panel sits on the translucent panel fill.
- What is clickable must look clickable. Buttons get `data-hot` (the global reticle shrinks over them) and a visible `:focus-visible`.

## Sizes you must handle

The panel body sizes (w×h CSS px) at the reference viewports:

| panel | 1920×1080 | 1280×720 | 2560×1440 | 1100×800 (6-col) | phone 390 |
|---|---|---|---|---|---|
| terminal | 465×476 | 306×293 | 626×660 | 529×517 | 356×357 |
| map | 939×639 | 619×396 | 1259×881 | 1066×517 | 356×397 |
| countdown | 466×152 | 306×86 | 626×218 | 529×153 | 356×147 |
| enhance | 466×458 | 306×281 | 626×634 | 529×517 | 356×337 |
| netgraph | 308×295 | 201×178 | 414×413 | 350×335 | 356×257 |
| trace | 150×458 | 97×281 | 203×634 | 171×517 | 356×317 |
| decrypt | 308×295 | 201×178 | 414×413 | 350×335 | 356×237 |
| sysmon | 308×133 | 201×74 | 414×192 | 350×153 | 356×197 |
| spectrum | 308×133 | 201×74 | 414×192 | 529×153 | 356×197 |
| radar | 308×295 | 201×178 | 414×413 | 171×517 | 356×277 |
| face | 150×295 | 97×178 | 203×413 | 171×335 | 356×277 |
| dossier | 308×295 | 201×178 | 414×413 | 350×335 | 356×277 |
| alerts | 308×133 | 201×74 | 414×192 | 350×153 | 356×237 |

The 1920×1080 column is the hero size, so it must look superb. At 1280×720 the panel must stay
legible and uncluttered: drop secondary detail rather than shrinking text below 9 px. Aspect
ratios change between layouts (for example, trace is tall and narrow on desktop but wide on
phone), so pick a layout per aspect.

In LAYOUT mode (desktop only) the viewer can resize any panel on a 24×12 snap grid, from its
minimum (in cells, `HD.layout.min(id)`, 2–6 wide and 2–4 tall) up to the whole grid. A cell is
about 52×51 px at 1280×700 and 79×83 px at 1920×1080. So every panel must also render well from
roughly 98×96 px up to 1888×986 px and at strip aspects (24×2, 2×12). It must also survive
repeated `resize` calls at runtime. Panel state may reset on a resize, but the render must not
break.

## Performance budget

The whole dashboard must hold 60 fps on a laptop, so each panel gets roughly 1 ms per frame.
- Draw with canvas for anything that moves a lot. Pre-render static layers (map streets, grids, rings, glyph atlases) to offscreen canvases and blit them.
- Use `fps:` to cap panels that do not need 60 (telemetry 20–30, dossier ~10, text streams ~30).
- No per-frame DOM creation. Cap any DOM list (log lines, rows) at a fixed maximum and remove old nodes. Reuse nodes where possible.
- No `setInterval` faster than 100 ms; drive animation from `tick`. Clear your own timeouts when restarting sequences.
- No unbounded arrays (trails, histories, particles): use ring buffers or caps.
- Avoid layout thrash: never read layout (`offsetWidth`, `getBoundingClientRect`) inside `tick` after writing styles.
- No external requests of any kind (no images, fetch or fonts beyond base). Generate imagery procedurally.

## Testing (required before you report)

```bash
python build.py --dev dev-<id>.html                                  # your private dev page (links src/)
python tools/shot.py --page dev-<id>.html --q "solo=<id>&w=466&h=480" --wait 4000 --out .shots/<id>-hero.png
python tools/shot.py --page dev-<id>.html --q "solo=<id>&w=306&h=300" --out .shots/<id>-720.png
python tools/shot.py --page dev-<id>.html --q "solo=<id>&w=356&h=360" --out .shots/<id>-phone.png
python tools/shot.py --page dev-<id>.html --q "solo=<id>" --wait 3000 --shots 4 --every 2500 --out .shots/<id>-film.png
python tools/shot.py --page dev-<id>.html --out .shots/<id>-full.png                     # whole dashboard
python tools/shot.py --page dev-<id>.html --q "solo=<id>" --eval "HD.bus.emit('intrusion',{})" --out .shots/<id>-intr.png
python tools/shot.py --page dev-<id>.html --q "solo=<id>&t=15" --wait 9000 --out .shots/<id>-final.png
```

Re-run `python build.py --dev dev-<id>.html` whenever you add a new file. Edits to existing
files only need a re-shot, because the dev page links `src/` directly. Other builders are working
in parallel, so in the full-dashboard shot their panels may be empty or erroring. Only errors from
**your** files count against you.

`w`/`h` in the query set the solo panel's outer size (the body is about 2 px narrower and 23 px
shorter). `--press "e@1500"` sends a key. `--eval` runs JS after load, for example to emit fake
events: `HD.bus.emit('target:camera',{camId:'CAM-0417',street:'HAYASHI ST',district:'NEON FLATS'})`.
Open the PNGs with the Read tool and look at them critically.

Always prefix screenshot filenames with your panel id.

Definition of done:
1. `tools/shot.py` reports `errors: 0` for your panels in solo and in the full dashboard.
2. The panel looks excellent at the hero size and clean at the 720p and phone sizes.
3. It animates standalone and reacts to the events listed in its brief.
4. It honours reduced motion (`?still`).
5. The fps printed in solo is not meaningfully below the empty-page baseline, which is about 55 in software raster.

## Code style

Plain browser JS (no modules, no build step, no dependencies), `'use strict'` inside the factory
file's top-level IIFE if you add one, 2-space indent, single quotes, semicolons. Comment
sparingly, explaining *why* rather than *what*, matching `src/js/core.js`. Keep each panel in one
file; helper functions live inside the file's closure, and nothing leaks to `window`.
