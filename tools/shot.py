#!/usr/bin/env python3
"""Real-time headless screenshots + console capture for the FEDLIGHT console (Playwright + installed Chrome).

  python tools/shot.py                                        # full dashboard, 1920x1080, after 5s
  python tools/shot.py --q "solo=map&w=640&h=420"             # one panel at a given size
  python tools/shot.py --q "solo=enhance" --wait 3000 --shots 4 --every 2500
                                                              # a filmstrip: 4 frames 2.5s apart
  python tools/shot.py --press "e@1500,t@4000"                # press keys at times (ms after load)
  python tools/shot.py --eval "HD.mission.add(-200000)"       # run JS right after load
  python tools/shot.py --size 390x844                         # phone width (full-page capture)

Prints console errors/warnings, page errors, the [HD] runtime error log and the measured frame
rate. Exit code 1 if any error was captured. Each run launches its own browser, so runs may be
parallel. Screenshots land in .shots/ unless --out is given.
"""
import argparse
import pathlib
import re
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", default="dev.html", help="page relative to repo root (dev.html links src/)")
    ap.add_argument("--q", default="", help="query string without '?', e.g. 'solo=map&w=600&h=400'")
    ap.add_argument("--size", default="1920x1080", help="viewport WxH")
    ap.add_argument("--scale", type=float, default=1, help="device scale factor")
    ap.add_argument("--wait", type=int, default=5000, help="ms of real time before the first capture")
    ap.add_argument("--shots", type=int, default=1, help="number of captures")
    ap.add_argument("--every", type=int, default=2000, help="ms between captures when --shots > 1")
    ap.add_argument("--press", default="", help="comma list of key@ms, e.g. 'e@1500,t@4000'")
    ap.add_argument("--eval", default="", help="JS expression evaluated right after load")
    ap.add_argument("--hover", default="", help="x,y to park the mouse at after load")
    ap.add_argument("--full", action="store_true", help="capture the full scrollable page")
    ap.add_argument("--out", default="", help="png path (default .shots/<slug>.png); frames get -1, -2 ...")
    a = ap.parse_args()

    w, h = (int(v) for v in a.size.lower().split("x"))
    url = (ROOT / a.page).resolve().as_uri() + (("?" + a.q) if a.q else "")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", f"{pathlib.Path(a.page).stem}-{a.q}-{a.size}").strip("-")
    out = pathlib.Path(a.out) if a.out else ROOT / ".shots" / f"{slug}.png"
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)

    presses = []
    for item in filter(None, (s.strip() for s in a.press.split(","))):
        key, _, at = item.partition("@")
        presses.append((int(at or 0), key))
    presses.sort()

    logs = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=["--mute-audio"])
        page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=a.scale)
        page.on("console", lambda m: logs.append((m.type, m.text)))
        page.on("pageerror", lambda e: logs.append(("pageerror", str(e))))
        page.goto(url, wait_until="load")
        t0 = time.monotonic()
        page.evaluate(
            "() => { window.__fps = {n: 0, t0: performance.now()};"
            " const f = () => { window.__fps.n++; requestAnimationFrame(f); }; requestAnimationFrame(f); }"
        )
        if a.eval:
            page.evaluate(f"() => {{ {a.eval} }}")
        if a.hover:
            hx, hy = (float(v) for v in a.hover.split(","))
            page.mouse.move(hx, hy, steps=8)

        def wait_until(ms):
            while True:
                elapsed = (time.monotonic() - t0) * 1000
                while presses and presses[0][0] <= elapsed:
                    _, key = presses.pop(0)
                    page.keyboard.press(key)
                if elapsed >= ms:
                    return
                page.wait_for_timeout(min(100, ms - elapsed))

        paths = []
        for i in range(a.shots):
            wait_until(a.wait + i * a.every)
            path = out if a.shots == 1 else out.with_name(f"{out.stem}-{i + 1}{out.suffix}")
            page.screenshot(path=str(path), full_page=a.full or w < 760)
            paths.append(path)

        stats = page.evaluate(
            "() => ({fps: window.__fps.n / ((performance.now() - window.__fps.t0) / 1000),"
            " errs: (window.HD && HD.errors) || [], phase: document.documentElement.dataset.phase || ''})"
        )
        browser.close()

    bad = []
    for kind, text in logs:
        if kind in ("error", "pageerror", "warning"):
            print(f"console.{kind}: {text[:800]}")
            if kind != "warning":
                bad.append(text)
    for e in stats["errs"]:
        if e not in bad:
            print(f"HD.errors: {e[:800]}")
            bad.append(e)
    print(f"url: {url}")
    for path in paths:
        print(f"screenshot: {path}")
    print(f"fps: {stats['fps']:.1f} (headless, software raster) - phase: {stats['phase']}")
    if bad:
        print(f"ERRORS: {len(bad)}")
        sys.exit(1)
    print("errors: 0")


if __name__ == "__main__":
    main()
