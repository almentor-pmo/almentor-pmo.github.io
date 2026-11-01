#!/usr/bin/env python3
"""Hourly sync for the almentor Costing & Quotes site  ->  https://almentor-pmo.github.io/costing/

1. Downloads the Costing price list workbook from its OneDrive/SharePoint "anyone" link
   (stored encrypted in data/cost/sheet.enc) and reads the Settings and Price list tabs.
2. Writes costing/data.enc (AES-256-GCM, costing key) and costing/status.json for the page.

Keys: the repo secret DATA_KEY decrypts data/cost/key.enc, which holds the costing site's own key.
Costing logins (costing/keys.json) unwrap only that key. Quotes saved from the site live in
costing/quotes/*.enc, encrypted with the same key (git history = every version of every quote).
If the download or parsing fails, the last good price list is kept and the error is shown on the page.
Local test:  COST_FILE=book.xlsx DATA_KEY=... python scripts/cost_sync.py
"""
import base64, datetime as dt, hashlib, io, json, os, re, sys, traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync import enc, load_enc, save_enc, now_iso, key as data_key  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CDATA = os.path.join(ROOT, "data", "cost")
SITE = os.path.join(ROOT, "costing")
UNITS = ("per minute", "per deliverable", "per day", "per trip", "per presenter", "per project", "per month", "per item")


def cost_key():
    blob = load_enc(os.path.join(CDATA, "key.enc"), data_key(), None)
    if not blob:
        raise SystemExit("data/cost/key.enc is missing")
    return base64.b64decode(blob["key"])


def download():
    f = os.environ.get("COST_FILE")
    if f:
        return open(f, "rb").read(), None
    import requests
    url = load_enc(os.path.join(CDATA, "sheet.enc"), data_key(), {}).get("url", "")
    if not url:
        raise RuntimeError("The price list Excel link isn't set yet. Showing the last saved price list.")
    if "download=1" not in url:
        url += ("&" if "?" in url else "?") + "download=1"
    r = requests.get(url, timeout=60, headers={"User-Agent": "almentor-costing/1.0"})
    if r.status_code != 200 or not r.content.startswith(b"PK"):
        raise RuntimeError(f"OneDrive returned HTTP {r.status_code} instead of the Excel file. "
                           "The share link must be an 'Anyone with the link can view' link.")
    return r.content, r.headers.get("Last-Modified")


def txt(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"\s+", " ", str(v)).strip()


