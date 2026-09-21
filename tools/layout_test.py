#!/usr/bin/env python3
"""End-to-end test of LAYOUT mode with real mouse and keyboard input (Playwright + installed Chrome).

  python tools/layout_test.py                  # full run at 1920x1080, frames in .shots/layout/
  python tools/layout_test.py --size 1280x720  # the smallest editable screen

Checks: L enters edit mode; a drag moves a panel; a throw lands in bounds; edge and corner pulls
resize (and stop at the minimum); arrows and shift+arrows nudge; the arrangement survives a reload;
RESET restores the stock grid and LOCK hands it back to CSS; a throw cut short by LOCK, an arrow
key or RESET leaves nothing stuck, and a card caught in flight stays under the pointer; small
screens have no layout mode;
zero console errors. Prints the frame rate while a panel is dragged continuously. Exit code 1 on
any failure.
"""
import argparse
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / ".shots" / "layout"
fails = []


def check(ok, what):
    print(("  ok   " if ok else "  FAIL ") + what)
    if not ok:
        fails.append(what)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", default="dev.html")
    ap.add_argument("--size", default="1920x1080")
    a = ap.parse_args()
    w, h = (int(v) for v in a.size.lower().split("x"))
    url = (ROOT / a.page).resolve().as_uri()
    OUT.mkdir(parents=True, exist_ok=True)
    logs = []

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=["--mute-audio"])
        ctx = browser.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        page.on("console", lambda m: logs.append((m.type, m.text)))
        page.on("pageerror", lambda e: logs.append(("pageerror", str(e))))
        page.goto(url + "?seed=7", wait_until="load")
        page.evaluate("() => localStorage.removeItem('fedlight.layout.v1')")
        page.wait_for_timeout(3200)

        L = lambda: page.evaluate("() => HD.layout.get()")  # noqa: E731
        box = lambda id: page.locator(f'[data-panel="{id}"]').bounding_box()  # noqa: E731
        shot = lambda name: page.screenshot(path=str(OUT / f"{name}.png"))  # noqa: E731

        # ---- enter
        page.mouse.move(w * 0.5, h * 0.45)
        page.keyboard.press("l")
        page.wait_for_timeout(260)
        shot("01-enter-flourish")
        page.wait_for_timeout(700)
        check(page.evaluate("() => HD.layout.editing"), "L enters layout mode")
        check(page.evaluate("() => document.documentElement.classList.contains('has-custom-layout')"), "custom layout applied")
        shot("02-edit-mode")

        # ---- drag the countdown by its header to the lower left
        b = box("countdown")
        sx, sy = b["x"] + b["width"] * 0.4, b["y"] + 10
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.wait_for_timeout(120)
        shot("03-grab")
        tx, ty = w * 0.3, h * 0.55
        for i in range(1, 25):
            k = i / 24
            page.mouse.move(sx + (tx - sx) * k, sy + (ty - sy) * k)
            page.wait_for_timeout(16)
            if i == 12:
                shot("04-drag-mid")
        page.wait_for_timeout(400)  # hold still so it drops, not throws
        shot("05-drag-hover")
        page.mouse.up()
        page.wait_for_timeout(120)
        shot("06-drop-impact")
        page.wait_for_timeout(1200)
        shot("07-docked")
        cd = L()["countdown"]
        check(cd["x"] != 18 or cd["y"] != 0, f"drag moved countdown (now {cd})")

        # ---- resize the map (before the throw, so nothing lands on its corner) from its bottom-right corner, up and left
        before = L()["map"]
        b = box("map")
        hx, hy = b["x"] + b["width"], b["y"] + b["height"]
        page.mouse.move(hx - 2, hy - 2)
        page.mouse.down()
        for i in range(1, 21):
            page.mouse.move(hx - 2 - i * 14, hy - 2 - i * 9)
            page.wait_for_timeout(16)
        page.wait_for_timeout(200)
        shot("09-resize-live")
        page.mouse.up()
        page.wait_for_timeout(140)
        shot("10-resize-morph")
        page.wait_for_timeout(1200)
        shot("11-resized")
        m = L()["map"]
        check(m["w"] < before["w"] and m["h"] < before["h"], f"corner pull shrank map {before['w']}x{before['h']} -> {m['w']}x{m['h']}")

        # ---- throw the radar hard to the right
        b = box("radar")
        sx, sy = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
        page.mouse.move(sx, sy)
        page.mouse.down()
        for i in range(1, 7):
            page.mouse.move(sx + i * 45, sy - i * 12)
            page.wait_for_timeout(12)
        page.mouse.up()
        page.wait_for_timeout(160)
        shot("08-throw-glide")
        page.wait_for_timeout(1500)
        r = L()["radar"]
        check(0 <= r["x"] <= 24 - r["w"] and 0 <= r["y"] <= 12 - r["h"], f"thrown radar docked in bounds ({r})")

        # ---- pull the trace's east edge way past its minimum
        b = box("trace")
        ex, ey = b["x"] + b["width"], b["y"] + b["height"] / 2
        page.mouse.move(ex - 1, ey)
        page.mouse.down()
        page.mouse.move(ex - 900, ey, steps=10)
        page.mouse.up()
        page.wait_for_timeout(900)
        t = L()["trace"]
        mn = page.evaluate("() => HD.layout.min('trace')")
        check(t["w"] == mn[0], f"edge pull stops at the minimum width ({t['w']} == {mn[0]})")

        # ---- keyboard: click the alerts panel, then arrows / shift+arrows
        b = box("alerts")
        page.mouse.click(b["x"] + b["width"] / 2, b["y"] + 8)
        page.wait_for_timeout(1200)
        a0 = L()["alerts"]
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Shift+ArrowRight")
        page.wait_for_timeout(700)
        a1 = L()["alerts"]
        check(a1["x"] == min(a0["x"] + 1, 24 - a1["w"]) and a1["w"] == a0["w"] + 1, f"arrows nudge + shift resizes ({a0} -> {a1})")

        # ---- frame rate while a panel is dragged around continuously
        b = box("sysmon")
        sx, sy = b["x"] + b["width"] / 2, b["y"] + 8
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.evaluate("() => { window.__f = {n: 0, t0: performance.now()}; const f = () => { window.__f.n++; if (!window.__f.stop) requestAnimationFrame(f); }; requestAnimationFrame(f); }")
        t0 = time.monotonic()
        i = 0
        while time.monotonic() - t0 < 2.0:
            i += 1
            page.mouse.move(sx + 260 * __import__("math").sin(i / 9), sy - 160 + 120 * __import__("math").cos(i / 7))
            page.wait_for_timeout(8)
            if i == 40:
                shot("12-drag-swing")
        fps = page.evaluate("() => { window.__f.stop = true; return window.__f.n / ((performance.now() - window.__f.t0) / 1000); }")
        page.mouse.up()
        page.wait_for_timeout(1300)
        print(f"  fps during continuous drag: {fps:.1f} (headless, software raster)")

        # ---- lock, reload, still there
        saved = L()
        page.keyboard.press("l")
        page.wait_for_timeout(250)
        shot("13-lock-ripple")
        page.wait_for_timeout(900)
        check(not page.evaluate("() => HD.layout.editing"), "L locks")
        stored = page.evaluate("() => JSON.parse(localStorage.getItem('fedlight.layout.v1') || 'null')")
        check(bool(stored) and all(stored["panels"][k][f] == saved[k][f] for k in saved for f in "xywh"), "arrangement saved to localStorage")
        page.reload(wait_until="load")
        page.wait_for_timeout(2500)
        check(page.evaluate("() => document.documentElement.classList.contains('has-custom-layout')"), "custom layout restored on reload")
        # the countdown should sit exactly where the model says
        geo = page.evaluate(
            """() => { const g = document.getElementById('grid'); const r = g.getBoundingClientRect();
                 const c = document.querySelector('[data-panel="countdown"]').getBoundingClientRect();
                 const gap = 6, px = (g.clientWidth + gap) / 24, py = (g.clientHeight + gap) / 12;
                 const l = HD.layout.get().countdown;
                 return [c.left - r.left - l.x * px, c.top - r.top - l.y * py, c.width - (l.w * px - gap), c.height - (l.h * py - gap)]; }"""
        )
        check(all(abs(v) < 1.5 for v in geo), f"restored panel geometry matches the model (err {[round(v, 2) for v in geo]})")
        shot("14-reloaded")

        # ---- reset + lock hands the grid back to CSS
        page.click("#btn-layout")
        page.wait_for_timeout(900)
        page.click("#lay-reset")
        page.wait_for_timeout(200)
        shot("15-reset-flight")
        page.wait_for_timeout(1500)
        same = page.evaluate("() => { const l = HD.layout.get(), d = HD.layout.defaults(); return Object.keys(d).every(k => ['x','y','w','h'].every(f => l[k][f] === d[k][f])); }")
        check(same, "RESET restores the stock arrangement")
        page.click("#lay-lock")
        page.wait_for_timeout(1400)
        check(not page.evaluate("() => document.documentElement.classList.contains('has-custom-layout')"), "stock arrangement returns to the CSS grid")
        check(page.evaluate("() => localStorage.getItem('fedlight.layout.v1') === null"), "stock arrangement clears storage")
        shot("16-stock")

        # ---- throws cut short: synthetic PointerEvents (headless frames are too slow for a real
        # mouse flick to cross the throw threshold) through the page's own listeners
        THROW = """([pid, dx, dy]) => {
          const p = document.querySelector(`[data-panel=${pid}]`);
          const b = p.getBoundingClientRect();
          const sx = b.left + b.width / 2, sy = b.top + 10;
          const opt = (x, y, t) => ({ bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true,
            button: t === 'pointermove' ? -1 : 0, buttons: t === 'pointerup' ? 0 : 1, clientX: x, clientY: y });
          const wait = (ms) => { const t = performance.now() + ms; while (performance.now() < t) {} };
          p.dispatchEvent(new PointerEvent('pointerdown', opt(sx, sy, 'pointerdown')));
          let x = sx, y = sy;
          for (let i = 1; i <= 6; i++) { wait(12); x = sx + i * dx; y = sy + i * dy; window.dispatchEvent(new PointerEvent('pointermove', opt(x, y, 'pointermove'))); }
          wait(8);
          window.dispatchEvent(new PointerEvent('pointerup', opt(x, y, 'pointerup')));
          return document.getElementById('grid').classList.contains('is-dragging');
        }"""
        STUCK = """() => ({ drag: document.getElementById('grid').classList.contains('is-dragging'),
          costume: document.querySelectorAll('.panel.is-grabbed, .panel.is-overlap').length,
          dim: [...document.querySelectorAll('.panel[data-panel]')].filter(p => +getComputedStyle(p).opacity < 0.99).length,
          title: document.querySelector('[data-panel=radar] .panel-title').textContent })"""
        for name, act in (("LOCK", lambda: page.keyboard.press("l")), ("an arrow key", lambda: page.keyboard.press("ArrowLeft")), ("RESET", lambda: page.click("#lay-reset"))):
            if not page.evaluate("() => HD.layout.editing"):
                page.keyboard.press("l")
                page.wait_for_timeout(1000)
            flying = page.evaluate(THROW, ["radar", 45, -12])
            act()
            page.wait_for_timeout(1700)
            st = page.evaluate(STUCK)
            check(flying and not st["drag"] and not st["costume"] and not st["dim"] and st["title"] == "Orbital Sweep",
                  f"a throw interrupted by {name} leaves nothing stuck ({st})")
        # catching a card in flight grabs it where it is drawn
        if not page.evaluate("() => HD.layout.editing"):
            page.keyboard.press("l")
            page.wait_for_timeout(1000)
        page.evaluate(THROW, ["radar", 45, -12])
        page.wait_for_timeout(250)
        caught = page.evaluate("""() => {
          const p = document.querySelector('[data-panel=radar]'); const r = p.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const o = { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: cx, clientY: cy };
          p.dispatchEvent(new PointerEvent('pointerdown', o));
          return [cx, cy];
        }""")
        page.wait_for_timeout(400)
        held = page.evaluate("""([cx, cy]) => { const r = document.querySelector('[data-panel=radar]').getBoundingClientRect();
          window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, clientX: cx, clientY: cy, bubbles: true }));
          return r.left - 30 <= cx && cx <= r.right + 30 && r.top - 30 <= cy && cy <= r.bottom + 30; }""", caught)
        check(held, "a card caught in flight stays under the pointer")
        page.wait_for_timeout(1400)
        page.keyboard.press("l")
        page.wait_for_timeout(1200)
        errs = page.evaluate("() => HD.errors")

        # ---- small screens: no layout mode
        small = browser.new_page(viewport={"width": 1100, "height": 800})
        small.on("console", lambda m: logs.append((m.type, m.text)))
        small.on("pageerror", lambda e: logs.append(("pageerror", str(e))))
        small.goto(url, wait_until="load")
        small.wait_for_timeout(1500)
        small.keyboard.press("l")
        small.wait_for_timeout(300)
        check(not small.evaluate("() => HD.layout.editing"), "no layout mode on a 1100px screen")
        check(not small.locator("#btn-layout").is_visible(), "LAYOUT button hidden on a 1100px screen")
        errs += small.evaluate("() => HD.errors")
        browser.close()

    bad = [t for k, t in logs if k in ("error", "pageerror")] + [e for e in errs]
    for b in bad:
        print("  error: " + b[:600])
    check(not bad, "zero console errors")
    print(f"frames: {OUT}")
    if fails:
        print(f"FAILED: {len(fails)}")
        sys.exit(1)
    print("all layout checks passed")


if __name__ == "__main__":
    main()
