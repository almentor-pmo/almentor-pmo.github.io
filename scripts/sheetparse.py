#!/usr/bin/env python3
"""Parse the 'For Business Review' sheet of PMO_Recognition_Sheet_2026.xlsx
(as returned by the Microsoft 365 read_resource tool) into dashboard JSON.

Usage: python3 parser.py <read_resource_output.txt> <out.json>
"""
import json, re, sys, datetime

SHEET = "For Business Review"
MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def num(s):
    if s is None:
        return 0.0
    s = str(s).strip()
    if not s or s in ("-", "$-"):
        return 0.0
    neg = s.startswith("(") or s.startswith("-")
    s2 = re.sub(r"[^0-9.]", "", s)
    if not s2 or s2 == ".":
        return 0.0
    v = float(s2)
    return -v if neg and s.strip("$ ") not in ("-",) and re.search(r"\d", s) else v


def blank(s):
    return s is None or str(s).strip() == ""


def section(text):
    lines = text.split("\n")
    start = None
    for i, l in enumerate(lines):
        if l.startswith("## Sheet: " + SHEET):
            start = i + 1
            continue
        if start is not None and (l.startswith("## Sheet:") or l.startswith("Formulas:")):
            return lines[start:i]
    if start is None:
        raise SystemExit("sheet '%s' not found" % SHEET)
    return lines[start:]


def parse_text(text):
    """Parse the Microsoft 365 connector's text rendering of the workbook."""
    return parse_grid([l.split("\t") for l in section(text) if not l.startswith("[")])


def parse_grid(rows):
    """rows: list of rows, each a list of cell strings starting at column A,
    with fully empty rows removed."""
    # header rows: find the row with 'Special Project Name'
    h = next(i for i, r in enumerate(rows) if len(r) > 1 and r[1].strip() == "Special Project Name")
    label_row, pa_row = rows[h + 1], rows[h + 2]
    periods = []  # (kind, key, col)
    for j, cell in enumerate(label_row):
        t = cell.strip()
        if re.fullmatch(r"\d{4}", t):
            periods.append(("year", t, j))
        else:
            m = re.fullmatch(r"([A-Za-z]{3})-(\d{2})", t)
            if m and m.group(1) in MONTHS:
                periods.append(("month", "20%s-%02d" % (m.group(2), MONTHS[m.group(1)]), j))
    projects = []
    i = h + 4
    while i < len(rows):
        r = rows[i]
        name = r[1].strip() if len(r) > 1 else ""
        if name == "Totals" or name.startswith("Total Projects"):
            break
        if name:
            g = lambda j: r[j] if j < len(r) else ""
            p = {"name": name, "location": g(2).strip(), "currency": g(3).strip(),
                 "history": {}, "months": {}}
            for kind, key, j in periods:
                if kind == "year":
                    p["history"][key] = {"cc": num(g(j)), "usd": num(g(j + 1))}
                else:
                    cells = [g(j), g(j + 1), g(j + 2), g(j + 3)]
                    if all(blank(c) for c in cells):
                        continue
                    p["months"][key] = {"pcc": num(cells[0]), "pusd": num(cells[1]),
                                        "acc": num(cells[2]), "ausd": num(cells[3])}
            projects.append(p)
        i += 1
    # sheet totals row (for validation)
    totals = {}
    tr = next((r for r in rows if len(r) > 1 and r[1].strip() == "Totals"), None)
    if tr:
        for kind, key, j in periods:
            if kind == "month":
                totals[key] = {"pusd": num(tr[j + 1] if j + 1 < len(tr) else ""),
                               "ausd": num(tr[j + 3] if j + 3 < len(tr) else "")}
    # summary table
    summary = []
    sh = next((k for k, r in enumerate(rows) if len(r) > 2 and r[1].strip() == "Project Name"
               and "Net Project Value" in r[2]), None)
    grand = {}
    if sh is not None:
        for r in rows[sh + 1:]:
            if not r or len(r) < 11:
                continue
            if r[0].strip().startswith("Grand Total"):
                grand = {"net_usd": num(r[4]), "rec_usd": num(r[8]), "pct": num(r[10]) / 100}
                break
            if not r[1].strip():
                continue
            ncc = r[2].strip()
            m = re.match(r"([^\d\s.,]+)\s*([\d,\.]+)", ncc.replace("$", "USD ").strip())
            summary.append({
                "name": r[1].strip(),
                "currency": (m.group(1) if m else "").replace("€", "EUR"),
                "net_cc": num(r[2]), "net_usd": num(r[4]), "net_usd_alt": num(r[5]) if len(r) > 5 and r[5].strip() else None,
                "rec_cc": num(r[6]), "rec_usd": num(r[8]),
                "pct": num(r[10]) / 100,
            })
    return {"sheet": SHEET, "projects": projects, "summary": summary,
            "sheetTotals": totals, "grandTotal": grand,
            "parsedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}


def check(data, tol=50):
    """Compare parsed monthly USD sums against the sheet's own Totals row."""
    bad = []
    for k, t in data["sheetTotals"].items():
        ps = sum(p["months"].get(k, {}).get("pusd", 0) for p in data["projects"])
        acs = sum(p["months"].get(k, {}).get("ausd", 0) for p in data["projects"])
        if abs(ps - t["pusd"]) > tol or abs(acs - t["ausd"]) > tol:
            bad.append((k, round(ps), t["pusd"], round(acs), t["ausd"]))
    return bad


if __name__ == "__main__":
    data = parse_text(open(sys.argv[1], encoding="utf-8").read())
    if len(sys.argv) > 3:
        data["sourceModified"] = sys.argv[3]
    json.dump(data, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
    # validation: parsed USD sums vs sheet's own Totals row
    bad = []
    for k, t in data["sheetTotals"].items():
        ps = sum(p["months"].get(k, {}).get("pusd", 0) for p in data["projects"])
        acs = sum(p["months"].get(k, {}).get("ausd", 0) for p in data["projects"])
        if abs(ps - t["pusd"]) > 2 or abs(acs - t["ausd"]) > 2:
            bad.append((k, round(ps), t["pusd"], round(acs), t["ausd"]))
    print("projects:", len(data["projects"]), "summary:", len(data["summary"]),
          "months:", len(data["sheetTotals"]), "mismatches:", bad)
