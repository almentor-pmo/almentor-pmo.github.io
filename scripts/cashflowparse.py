#!/usr/bin/env python3
"""Parse the "CashFlow Master" tab of PMO_Cash Flow Master Sheet_2026.xlsx.

Layout (columns from A=0):
  row "Start of Period": month headers (Mon-YY) in the monthly columns
  "$ Exchange Rate" label with the rate in the next cell
  "CASH IN" section: one row per project, col 1 = name, col 2 = currency, monthly amounts
  "Total Cash IN $" / "Total Cash IN EGP" / "Cash IN Grand Total in USD" (yearly totals on the right)
  "CASH OUT" section: rows per project per currency
  "Total Cash OUT (EGP)" / "Total Cash OUT ($)" / "Cash OUT Grand Total in USD"
"""
import re, datetime

SHEET = "CashFlow Master"
MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def num(s):
    s = str(s or "").strip()
    if not s or s in ("-", "$-", "EGP -"):
        return 0.0
    neg = s.startswith("(") or "-" in s.split()[-1][:1]
    t = re.sub(r"[^0-9.]", "", s)
    if not t or t == ".":
        return 0.0
    v = float(t)
    return -v if neg else v


def low(r, j):
    return (r[j] if j < len(r) else "").strip().lower()


def find_row(rows, pred):
    for i, r in enumerate(rows):
        if pred(r):
            return i
    return None


def cur_of(s):
    s = s.strip().upper()
    return "USD" if s in ("USD", "$") else "EGP" if s in ("EGP", "LE") else s


def parse_grid(rows):
    """rows: full grid (list of lists of cell strings, column A first). Empty rows may be kept."""
    hi = find_row(rows, lambda r: low(r, 1) == "start of period")
    if hi is None:
        raise RuntimeError('No "Start of Period" header row found in the CashFlow Master tab')
    cols = []
    for j, cell in enumerate(rows[hi]):
        m = re.fullmatch(r"([A-Za-z]{3})-(\d{2})", cell.strip())
        if m and m.group(1) in MONTHS:
            cols.append((j, "20%s-%02d" % (m.group(2), MONTHS[m.group(1)])))
    if not cols:
        raise RuntimeError("No month columns found in the CashFlow Master header")
    first_col, last_col = cols[0][0], cols[-1][0]

    rate = None
    for r in rows[:6]:
        for j, c in enumerate(r):
            if "exchange rate" in c.lower():
                for x in r[j + 1:j + 3]:
                    if num(x):
                        rate = num(x)
                        break

    def section(start_label, total_pred):
        s = find_row(rows, lambda r: low(r, 1) == start_label)
        e = find_row(rows, total_pred)
        if s is None or e is None or e <= s:
            raise RuntimeError(f'Could not find the "{start_label.upper()}" section and its totals')
        items = []
        for r in rows[s + 1:e]:
            name = (r[1] if len(r) > 1 else "").strip()
            cur = cur_of(r[2] if len(r) > 2 else "")
            if not name or cur not in ("USD", "EGP"):
                continue
            vals = {k: num(r[j]) for j, k in cols if j < len(r) and num(r[j])}
            items.append({"name": name, "currency": cur, "values": vals})
        return items, s, e

    cin, _, ein = section("cash in", lambda r: low(r, 1).startswith("total cash in"))
    cout, _, eout = section("cash out", lambda r: low(r, 1).startswith("total cash out"))

    def total_row(pred):
        i = find_row(rows, pred)
        if i is None:
            return {}
        return {k: num(rows[i][j]) for j, k in cols if j < len(rows[i])}

    totals = {
        "in_usd": total_row(lambda r: low(r, 1) in ("total cash in $", "total cash in ($)")),
        "in_egp": total_row(lambda r: low(r, 1) in ("total cash in egp", "total cash in (egp)")),
        "out_usd": total_row(lambda r: low(r, 1) in ("total cash out ($)", "total cash out $")),
        "out_egp": total_row(lambda r: low(r, 1) in ("total cash out (egp)", "total cash out egp")),
    }

    # yearly totals block on the right: year labels in row 0, "Total $"/"Total EGP" headers
    years = {}
    head = rows[0]
    for j, c in enumerate(head):
        if j > last_col and re.fullmatch(r"20\d\d", c.strip()):
            years[c.strip()] = j

    def yearly(label_pred, col0=0):
        i = find_row(rows, label_pred)
        if i is None:
            return {}
        return {y: num(rows[i][j]) for y, j in years.items() if j < len(rows[i])}

    grand_in = yearly(lambda r: low(r, 0).startswith("cash in grand total"))
    grand_out = yearly(lambda r: low(r, 0).startswith("cash out grand total"))
    in_usd_y = yearly(lambda r: low(r, 1) in ("total cash in $",))
    in_egp_y = yearly(lambda r: low(r, 1) in ("total cash in egp",))
    out_usd_y = yearly(lambda r: low(r, 1) in ("total cash out ($)",))
    out_egp_y = yearly(lambda r: low(r, 1) in ("total cash out (egp)",))

    # EGP->USD rate per year, derived from the sheet's own grand totals (falls back to the rate cell)
    rates = {}
    for y in years:
        for egp, usd, grand in ((in_egp_y, in_usd_y, grand_in), (out_egp_y, out_usd_y, grand_out)):
            e, u, g = egp.get(y, 0), usd.get(y, 0), grand.get(y, 0)
            if e > 1000 and g - u > 1:
                rates[y] = round(e / (g - u), 4)
                break
    return {
        "sheet": SHEET, "months": [k for _, k in cols], "rate": rate, "rates": rates,
        "cashIn": cin, "cashOut": cout, "sheetTotals": totals,
        "yearTotals": {"grandIn": grand_in, "grandOut": grand_out},
        "parsedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    }


def check(d, tol=5):
    bad = []
    for sec, cur, key in (("cashIn", "USD", "in_usd"), ("cashIn", "EGP", "in_egp"),
                          ("cashOut", "USD", "out_usd"), ("cashOut", "EGP", "out_egp")):
        tot = d["sheetTotals"].get(key) or {}
        for k, t in tot.items():
            s = sum(i["values"].get(k, 0) for i in d[sec] if i["currency"] == cur)
            if abs(s - t) > tol:
                bad.append((key, k, round(s), round(t)))
    return bad
