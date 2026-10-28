#!/usr/bin/env python3
"""Parse PMO_Budget & Cost Control_2026.xlsx: one worksheet per project.

Each visible sheet:
  row 1: "USD to EGP Exg. Rate" and the rate
  header row: "Budget Line Item" | "Budget Set ($)" | "Equiv. Budget Set (EGP)" | period blocks
  each period block = 4 columns: Allocation % | Actual Spent | Remaining Budget | Forecast
  category lines carry a Remaining Budget value; their sub-lines carry an Allocation %
  "Total Budget" / "Total" row: the sheet's own totals per block
Amounts are in EGP (budget also given in USD).
"""
import re, datetime

MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def num(s):
    s = str(s or "").strip()
    if not s or s.startswith("#") or s in ("-",):
        return 0.0
    neg = s.startswith("(") or bool(re.match(r"^[A-Z$€ ]*-", s))
    t = re.sub(r"[^0-9.]", "", s)
    if not t or t == ".":
        return 0.0
    v = float(t)
    return -v if neg else v


def cell(r, j):
    return r[j].strip() if j < len(r) and r[j] else ""


def period_key(label):
    """Month labels -> 'YYYY-MM'. Other labels -> a bucket for that year or 'other'."""
    lab = label.replace("\n", " ").strip()
    m = re.fullmatch(r"([A-Za-z]{3})-(\d{2})", lab)
    if m and m.group(1) in MONTHS:
        return "20%s-%02d" % (m.group(2), MONTHS[m.group(1)]), lab
    ys = re.findall(r"20\d\d", lab)
    if ys:
        return "%s-00" % max(ys), lab  # e.g. "2025 & 2024" -> before Jan of the next year
    return "other", lab


def parse_sheet(rows, name):
    errors = []
    for i, r in enumerate(rows):
        for j, c in enumerate(r):
            if c and c.strip().startswith("#") and c.strip().endswith("!"):
                errors.append({"row": i + 1, "col": j, "value": c.strip()})
    rate = None
    for r in rows[:3]:
        for j, c in enumerate(r):
            if "exg" in c.lower() or "exchange" in c.lower():
                for x in r[j + 1:]:
                    if num(x) > 1:
                        rate = num(x)
                        break
    hi = next((i for i, r in enumerate(rows) if "budget line item" in cell(r, 1).lower()), None)
    if hi is None:
        raise RuntimeError(f'"{name}": no "Budget Line Item" header row')
    blocks = []
    for j in range(4, len(rows[hi]), 4):
        lab = cell(rows[hi], j)
        if lab:
            k, l = period_key(lab)
            blocks.append({"col": j, "key": k, "label": l})
    # ranges such as "Jan to May": use the end month and the year of the nearest dated block
    for i, b in enumerate(blocks):
        if b["key"] != "other":
            continue
        m = re.findall(r"\b([A-Z][a-z]{2})\b", b["label"])
        yrs = [x["key"][:4] for x in blocks[i + 1:] + blocks[:i][::-1] if re.fullmatch(r"20\d\d-\d\d", x["key"]) and x["key"][5:] != "00"]
        if m and m[-1] in MONTHS and yrs:
            b["key"] = "%s-%02d" % (yrs[0], MONTHS[m[-1]])
            b["range"] = True
    ti = next((i for i, r in enumerate(rows) if i > hi and cell(r, 1).lower() in ("total budget", "total")), None)
    if ti is None:
        raise RuntimeError(f'"{name}": no "Total" row')
    tr = rows[ti]

    def per_block(r):
        out = []
        for b in blocks:
            j = b["col"]
            out.append({"actual": num(cell(r, j + 1)), "remaining": cell(r, j + 2), "forecast": num(cell(r, j + 3))})
        return out

    total = {"budget_usd": num(cell(tr, 2)), "budget_egp": num(cell(tr, 3)), "blocks": per_block(tr)}
    lines, group = [], ""
    for i in range(hi + 2, ti):
        r = rows[i]
        if cell(r, 0):
            group = cell(r, 0)
        first_rem = blocks[0]["col"] + 2 if blocks else 6
        if cell(r, first_rem) == "" and cell(r, 2) == "":
            continue  # sub-line (allocation row) or empty
        if cell(r, first_rem) == "":
            continue
        pb = per_block(r)
        lab = cell(r, 1) or "(unnamed line)"
        b_egp = num(cell(r, 3))
        act = sum(x["actual"] for x in pb)
        if not b_egp and not act:
            continue
        lines.append({"row": i + 1, "group": group, "name": lab, "budget_usd": num(cell(r, 2)), "budget_egp": b_egp,
                      "actual": {b["key"]: x["actual"] for b, x in zip(blocks, pb) if x["actual"]},
                      "spent": act})
    # totals by period (sum duplicates of the same key, e.g. repeated labels)
    actual, forecast = {}, {}
    for b, x in zip(blocks, total["blocks"]):
        if x["actual"]:
            actual[b["key"]] = actual.get(b["key"], 0) + x["actual"]
        if x["forecast"]:
            forecast[b["key"]] = forecast.get(b["key"], 0) + x["forecast"]
    spent = sum(x["actual"] for x in total["blocks"])
    # remaining from the last block that shows one; fall back to budget - spent
    rem = None
    for x in total["blocks"]:
        if x["remaining"] not in ("",) and not str(x["remaining"]).startswith("#"):
            rem = num(x["remaining"])
    checks = []
    line_spent = sum(l["spent"] for l in lines)
    if abs(line_spent - spent) > 1:
        checks.append({"kind": "lines_vs_total", "lines": line_spent, "total": spent})
    line_budget = sum(l["budget_egp"] for l in lines)
    if total["budget_egp"] and abs(line_budget - total["budget_egp"]) > 1:
        checks.append({"kind": "budget_lines_vs_total", "lines": line_budget, "total": total["budget_egp"]})
    dup = [b["label"] for b in blocks if b.get("range") or b["key"] == "other"]
    calc_rem = total["budget_egp"] - spent
    if rem is not None and abs(rem - calc_rem) > max(1000, .01 * total["budget_egp"]):
        checks.append({"kind": "remaining_vs_calc", "sheet_remaining": rem, "calculated": calc_rem})
    return {"sheet": name, "rate": rate or 50, "budget_usd": total["budget_usd"], "budget_egp": total["budget_egp"],
            "spent_egp": spent, "remaining_egp": calc_rem, "sheet_remaining_egp": rem,
            "actual": actual, "forecast": forecast, "periods": [b["label"] for b in blocks],
            "odd_periods": dup, "lines": lines, "errors": errors[:20], "checks": checks}


def parse_workbook(grids, states):
    projects, problems = [], []
    for name, rows in grids.items():
        if states.get(name) != "visible":
            continue
        try:
            projects.append(parse_sheet(rows, name.strip()))
        except Exception as e:  # one bad sheet must not stop the rest
            problems.append(f"{name.strip()}: {e}")
    return {"projects": projects, "problems": problems,
            "parsedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
