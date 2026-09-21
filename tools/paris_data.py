#!/usr/bin/env python3
"""Build src/js/data/paris.js: a compact real-Paris dataset for the FEDLIGHT map.

  python tools/paris_data.py            # fetch (cached in tools/.cache/), build, write, print stats
  python tools/paris_data.py --fetch    # only fetch / refresh the raw Overpass JSON
  python tools/paris_data.py --refetch  # ignore the cache

Data (c) OpenStreetMap contributors, ODbL. Raw Overpass responses are cached so reruns never
refetch. Everything is projected to a local equirectangular grid in metres (see to_xy) and
quantised to 1 m, then every coordinate stream is delta + zigzag varint coded as base64.
"""
import base64
import hashlib
import json
import math
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import linemerge, polygonize, polylabel, unary_union
from shapely.validation import make_valid

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
OUT = ROOT / "src" / "js" / "data" / "paris.js"

S, W, N, E = 48.8150, 2.2240, 48.9030, 2.4700
BBOX = f"{S},{W},{N},{E}"
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
UA = "fed-hackerdash/1.0 (dashboard demo build)"

ROAD_RE = "^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)(_link)?$"
# the road query is split into 3x2 tiles: one bbox-wide query is too heavy for the public servers
ROAD_TILES = []
for _j in range(2):
    for _i in range(3):
        _s = S + (N - S) * _j / 2
        _w = W + (E - W) * _i / 3
        ROAD_TILES.append(f"{_s:.4f},{_w:.4f},{_s + (N - S) / 2:.4f},{_w + (E - W) / 3:.4f}")

QUERIES = {
    **{
        f"roads{k}": f"""
[out:json][timeout:300][maxsize:536870912];
way["highway"~"{ROAD_RE}"]({tile});
out body qt;
>;
out skel qt;
"""
        for k, tile in enumerate(ROAD_TILES)
    },
    "admin": f"""
[out:json][timeout:180];
(
  rel["boundary"="administrative"]["admin_level"="8"]["name"="Paris"]({BBOX});
  rel["boundary"="administrative"]["admin_level"="9"]({BBOX});
);
out geom;
""",
    "water": f"""
[out:json][timeout:180];
(
  way["natural"="water"]({BBOX});
  rel["natural"="water"]({BBOX});
  way["waterway"="riverbank"]({BBOX});
  rel["waterway"="riverbank"]({BBOX});
  way["landuse"="basin"]({BBOX});
);
out geom;
""",
    "green": f"""
[out:json][timeout:180];
(
  way["leisure"~"^(park|garden|nature_reserve)$"]({BBOX});
  rel["leisure"~"^(park|garden|nature_reserve)$"]({BBOX});
  way["landuse"~"^(forest|cemetery|recreation_ground)$"]({BBOX});
  rel["landuse"~"^(forest|cemetery|recreation_ground)$"]({BBOX});
  way["natural"="wood"]({BBOX});
  rel["natural"="wood"]({BBOX});
  way["amenity"="grave_yard"]({BBOX});
  rel["amenity"="grave_yard"]({BBOX});
);
out geom;
""",
    "canals": f"""
[out:json][timeout:60];
way["waterway"="canal"]({BBOX});
out geom;
""",
    "rail": f"""
[out:json][timeout:180];
(
  way["railway"="rail"]({BBOX});
  way["railway"~"^(disused|abandoned|preserved)$"]({BBOX});
);
out geom;
""",
}


# label, kind, reference lat/lon (checked by hand), OSM names to refine it with (first match wins)
LANDMARKS = [
    ("TOUR EIFFEL", "monument", 48.85826, 2.29450, ["Tour Eiffel"]),
    ("ARC DE TRIOMPHE", "monument", 48.87380, 2.29504, ["Arc de Triomphe de l'Étoile", "Arc de Triomphe"]),
    ("LOUVRE", "museum", 48.86104, 2.33579, ["Pyramide du Louvre", "Grande Pyramide", "Pyramide"]),
    ("NOTRE-DAME", "monument", 48.85296, 2.34990, ["Cathédrale Notre-Dame de Paris", "Notre-Dame de Paris"]),
    ("SACRÉ-CŒUR", "monument", 48.88671, 2.34310, ["Basilique du Sacré-Cœur de Montmartre", "Basilique du Sacré-Cœur", "Sacré-Cœur"]),
    ("PANTHÉON", "monument", 48.84622, 2.34611, ["Panthéon"]),
    ("OPÉRA GARNIER", "venue", 48.87196, 2.33162, ["Palais Garnier", "Opéra Garnier", "Opéra national de Paris - Palais Garnier"]),
    ("PLACE DE LA CONCORDE", "square", 48.86559, 2.32125, ["Obélisque de Louxor", "Place de la Concorde"]),
    ("LES INVALIDES", "monument", 48.85502, 2.31259, ["Dôme des Invalides", "Église du Dôme", "Hôtel des Invalides"]),
    ("GRAND PALAIS", "museum", 48.86612, 2.31245, ["Grand Palais", "Grand Palais des Champs-Élysées"]),
    ("CENTRE POMPIDOU", "museum", 48.86064, 2.35222, ["Centre Pompidou", "Centre Georges Pompidou", "Centre national d'art et de culture Georges-Pompidou"]),
    ("PLACE DE LA BASTILLE", "square", 48.85321, 2.36915, ["Colonne de Juillet", "Place de la Bastille"]),
    ("PLACE DE LA RÉPUBLIQUE", "square", 48.86742, 2.36364, ["Monument à la République", "Place de la République"]),
    ("GARE DU NORD", "station", 48.88088, 2.35527, ["Gare du Nord", "Paris Nord", "Paris-Nord"]),
    ("GARE DE L'EST", "station", 48.87666, 2.35925, ["Gare de l'Est", "Paris Est", "Paris-Est"]),
    ("GARE SAINT-LAZARE", "station", 48.87634, 2.32522, ["Gare Saint-Lazare", "Paris Saint-Lazare", "Paris-Saint-Lazare"]),
    ("GARE DE LYON", "station", 48.84430, 2.37437, ["Gare de Lyon", "Paris Gare de Lyon", "Paris-Gare-de-Lyon"]),
    ("GARE D'AUSTERLITZ", "station", 48.84237, 2.36514, ["Gare d'Austerlitz", "Paris Austerlitz", "Paris-Austerlitz"]),
    ("GARE MONTPARNASSE", "station", 48.84119, 2.32072, ["Gare Montparnasse", "Paris Montparnasse", "Paris-Montparnasse"]),
    ("TOUR MONTPARNASSE", "monument", 48.84211, 2.32197, ["Tour Montparnasse", "Tour Maine-Montparnasse"]),
    ("MOULIN ROUGE", "venue", 48.88410, 2.33224, ["Moulin Rouge"]),
    ("MUSÉE D'ORSAY", "museum", 48.85996, 2.32656, ["Musée d'Orsay"]),
    ("TROCADÉRO", "square", 48.86291, 2.28749, ["Place du Trocadéro-et-du-11-Novembre", "Place du Trocadéro"]),
    ("PHILHARMONIE", "venue", 48.89188, 2.39381, ["Philharmonie de Paris", "Philharmonie 1", "Philharmonie"]),
    ("BIBLIOTHÈQUE F. MITTERRAND", "venue", 48.83363, 2.37581, ["Bibliothèque nationale de France - Site François-Mitterrand", "Bibliothèque François-Mitterrand", "Bibliothèque nationale de France"]),
    ("BERCY", "venue", 48.83864, 2.37860, ["Accor Arena", "Palais omnisports de Paris-Bercy", "Bercy Arena"]),
    ("PARC DES PRINCES", "venue", 48.84144, 2.25303, ["Parc des Princes"]),
    ("LA VILLETTE", "venue", 48.89380, 2.39070, ["Parc de la Villette"]),
]