def num(v):
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = txt(v).replace(",", "").replace("$", "").replace("%", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def find_header(rows, first, start=0):
    for i in range(start, len(rows)):
        if txt(rows[i][0] if rows[i] else "").lower().startswith(first):
            return i
    return None


def parse(body):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(body), data_only=True)
    for t in ("Settings", "Price list"):
        if t not in wb.sheetnames:
            raise RuntimeError(f'The workbook has no "{t}" tab (tabs: {", ".join(wb.sheetnames)})')
    problems = []
    rows = [list(r) for r in wb["Settings"].iter_rows(max_row=80, max_col=4, values_only=True)]
    # rates
    i = find_header(rows, "team")
    if i is None:
        raise RuntimeError('Settings: can\'t find the "Team | Cost per hour" table')
    rates = {}
    for r in rows[i + 1:]:
        if not txt(r[0]):
            break
        rates[txt(r[0])] = num(r[1])
    for need in ("Content", "Design", "Media", "QA", "PM"):
        if need not in rates:
            problems.append(f'Settings: no hourly rate for "{need}"')
            rates.setdefault(need, 0.0)
    # rules
    i = find_header(rows, "rule")
    rules = {}
    if i is not None:
        for r in rows[i + 1:]:
            if not txt(r[0]):
                break
            rules[txt(r[0]).lower()] = num(r[1])
    def rule(word, default):
        for k, v in rules.items():
            if word in k:
                return v
        problems.append(f'Settings: rule "{word}" not found, using {default}')
        return default
    settings = {"gmTeam": rule("team time", 0.5), "gmVendor": rule("vendors", 0.3), "minMargin": rule("minimum margin", 0.35),
                "maxDiscount": rule("maximum discount", 0.1), "hoursPerMonth": rule("hours per month", 176), "validDays": rule("valid", 30)}
    for k in ("gmTeam", "gmVendor", "minMargin", "maxDiscount"):
        if settings[k] > 1:
            settings[k] /= 100
    # fx
    i = find_header(rows, "currency")
    fx = {}
    if i is not None:
        for r in rows[i + 1:]:
            if not txt(r[0]):
                break
            v = num(r[1])
            if v > 0:
                fx[txt(r[0]).upper()] = {"rate": v, "note": txt(r[2])}
    fx.setdefault("USD", {"rate": 1, "note": "Base"})
    # price list
    pl = [list(r) for r in wb["Price list"].iter_rows(max_row=400, max_col=13, values_only=True)]
    h = find_header(pl, "option")
    if h is None:
        raise RuntimeError('Price list: can\'t find the header row (first column "Option")')
    hv = [txt(c).lower() for c in pl[h]]
    def col(*names):
        for n in names:
            for j, v in enumerate(hv):
                if v.startswith(n):
                    return j
        return None
    c = {k: col(*v) for k, v in {"name": ("option",), "group": ("group",), "unit": ("unit",), "content": ("content",), "design": ("design",),
                                  "media": ("media",), "qa": ("qa",), "inhouse": ("in-house", "in house"), "vendor": ("vendor",),
                                  "wording": ("wording",), "source": ("where", "source")}.items()}
    options, seen = [], set()
    for n, r in enumerate(pl[h + 1:], start=h + 2):
        g = lambda k: r[c[k]] if c[k] is not None and c[k] < len(r) else None
        name = txt(g("name"))
        if not name:
            continue
        unit = txt(g("unit")).lower() or "per minute"
        if unit not in UNITS:
            problems.append(f'Price list row {n}: unit "{unit}" for "{name}" isn\'t recognised')
        if name.lower() in seen:
            problems.append(f'Price list row {n}: "{name}" appears twice; the first one is used')
            continue
        seen.add(name.lower())
        options.append({"id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"), "name": name, "group": txt(g("group")) or "Other", "unit": unit,
                        "h": {"Content": num(g("content")), "Design": num(g("design")), "Media": num(g("media")), "QA": num(g("qa"))},
                        "inhouse": num(g("inhouse")), "vendor": num(g("vendor")), "wording": txt(g("wording")) or name, "source": txt(g("source")), "row": n})
    if not options:
        raise RuntimeError("The Price list tab has no options")
    m_ = wb.properties.modified
    return {"rates": rates, "settings": settings, "fx": fx, "options": options, "problems": problems,
            "sourceModified": m_.replace(tzinfo=dt.timezone.utc).isoformat() if m_ else None}


def main():
    k = cost_key()
    os.makedirs(os.path.join(SITE, "quotes"), exist_ok=True)
    snap_path = os.path.join(CDATA, "snapshot.enc")
    old = load_enc(snap_path, k, None)
    status = {"checkedAt": now_iso(), "ok": True, "message": "", "requestId": os.environ.get("REQUEST_ID", "")}
    snap = old
    try:
        body, hdr = download()
        new = parse(body)
        new["sourceModified"] = new["sourceModified"] or hdr
        strip = lambda s: {x: y for x, y in (s or {}).items() if x != "parsedAt"}
        if old is None or strip(old) != strip(new):
            snap = new; snap["parsedAt"] = status["checkedAt"]; save_enc(snap_path, snap, k)
            status["message"] = "Price list updated from Excel"
        else:
            status["message"] = "No changes in the price list since last refresh"
        status["sourceModified"] = new["sourceModified"]
    except Exception as e:
        traceback.print_exc()
        status["ok"] = False; status["message"] = str(e)[:400]
        if old is None:
            raise SystemExit("No price list available yet: " + str(e))
    dk = data_key()
    bundle = {"data": snap, "status": status, "repo": os.environ.get("GITHUB_REPOSITORY", "almentor-pmo/almentor-pmo.github.io"),
              "token": load_enc(os.path.join(ROOT, "data", "token.enc"), dk, {}).get("token", "")}
    with open(os.path.join(SITE, "data.enc"), "w") as f:
        json.dump(enc(bundle, k), f)
    with open(os.path.join(SITE, "status.json"), "w") as f:
        json.dump({**status, "dataHash": hashlib.sha256(json.dumps(snap, sort_keys=True, default=str).encode()).hexdigest()[:16]}, f)
    keep = os.path.join(SITE, "quotes", ".keep")
    if not os.path.exists(keep):
        open(keep, "w").write("")
    print(json.dumps(status))


if __name__ == "__main__":
    main()