def _lm_regex():
    names = sorted({n for lm in LANDMARKS for n in lm[4]})
    # apostrophes may be ASCII or typographic in OSM, so match either with '.'
    return "|".join(n.replace("'", ".").replace("-", ".") for n in names)


QUERIES["landmarks"] = f"""
[out:json][timeout:180];
nwr["name"~"^({_lm_regex()})$"]({BBOX});
out center tags;
"""


def fetch(name, refetch=False):
    q = QUERIES[name]
    key = hashlib.sha1(q.encode()).hexdigest()[:10]
    path = CACHE / f"{name}-{key}.json"
    if path.exists() and not refetch:
        return json.loads(path.read_text(encoding="utf-8"))
    CACHE.mkdir(parents=True, exist_ok=True)
    body = urllib.parse.urlencode({"data": q}).encode()
    delay = 10
    last = None
    for attempt in range(10):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            t0 = time.time()
            print(f"  fetch {name} <- {url} (try {attempt + 1})", flush=True)
            req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=400) as r:
                raw = r.read()
            data = json.loads(raw)
            if "remark" in data and ("error" in data["remark"].lower() or not data.get("elements")):
                raise RuntimeError("overpass remark: " + data["remark"][:300])
            path.write_bytes(raw)
            print(f"  fetch {name}: {len(raw) / 1e6:.1f} MB, {len(data['elements'])} elements, {time.time() - t0:.0f}s")
            time.sleep(2)  # be polite between queries
            return data
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError, json.JSONDecodeError) as err:
            last = err
            print(f"  fetch {name} failed: {err}; retrying in {delay}s", flush=True)
            time.sleep(delay)
            delay = min(120, delay * 2)
    sys.exit(f"fetch {name}: giving up ({last})")


# ---------------------------------------------------------------- projection

# Local equirectangular: 1 unit = 1 m, north up, y grows south, origin at the bbox NW corner.
R_EARTH = 6371008.8
LAT0, LON0 = 48.8566, 2.3522
KY = R_EARTH * math.pi / 180
KX = KY * math.cos(math.radians(LAT0))
OX = (LON0 - W) * KX
OY = (N - LAT0) * KY
WORLD_W = (E - W) * KX
WORLD_H = (N - S) * KY


def to_xy(lat, lon):
    return (lon - LON0) * KX + OX, (LAT0 - lat) * KY + OY


def to_xy_np(lat, lon):
    return (lon - LON0) * KX + OX, (LAT0 - lat) * KY + OY


# ------------------------------------------------------------------ helpers

def norm_name(s):
    if not s:
        return ""
    s = s.replace("’", "'").replace("ʼ", "'").replace(" ", " ")
    s = " ".join(s.split()).upper()
    # the two carriageways are "... INTÉRIEUR" / "... EXTÉRIEUR"; the HUD wants one name
    if s.startswith("BOULEVARD PÉRIPHÉRIQUE"):
        s = "BOULEVARD PÉRIPHÉRIQUE"
    return s.replace("|", "/")


def yes(v):
    return v is not None and v not in ("no", "false", "0")


def hilbert(x, y, n=32768):
    x = max(0, min(n - 1, int(x)))
    y = max(0, min(n - 1, int(y)))
    d = 0
    s = n // 2
    while s > 0:
        rx = 1 if x & s else 0
        ry = 1 if y & s else 0
        d += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                x = n - 1 - x
                y = n - 1 - y
            x, y = y, x
        s //= 2
    return d


class Stream:
    """zigzag varint byte stream with a running 'pen' for delta-coded integer points"""

    def __init__(self):
        self.b = bytearray()
        self.px = 0
        self.py = 0

    def u(self, v):
        v = int(v)
        assert v >= 0, v
        while v >= 0x80:
            self.b.append((v & 0x7F) | 0x80)
            v >>= 7
        self.b.append(v)

    def s(self, v):
        v = int(v)
        self.u(v * 2 if v >= 0 else -v * 2 - 1)

    def pt(self, x, y):
        self.s(x - self.px)
        self.s(y - self.py)
        self.px, self.py = x, y

    def b64(self):
        return base64.b64encode(bytes(self.b)).decode("ascii")


def qpts(coords, closed=False):
    """quantise to 1 m and drop repeats (and the closing point of a ring)"""
    out = []
    for x, y in coords:
        p = (int(round(x)), int(round(y)))
        if not out or out[-1] != p:
            out.append(p)
    if closed and len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def district_labels():
    src = (ROOT / "src" / "js" / "core.js").read_text(encoding="utf-8")
    m = re.search(r"districts:\s*\[(.*?)\]", src, re.S)
    labels = re.findall(r"'([^']*)'", m.group(1))
    assert len(labels) == 20, labels
    return labels


# ----------------------------------------------------------------- geometry

def lines_to_polys(lines):
    """closed rings / chains of ways -> list of valid polygons"""
    geoms = [LineString(c) for c in lines if len(c) >= 2]
    if not geoms:
        return []
    polys = list(polygonize(unary_union(geoms)))
    return [p if p.is_valid else make_valid(p) for p in polys]


def element_polygon(el):
    """an Overpass 'out geom' way or multipolygon relation -> (Multi)Polygon in metres, or None"""
    if el["type"] == "way":
        g = el.get("geometry") or []
        c = [to_xy(p["lat"], p["lon"]) for p in g if p]
        if len(c) < 4 or c[0] != c[-1]:
            return None
        p = Polygon(c)
        return p if p.is_valid else make_valid(p)
    outer, inner = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or not m.get("geometry"):
            continue
        c = [to_xy(p["lat"], p["lon"]) for p in m["geometry"] if p]
        (inner if m.get("role") == "inner" else outer).append(c)
    op = lines_to_polys(outer)
    if not op:
        return None
    # union of the outer faces minus the union of the inner faces (islands become holes)
    shape = unary_union(op)
    ip = lines_to_polys(inner)
    if ip:
        shape = shape.difference(unary_union(ip))
    return shape


def polys_of(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if g.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [p for p in g.geoms if p.geom_type == "Polygon" and not p.is_empty]
    return []


def lines_of(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [g]
    if g.geom_type in ("MultiLineString", "GeometryCollection"):
        return [x for x in g.geoms if x.geom_type == "LineString" and not x.is_empty]
    return []


def poly_rings(p, tol):
    p = orient(p.simplify(tol, preserve_topology=True), 1.0)
    rings = []
    for ring in [p.exterior] + list(p.interiors):
        q = qpts(ring.coords, closed=True)
        if len(q) >= 3:
            rings.append(q)
        elif not rings:
            return []
    return rings


def put_rings(st, rings):
    st.u(len(rings))
    for r in rings:
        st.u(len(r))
        for x, y in r:
            st.pt(x, y)


def put_line(st, pts):
    st.u(len(pts))
    for x, y in pts:
        st.pt(x, y)


# -------------------------------------------------------------------- build

ROAD_CLASS = {
    "motorway": 0, "motorway_link": 0, "trunk": 0, "trunk_link": 0,
    "primary": 1, "primary_link": 1,
    "secondary": 2, "secondary_link": 2,
}


def build_roads(tiles, mask, bbox_poly):
    nodes = {}
    ways = {}
    for d in tiles:
        for el in d["elements"]:
            if el["type"] == "node":
                nodes[el["id"]] = (el["lat"], el["lon"])
            elif el["type"] == "way":
                ways[el["id"]] = el
    ids = np.fromiter(nodes.keys(), dtype=np.int64, count=len(nodes))
    ll = np.array([nodes[i] for i in ids.tolist()], dtype=np.float64)
    xs, ys = to_xy_np(ll[:, 0], ll[:, 1])
    inside = shapely.contains_xy(mask, xs, ys)
    idx = {nid: k for k, nid in enumerate(ids.tolist())}

    runs = []  # (node ids, cls, name, flags)
    context = {0: [], 1: []}
    for wid in sorted(ways):
        el = ways[wid]
        t = el.get("tags", {})
        if t.get("area") == "yes":
            continue
        hw = t.get("highway", "")
        cls = ROAD_CLASS.get(hw, 3)
        nd = [n for n in el["nodes"] if n in idx]
        if len(nd) < 2:
            continue
        ow = t.get("oneway")
        oneway = ow in ("yes", "1", "true", "-1") or t.get("junction") in ("roundabout", "circular") or (
            hw in ("motorway", "motorway_link") and ow != "no"
        )
        if ow == "-1":
            nd = nd[::-1]  # so that a -> b is always the legal direction
        flags = (1 if yes(t.get("bridge")) else 0) | (2 if yes(t.get("tunnel")) else 0) | (4 if oneway else 0)
        name = norm_name(t.get("name")) or norm_name(t.get("ref"))
        cur = [nd[0]]
        ctx = []
        for a, b in zip(nd, nd[1:]):
            if inside[idx[a]] and inside[idx[b]]:
                if ctx:
                    if cls <= 1:
                        context[cls].append(ctx)
                    ctx = []
                if not cur:
                    cur = [a]
                cur.append(b)
            else:
                if len(cur) >= 2:
                    runs.append((cur, cls, name, flags))
                cur = []
                if not ctx:
                    ctx = [a]
                ctx.append(b)
        if len(cur) >= 2:
            runs.append((cur, cls, name, flags))
        if ctx and cls <= 1:
            context[cls].append(ctx)

    # topology: vertices are nodes used twice or more, plus run endpoints
    use = {}
    for nd, *_ in runs:
        for n in nd:
            use[n] = use.get(n, 0) + 1
    vset = {n for n, c in use.items() if c >= 2}
    for nd, *_ in runs:
        vset.add(nd[0])
        vset.add(nd[-1])

    def P(n):
        k = idx[n]
        return float(xs[k]), float(ys[k])

    edges = []  # dict(a, b, pts (float, intermediate), cls, name, flags, run)
    dropped_loops = 0
    for ri, (nd, cls, name, flags) in enumerate(runs):
        start = 0
        for i in range(1, len(nd)):
            if nd[i] in vset:
                seg = nd[start : i + 1]
                start = i
                coords = [P(n) for n in seg]
                if len(coords) > 2:
                    coords = list(LineString(coords).simplify(1.5, preserve_topology=False).coords)
                a, b = seg[0], seg[-1]
                mid = coords[1:-1]
                if a == b and len(mid) < 2:
                    dropped_loops += 1
                    continue
                edges.append({"a": a, "b": b, "mid": mid, "cls": cls, "name": name, "flags": flags, "run": ri,
                              "len": LineString(coords).length})

    # largest connected component
    parent = {}

    def find(x):
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    for e in edges:
        ra, rb = find(e["a"]), find(e["b"])
        if ra != rb:
            parent[ra] = rb
    comp = {}
    for e in edges:
        r = find(e["a"])
        comp.setdefault(r, [0, 0.0, set()])
        comp[r][0] += 1
        comp[r][1] += e["len"]
        comp[r][2].update((e["a"], e["b"]))
    best = max(comp, key=lambda r: comp[r][0])
    kept = [e for e in edges if find(e["a"]) == best]
    drop = {
        "components": len(comp) - 1,
        "edges": len(edges) - len(kept),
        "vertices": sum(len(v[2]) for r, v in comp.items() if r != best),
        "km": sum(v[1] for r, v in comp.items() if r != best) / 1000,
        "loops": dropped_loops,
    }

    # distinct OSM nodes that land on the same 1 m cell and are joined by a straight edge would give a
    # zero-length edge after quantisation: contract them into one vertex
    def qv(n):
        x, y = P(n)
        return int(round(x)), int(round(y))

    merged = {}

    def mfind(n):
        while n in merged:
            n = merged[n]
        return n

    for e in kept:
        if e["a"] != e["b"] and qv(e["a"]) == qv(e["b"]) and not [p for p in qpts(e["mid"]) if p != qv(e["a"])]:
            ra, rb = mfind(e["a"]), mfind(e["b"])
            if ra != rb:
                merged[rb] = ra
    if merged:
        for e in kept:
            e["a"], e["b"] = mfind(e["a"]), mfind(e["b"])
        kept = [e for e in kept if e["a"] != e["b"] or len(qpts(e["mid"])) >= 2]
    drop["contracted"] = len(merged)

    # order: runs along a Hilbert curve so consecutive edges (and new vertices) sit close together
    run_key = {}
    for e in kept:
        if e["run"] not in run_key:
            x, y = P(e["a"])
            run_key[e["run"]] = hilbert(x, y)
    kept.sort(key=lambda e: (run_key[e["run"]], e["run"]))  # stable: keeps edge order inside a run

    names = [""]
    name_ix = {"": 0}
    vid = {}
    st = Stream()
    st.u(len(kept))
    prev_b = 0
    prev_name = 0
    vq = []
    npts = 0
    for e in kept:
        if e["name"] not in name_ix:
            name_ix[e["name"]] = len(names)
            names.append(e["name"])
        a_new = e["a"] not in vid
        if a_new:
            vid[e["a"]] = len(vid)
            st.u(1)
        else:
            a = vid[e["a"]]
            st.u(0 if a == prev_b else 2 + (2 * (a - prev_b) if a >= prev_b else -2 * (a - prev_b) - 1))
        a = vid[e["a"]]
        b_new = e["b"] not in vid
        if b_new:
            vid[e["b"]] = len(vid)
            st.u(0)
        else:
            b = vid[e["b"]]
            st.u(1 + (2 * (b - a) if b >= a else -2 * (b - a) - 1))
        b = vid[e["b"]]
        mid = qpts(e["mid"])
        ax, ay = (int(round(v)) for v in P(e["a"]))
        bx, by = (int(round(v)) for v in P(e["b"]))
        mid = [p for p in mid if p != (ax, ay) and p != (bx, by)] if e["a"] != e["b"] else mid
        ni = name_ix[e["name"]]
        st.u(e["cls"] | (e["flags"] << 2))
        st.s(ni - prev_name)
        st.u(len(mid))
        # coordinates share the stream: new a, then intermediates, then new b
        if a_new:
            st.pt(ax, ay)
            vq.append((ax, ay))
        else:
            st.px, st.py = vq[a]
        for x, y in mid:
            st.pt(x, y)
        if b_new:
            st.pt(bx, by)
            vq.append((bx, by))
        else:
            st.px, st.py = vq[b]
        npts += len(mid)
        prev_b = b
        prev_name = ni
        e["gn"] = len(mid)

    # context: primary+ outside the mask, clipped to the bbox
    ctx_st = Stream()
    ctx_lines = []
    for cls in (0, 1):
        ls = [LineString([P(n) for n in c]) for c in context[cls]]
        if not ls:
            continue
        merged = linemerge(unary_union(ls))
        for g in lines_of(merged.intersection(bbox_poly)):
            q = qpts(g.simplify(1.5, preserve_topology=False).coords)
            if len(q) >= 2:
                ctx_lines.append((cls, q))
    ctx_st.u(len(ctx_lines))
    for cls, q in ctx_lines:
        ctx_st.u(cls)
        put_line(ctx_st, q)

    stats = {
        "vertices": len(vid),
        "edges": len(kept),
        "geom_pts": npts,
        "km": sum(e["len"] for e in kept) / 1000,
        "names": len(names),
        "by_class_km": [round(sum(e["len"] for e in kept if e["cls"] == c) / 1000, 1) for c in range(4)],
        "dropped": drop,
        "context_lines": len(ctx_lines),
        "context_km": sum(LineString(q).length for _, q in ctx_lines) / 1000,
        "osm_ways": len(ways),
        "osm_nodes": len(nodes),
    }
    return st, ctx_st, names, stats


def canal_lines(raw):
    """named, open canal centrelines (Canal Saint-Martin, de l'Ourcq, Saint-Denis, Bassin de la Villette)"""
    out = []
    for el in raw["elements"]:
        t = el.get("tags", {})
        nm = norm_name(t.get("name", ""))
        if not nm or nm == "LA SEINE" or yes(t.get("tunnel")) or not el.get("geometry"):
            continue
        if nm.startswith("SECOND "):
            nm = nm[len("SECOND "):]
        c = [to_xy(q["lat"], q["lon"]) for q in el["geometry"] if q]
        if len(c) >= 2:
            out.append((nm, LineString(c)))
    return out


def build_water(raw, canals, bbox_poly, near):
    seine, others = [], []
    for el in raw["elements"]:
        t = el.get("tags", {})
        if yes(t.get("tunnel")) or yes(t.get("covered")) or t.get("location") in ("underground", "underwater"):
            continue
        if el["type"] == "relation" and t.get("type") not in ("multipolygon", None):
            continue
        g = element_polygon(el)
        if g is None or g.is_empty:
            continue
        g = g.intersection(bbox_poly)
        if g.is_empty:
            continue
        nm = norm_name(t.get("name", ""))
        wt = t.get("water", "")
        if "SEINE" in nm and (wt == "river" or t.get("waterway") == "riverbank" or el["type"] == "relation"):
            seine.append(g)
            continue
        if wt == "river" or t.get("waterway") == "riverbank":
            kind = "river"
        elif "CANAL" in nm or wt in ("canal", "lock"):
            kind = "canal"
        elif "BASSIN" in nm or wt in ("basin", "reservoir") or t.get("landuse") == "basin":
            kind = "basin"
        else:
            kind = "lake"
        # the open stretches of a canal are mapped as separate locks and basins (Écluse du Temple,
        # Bassin des Récollets...) or not named at all: name them after the canal centreline they carry
        if kind in ("canal", "basin", "river") and not nm.startswith("BASSIN DE L"):
            hits = {}
            for cn, line in canals:
                if line.intersects(g):
                    hits[cn] = hits.get(cn, 0) + line.intersection(g).length
            if hits:
                cn = max(hits, key=hits.get)
                if hits[cn] > 10:
                    nm = cn
                    kind = "basin" if cn.startswith("BASSIN") else "canal"
        if kind != "river" and not g.intersects(near):
            continue  # suburban ponds and retention basins add nothing to the map
        others.append((kind, nm, g))
    feats = []
    if seine:
        u = unary_union(seine)
        for p in polys_of(u):
            if p.area > 500:
                feats.append(("river", "LA SEINE", p))
    # dissolve same-named pieces (a canal and its locks become one shape), then drop fountains
    groups = {}
    for kind, nm, g in others:
        key = (kind, nm) if nm else (kind, f"#{id(g)}")
        groups.setdefault(key, []).append(g)
    for (kind, nm), gs in groups.items():
        u = unary_union([g.buffer(0.5) for g in gs]).buffer(-0.5)
        for p in polys_of(u):
            if p.area >= 1500 or (kind == "canal" and nm and p.area >= 300):
                feats.append((kind, "" if nm.startswith("#") else nm, p))
    # anything already covered by the Seine (duplicate riverbank pieces) is dropped
    if seine:
        su = unary_union([f[2] for f in feats if f[1] == "LA SEINE"])
        feats = [f for f in feats if f[1] == "LA SEINE" or f[2].difference(su).area > 0.2 * f[2].area]
    feats.sort(key=lambda f: -f[2].area)
    return feats


def build_green(raw, bbox_poly):
    cands = []
    for el in raw["elements"]:
        t = el.get("tags", {})
        g = element_polygon(el)
        if g is None or g.is_empty:
            continue
        g = g.intersection(bbox_poly)
        if g.is_empty or g.area < 8000:
            continue
        nm = norm_name(t.get("name", ""))
        if t.get("landuse") == "cemetery" or t.get("amenity") == "grave_yard":
            kind = "cemetery"
        elif nm.startswith("BOIS DE ") or t.get("landuse") == "forest" or t.get("natural") == "wood":
            kind = "wood"
        else:
            kind = "park"
        if not nm and g.area < 40000:
            continue
        if t.get("leisure") == "garden" and t.get("access") == "private" and g.area < 20000:
            continue
        cands.append((kind, nm, g))
    cands.sort(key=lambda f: -f[2].area)
    kept = []
    cover = {"park": None, "wood": None, "cemetery": None}
    for kind, nm, g in cands:
        c = cover[kind]
        # nested pieces of the same kind (forest patches inside a Bois, gardens inside a park) add nothing
        if c is not None and g.intersection(c).area > 0.85 * g.area:
            continue
        kept.append((kind, nm, g))
        cover[kind] = g if c is None else c.union(g)
    return kept


def build_admin(raw, labels):
    boundary = None
    arrs = []
    for el in raw["elements"]:
        t = el.get("tags", {})
        if el["type"] != "relation":
            continue
        if t.get("admin_level") == "8" and t.get("name") == "Paris":
            boundary = (el["id"], element_polygon(el))
        elif t.get("admin_level") == "9":
            ref = t.get("ref:INSEE", "")
            m = re.match(r"^751(\d\d)$", ref)
            if not m:
                mm = re.match(r"^Paris (\d+)", t.get("name", ""))
                if not mm:
                    continue
                n = int(mm.group(1))
            else:
                n = int(m.group(1))
            if 1 <= n <= 20:
                arrs.append((n, t.get("name", ""), element_polygon(el)))
    arrs.sort()
    out = []
    for n, osm_name, g in arrs:
        out.append({"n": n, "name": labels[n - 1], "osm": osm_name, "poly": g})
    return boundary, out


def build_rail(raw, bbox_poly):
    lines = []
    ceinture = 0
    for el in raw["elements"]:
        t = el.get("tags", {})
        if el["type"] != "way" or not el.get("geometry"):
            continue
        if yes(t.get("tunnel")) or yes(t.get("covered")) or t.get("location") == "underground":
            continue
        if t.get("service") in ("yard", "siding", "spur", "crossover"):
            continue
        rw = t.get("railway")
        if rw != "rail":
            txt = " ".join(t.get(k, "") for k in ("name", "old_name", "was:name", "description")).lower()
            if "ceinture" not in txt:
                continue
            ceinture += 1
        if t.get("usage") in ("industrial", "military", "test") and rw == "rail":
            continue
        c = [to_xy(p["lat"], p["lon"]) for p in el["geometry"] if p]
        if len(c) >= 2:
            lines.append(LineString(c))
    merged = linemerge(unary_union(lines)).intersection(bbox_poly)
    out = []
    for g in lines_of(merged):
        q = qpts(g.simplify(3, preserve_topology=False).coords)
        if len(q) >= 2 and LineString(q).length > 40:
            out.append(q)
    return out, ceinture


def lm_key(s):
    return re.sub(r"[\s\-'’]+", " ", s.lower()).strip()


LM_BAD = {
    "public_transport": ("stop_position", "platform"),
    "highway": ("bus_stop", "footway", "steps", "platform", "service"),
    "amenity": ("parking_entrance", "parking", "taxi", "bicycle_rental", "post_office", "atm", "toilets"),
    "railway": ("stop", "rail", "disused", "abandoned", "platform", "train_station_entrance", "subway_entrance"),
    "tourism": ("information",),
    "station": ("subway",),
}


def lm_rank(t, typ, kind):
    """how well an OSM element stands for a landmark (lower is better), None = not the landmark"""
    if any(t.get(k) in v for k, v in LM_BAD.items()):
        return None
    if kind == "station":
        if t.get("building") == "train_station":
            return 0
        if t.get("railway") == "station":
            return 1
        if t.get("public_transport") == "station":
            return 2
        return None
    if t.get("railway") or t.get("public_transport"):
        return None
    tagged = any(t.get(k) for k in ("building", "tourism", "historic", "leisure", "amenity", "man_made", "place"))
    if typ != "node" and (tagged or t.get("highway") == "pedestrian"):
        return 0
    if typ == "node" and tagged:
        return 1
    return None


def build_landmarks(raw):
    found = {}
    for el in raw["elements"]:
        t = el.get("tags", {})
        if el["type"] == "node":
            lat, lon = el["lat"], el["lon"]
        elif "center" in el:
            lat, lon = el["center"]["lat"], el["center"]["lon"]
        else:
            continue
        found.setdefault(lm_key(t.get("name", "")), []).append((lat, lon, el["type"], el["id"], t))
    out = []
    report = []
    for label, kind, rlat, rlon, cands in LANDMARKS:
        rx, ry = to_xy(rlat, rlon)
        best = None
        for ci, c in enumerate(cands):
            for lat, lon, typ, oid, t in found.get(lm_key(c), []):
                rk = lm_rank(t, typ, kind)
                x, y = to_xy(lat, lon)
                d = math.hypot(x - rx, y - ry)
                if rk is None or d > 400:
                    continue
                key = (rk, ci, d)
                if best is None or key < best[0]:
                    best = (key, x, y, f"{typ}/{oid} '{c}'")
        if best:
            (_, _, d), x, y, src = best
            report.append(f"{label:28s} osm {src} ({d:.0f} m from reference)")
        else:
            # e.g. the BnF: OSM has no named footprint; the reference is the centroid of its four towers
            x, y = rx, ry
            report.append(f"{label:28s} reference coordinate (no usable OSM match)")
        out.append({"name": label, "kind": kind, "x": int(round(x)), "y": int(round(y))})
    return out, report


# --------------------------------------------------------------------- emit

JS_DECODER = r"""
  const KX = @KX@, KY = @KY@, OX = @OX@, OY = @OY@, LAT0 = @LAT0@, LON0 = @LON0@;
  let cache = null;

  function reader(s) {
    const bin = atob(s);
    const n = bin.length;
    const u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    let p = 0;
    const r = {
      u() {
        let v = 0, sh = 0, b;
        do { b = u[p++]; v += (b & 127) * 2 ** sh; sh += 7; } while (b & 128);
        return v;
      },
      s() {
        const v = r.u();
        return v % 2 ? -(v + 1) / 2 : v / 2;
      },
      x: 0,
      y: 0,
      // next delta-coded point, written into arr at i
      pt(arr, i) {
        r.x += r.s();
        r.y += r.s();
        arr[i] = r.x;
        arr[i + 1] = r.y;
      },
    };
    return r;
  }

  function lineOf(r) {
    const n = r.u();
    const a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) r.pt(a, i * 2);
    return a;
  }

  function ringsOf(r) {
    const k = r.u();
    const rings = [];
    for (let i = 0; i < k; i++) rings.push(lineOf(r));
    return rings;
  }

  function decode() {
    const t0 = performance.now();
    const names = D.names.split('|');

    // graph: one stream of edge records with new vertices and intermediate points inline
    const g = reader(D.graph);
    const count = g.u();
    const A = new Uint32Array(count), B = new Uint32Array(count);
    const cls = new Uint8Array(count), flags = new Uint8Array(count), name = new Uint16Array(count);
    const len = new Float32Array(count), g0 = new Uint32Array(count), gn = new Uint16Array(count);
    const nodes = new Float32Array(D.nv * 2);
    const geom = new Float32Array(D.ng * 2);
    let nv = 0, ng = 0, prevB = 0, prevName = 0;
    const pt = [0, 0];
    for (let e = 0; e < count; e++) {
      const ac = g.u();
      const aNew = ac === 1;
      const a = aNew ? nv++ : ac === 0 ? prevB : prevB + ((ac - 2) % 2 ? -(ac - 1) / 2 : (ac - 2) / 2);
      const bc = g.u();
      const bNew = bc === 0;
      const b = bNew ? nv++ : a + ((bc - 1) % 2 ? -bc / 2 : (bc - 1) / 2);
      const cf = g.u();
      cls[e] = cf & 3;
      flags[e] = cf >> 2;
      prevName += g.s();
      name[e] = prevName;
      const k = g.u();
      if (aNew) g.pt(nodes, a * 2);
      else { g.x = nodes[a * 2]; g.y = nodes[a * 2 + 1]; }
      let px = g.x, py = g.y, L = 0;
      g0[e] = ng;
      gn[e] = k;
      for (let i = 0; i < k; i++) {
        g.pt(geom, ng * 2);
        ng++;
        L += Math.hypot(g.x - px, g.y - py);
        px = g.x;
        py = g.y;
      }
      if (bNew) g.pt(nodes, b * 2);
      else { g.x = nodes[b * 2]; g.y = nodes[b * 2 + 1]; }
      L += Math.hypot(g.x - px, g.y - py);
      len[e] = L;
      A[e] = a;
      B[e] = b;
      prevB = b;
    }

    const c = reader(D.context);
    const context = [];
    for (let i = 0, n = c.u(); i < n; i++) {
      const k = c.u();
      context.push({ cls: k, pts: lineOf(c) });
    }

    const poly = (s, meta, fn) => {
      const r = reader(s);
      const n = r.u();
      const out = [];
      for (let i = 0; i < n; i++) out.push(fn(meta[i], ringsOf(r)));
      return out;
    };
    const water = poly(D.water, D.waterMeta, (m, rings) => ({ kind: m[0], name: m[1], rings }));
    const parks = poly(D.parks, D.parkMeta, (m, rings) => ({ kind: m[0], name: m[1], rings }));
    const arr = poly(D.arr, D.arrMeta, (m, rings) => ({ n: m[0], name: m[1], label: [m[2], m[3]], rings }));
    const boundary = ringsOf(reader(D.boundary));
    const rr = reader(D.rail);
    const rail = [];
    for (let i = 0, n = rr.u(); i < n; i++) rail.push(lineOf(rr));

    const data = {
      attribution: D.attribution,
      W: D.W,
      H: D.H,
      toXY: (lat, lon) => [(lon - LON0) * KX + OX, (LAT0 - lat) * KY + OY],
      toLatLon: (x, y) => [LAT0 - (y - OY) / KY, LON0 + (x - OX) / KX],
      names,
      nodes,
      edges: { count, a: A, b: B, cls, name, flags, len, g0, gn },
      geom,
      context,
      water,
      parks,
      arr,
      boundary,
      rail,
      landmarks: D.landmarks.map((l) => ({ name: l[0], kind: l[1], x: l[2], y: l[3] })),
      decodeMs: 0,
    };
    data.decodeMs = performance.now() - t0;
    D = null; // the encoded strings are no longer needed
    return data;
  }

  Object.defineProperty(HD.data, 'paris', {
    configurable: true,
    enumerable: true,
    get() {
      if (!cache) cache = decode();
      return cache;
    },
  });
"""


def js_str(s):
    return json.dumps(s, ensure_ascii=False)


def emit(parts):
    lines = [
        "window.HD = window.HD || {}; HD.data = HD.data || {};",
        "/* FEDLIGHT · real-Paris map dataset. GENERATED by tools/paris_data.py — do not edit by hand.",
        "   Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).",
        "   HD.data.paris is a lazy getter: the base64 zigzag-varint streams below decode on first access.",
        "   World: local equirectangular metres, origin at the bbox NW corner, x east, y south. */",
        "(() => {",
        "  'use strict';",
        "  let D = {",
    ]
    for k, v in parts.items():
        lines.append(f"    {k}: {v},")
    lines.append("  };")
    dec = JS_DECODER
    for k, v in {"KX": KX, "KY": KY, "OX": OX, "OY": OY, "LAT0": LAT0, "LON0": LON0}.items():
        dec = dec.replace(f"@{k}@", repr(v))
    lines.append(dec.rstrip("\n"))
    lines.append("})();")
    return "\n".join(lines) + "\n"


def main():
    refetch = "--refetch" in sys.argv
    raw = {name: fetch(name, refetch) for name in QUERIES}
    if "--fetch" in sys.argv:
        return
    t_start = time.time()
    bbox_poly = box(0, 0, WORLD_W, WORLD_H)
    labels = district_labels()

    (bid, bgeom), arrs = build_admin(raw["admin"], labels)
    mask = bgeom.buffer(150).intersection(bbox_poly)
    shapely.prepare(mask)
    roads, ctx, names, rs = build_roads([raw[k] for k in QUERIES if k.startswith("roads")], mask, bbox_poly)

    water = build_water(raw["water"], canal_lines(raw["canals"]), bbox_poly, bgeom.buffer(500))
    green = build_green(raw["green"], bbox_poly)
    rail, ceinture = build_rail(raw["rail"], bbox_poly)
    landmarks, lm_report = build_landmarks(raw["landmarks"])

    def poly_layer(feats, tol, meta_fn):
        st = Stream()
        metas = []
        body = []
        for f in feats:
            for p in polys_of(f["poly"] if isinstance(f, dict) else f[2]):
                rings = poly_rings(p, tol)
                if rings:
                    body.append(rings)
                    metas.append(meta_fn(f))
        st.u(len(body))
        for rings in body:
            put_rings(st, rings)
        return st, metas, body

    wst, wmeta, wbody = poly_layer(water, 2, lambda f: [f[0], f[1]])
    gst, gmeta, gbody = poly_layer(green, 3, lambda f: [f[0], f[1]])
    # the largest piece of each arrondissement only. The label is the pole of inaccessibility of its
    # built-up part: the 12e and 16e would otherwise put their labels in the middle of the Bois.
    woods = unary_union([f[2] for f in green if f[0] == "wood" and f[2].area > 1e6])
    ast = Stream()
    ameta = []
    abody = []
    for a in arrs:
        p = max(polys_of(a["poly"]), key=lambda q: q.area)
        urban = polys_of(p.difference(woods)) if not woods.is_empty else [p]
        lab = polylabel(max(urban, key=lambda q: q.area) if urban else p, tolerance=5)
        a["label"] = (lab.x, lab.y)
        rings = poly_rings(p, 2)
        abody.append(rings)
        ameta.append([a["n"], a["name"], int(round(lab.x)), int(round(lab.y))])
    ast.u(len(abody))
    for rings in abody:
        put_rings(ast, rings)
    bst = Stream()
    brings = []
    for p in polys_of(bgeom.intersection(bbox_poly)):
        brings += poly_rings(p, 2)
    put_rings(bst, brings)
    rst = Stream()
    rst.u(len(rail))
    for q in rail:
        put_line(rst, q)

    parts = {
        "attribution": js_str("© OpenStreetMap contributors · ODbL"),
        "W": str(math.ceil(WORLD_W)),
        "H": str(math.ceil(WORLD_H)),
        "nv": str(rs["vertices"]),
        "ng": str(rs["geom_pts"]),
        "names": js_str("|".join(names)),
        "landmarks": json.dumps([[l["name"], l["kind"], l["x"], l["y"]] for l in landmarks], ensure_ascii=False),
        "waterMeta": json.dumps(wmeta, ensure_ascii=False),
        "parkMeta": json.dumps(gmeta, ensure_ascii=False),
        "arrMeta": json.dumps(ameta, ensure_ascii=False),
        "graph": js_str(roads.b64()),
        "context": js_str(ctx.b64()),
        "water": js_str(wst.b64()),
        "parks": js_str(gst.b64()),
        "arr": js_str(ast.b64()),
        "boundary": js_str(bst.b64()),
        "rail": js_str(rst.b64()),
    }
    text = emit(parts)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8", newline="\n")
    size = len(text.encode("utf-8"))

    print(f"paris boundary: relation {bid}; mask = boundary + 150 m, clipped to bbox")
    print(f"world: {WORLD_W:.1f} x {WORLD_H:.1f} m  (W={math.ceil(WORLD_W)}, H={math.ceil(WORLD_H)})")
    print(f"osm: {rs['osm_ways']} road ways, {rs['osm_nodes']} nodes")
    print(
        f"graph: {rs['vertices']} vertices, {rs['edges']} edges, {rs['geom_pts']} geom pts, {rs['km']:.1f} km, "
        f"{rs['names']} names; km by class {rs['by_class_km']}"
    )
    d = rs["dropped"]
    print(
        f"  dropped outside LCC: {d['components']} components, {d['edges']} edges, {d['vertices']} vertices, "
        f"{d['km']:.2f} km; {d['loops']} degenerate loops; {d['contracted']} zero-length edges contracted"
    )
    print(f"context: {rs['context_lines']} lines, {rs['context_km']:.1f} km")
    print(f"water: {len(wbody)} polygons: " + ", ".join(sorted({m[1] or m[0] for m in wmeta})[:40]))
    seine = [b for b, m in zip(wbody, wmeta) if m[1] == "LA SEINE"]
    print(f"  seine pieces: {len(seine)}, holes: {[len(b) - 1 for b in seine]}")
    print(f"parks: {len(gbody)} polygons ({sum(1 for m in gmeta if m[0] == 'park')} park, "
          f"{sum(1 for m in gmeta if m[0] == 'wood')} wood, {sum(1 for m in gmeta if m[0] == 'cemetery')} cemetery)")
    print(f"arrondissements: {len(abody)}: " + ", ".join(f"{m[0]}={a['osm']}" for m, a in zip(ameta, arrs)))
    print(f"boundary rings: {len(brings)}; rail lines: {len(rail)} ({ceinture} petite-ceinture ways)")
    print("landmarks:")
    for r in lm_report:
        print("  " + r)
    print("stream bytes (base64): " + ", ".join(f"{k} {len(v) / 1024:.0f} KB" for k, v in parts.items() if len(v) > 2048))
    print(f"wrote {OUT.relative_to(ROOT).as_posix()}: {size / 1024:.1f} KB ({size / 1e6:.3f} MB) in {time.time() - t_start:.1f}s")


if __name__ == "__main__":
    main()
