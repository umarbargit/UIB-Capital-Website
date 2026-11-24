#!/usr/bin/env python3
"""
UIB Capital – nightly portfolio sync from Interactive Brokers.

What it does (in plain English):
  1. Asks IBKR's Flex Web Service for your saved Flex Query report (read-only).
  2. Reads open positions, daily account value (NAV), deposits/withdrawals and trades.
  3. Turns everything into PERCENTAGES ONLY:
       - each holding's weight in the portfolio and its % gain/loss since bought
       - a performance index (starts at 100) that ignores deposits/withdrawals
       - the same index for the S&P 500 (SPY) as a benchmark
  4. Writes data/stocks.json, data/performance.json and data/closed.json.
     No money amounts are ever written. The raw IBKR file is never saved.

Secrets (set in GitHub → Settings → Secrets and variables → Actions):
  IBKR_FLEX_TOKEN   – the Flex Web Service token
  IBKR_FLEX_QUERY   – the Flex Query ID

Local testing:
  python scripts/ibkr_sync.py --file sample.xml      (use a downloaded Flex XML)
  python scripts/ibkr_sync.py --sample               (write clearly-marked sample data)
"""
import argparse, csv, io, json, math, os, random, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
THESES = os.path.join(ROOT, "content", "theses")

FLEX_ENDPOINTS = [
    "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService",
    "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService",
]


# ---------------------------------------------------------------- helpers
def load(name, default):
    p = os.path.join(DATA, name)
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    return default


def save(name, obj):
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "UIBCapitalSync/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def pdate(s):
    """IBKR dates come as 20261124, 2026-11-24 or 20261124;153000."""
    if not s:
        return None
    s = s.strip().split(";")[0].split(" ")[0].split(",")[0]
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def num(s, default=0.0):
    try:
        return float(str(s).replace(",", ""))
    except (TypeError, ValueError):
        return default


def thesis_tickers():
    out = set()
    if not os.path.isdir(THESES):
        return out
    for fn in os.listdir(THESES):
        if not fn.endswith(".md"):
            continue
        with open(os.path.join(THESES, fn), encoding="utf-8") as f:
            text = f.read()
        if text.startswith("---"):
            head = text.split("---", 2)[1]
            for line in head.splitlines():
                if line.lower().startswith("ticker:"):
                    t = line.split(":", 1)[1].strip().strip('"').upper()
                    if t:
                        out.add(t)
    return out


# ---------------------------------------------------------------- IBKR
def fetch_flex(token, query):
    last_err = None
    for base in FLEX_ENDPOINTS:
        try:
            q = urllib.parse.urlencode({"t": token, "q": query, "v": "3"})
            resp = ET.fromstring(http_get(f"{base}/SendRequest?{q}"))
            if resp.findtext("Status") != "Success":
                last_err = f"{resp.findtext('ErrorCode')}: {resp.findtext('ErrorMessage')}"
                continue
            ref = resp.findtext("ReferenceCode")
            url = resp.findtext("Url") or f"{base}/GetStatement"
            for attempt in range(20):
                time.sleep(5 if attempt else 3)
                q2 = urllib.parse.urlencode({"t": token, "q": ref, "v": "3"})
                body = http_get(f"{url}?{q2}", timeout=120)
                if "<FlexQueryResponse" in body or "<FlexStatements" in body:
                    return body
                # 1019 = statement still being generated: wait and retry
                if "1019" in body or "progress" in body.lower():
                    continue
                last_err = body[:300]
                break
        except Exception as e:  # network or XML problem: try next endpoint
            last_err = str(e)
    raise SystemExit(f"Could not download the Flex report from IBKR. Last error: {last_err}")


def parse_flex(xml_text):
    root = ET.fromstring(xml_text)
    st = root.find(".//FlexStatement")
    if st is None:
        raise SystemExit("The Flex report has no FlexStatement – check the Flex Query settings.")

    # Daily NAV (account value) — 'Net Asset Value (NAV) in Base' section
    nav = {}
    for e in st.iter("EquitySummaryByReportDateInBase"):
        d = pdate(e.get("reportDate"))
        if d:
            nav[d] = num(e.get("total"))
    # Deposits / withdrawals (external money in or out — not dividends, not fees)
    flows = {}
    for e in st.iter("CashTransaction"):
        t = (e.get("type") or "").lower()
        if "deposit" in t or "withdraw" in t:
            if (e.get("levelOfDetail") or "DETAIL").upper() == "SUMMARY":
                continue
            d = pdate(e.get("settleDate") or e.get("dateTime") or e.get("reportDate"))
            if d:
                rate = num(e.get("fxRateToBase"), 1.0) or 1.0
                flows[d] = flows.get(d, 0.0) + num(e.get("amount")) * rate
    # Open stock positions
    positions = []
    for e in st.iter("OpenPosition"):
        if (e.get("levelOfDetail") or "SUMMARY").upper() not in ("SUMMARY", ""):
            continue
        if (e.get("assetCategory") or "STK") not in ("STK", "ETF"):
            continue
        rate = num(e.get("fxRateToBase"), 1.0) or 1.0
        val = num(e.get("positionValue")) * rate
        cost = num(e.get("costBasisMoney")) * rate
        if val <= 0:
            continue
        positions.append({
            "symbol": (e.get("symbol") or "").upper(),
            "name": e.get("description") or "",
            "value": val,
            "cost": cost,
        })
    # First buy date per symbol (within the report window)
    first_buy = {}
    for e in st.iter("Trade"):
        if (e.get("assetCategory") or "STK") not in ("STK", "ETF"):
            continue
        if (e.get("buySell") or "").upper().startswith("BUY"):
            s = (e.get("symbol") or "").upper()
            d = pdate(e.get("tradeDate") or e.get("dateTime"))
            if s and d and (s not in first_buy or d < first_buy[s]):
                first_buy[s] = d
    return nav, flows, positions, first_buy


# ---------------------------------------------------------------- benchmark
def fetch_benchmark(start):
    """Daily SPY closes (dividend-adjusted where available). Returns {date: close}."""
    out = {}
    try:
        p1 = int(datetime.combine(start - timedelta(days=10), datetime.min.time()).timestamp())
        body = http_get(f"https://query1.finance.yahoo.com/v8/finance/chart/SPY?period1={p1}&period2={int(time.time())}&interval=1d", timeout=60)
        res = json.loads(body)["chart"]["result"][0]
        closes = (res["indicators"].get("adjclose") or [{}])[0].get("adjclose") or res["indicators"]["quote"][0]["close"]
        for ts, c in zip(res["timestamp"], closes):
            if c:
                out[datetime.utcfromtimestamp(ts).date()] = float(c)
    except Exception as e:
        print("Benchmark (Yahoo) failed:", e)
    if not out:
        try:
            body = http_get("https://stooq.com/q/d/l/?s=spy.us&i=d", timeout=60)
            for row in csv.DictReader(io.StringIO(body)):
                d = pdate(row.get("Date"))
                if d and d >= start - timedelta(days=10):
                    out[d] = num(row.get("Close"))
        except Exception as e:
            print("Benchmark (Stooq) failed:", e)
    print(f"Benchmark: {len(out)} daily prices.")
    return out


def diagnose(xml_text):
    """Prints the SHAPE of the IBKR report (section names, field names, counts) — never amounts."""
    root = ET.fromstring(xml_text)
    counts = {}
    first = {}
    for e in root.iter():
        counts[e.tag] = counts.get(e.tag, 0) + 1
        if e.tag not in first and e.attrib:
            first[e.tag] = sorted(e.attrib.keys())
    print("== Report shape ==")
    for t, n in counts.items():
        print(f"{t}: {n}")
    for t, keys in first.items():
        if t in ("EquitySummaryByReportDateInBase", "OpenPosition", "CashTransaction", "Trade", "FlexStatement"):
            print(f"{t} fields: {', '.join(keys)}")
    kinds = {}
    for e in root.iter("CashTransaction"):
        k = (e.get("type"), e.get("levelOfDetail"))
        kinds[k] = kinds.get(k, 0) + 1
    print("CashTransaction types:", kinds)
    pos = {}
    for e in root.iter("OpenPosition"):
        k = (e.get("assetCategory"), e.get("levelOfDetail"))
        pos[k] = pos.get(k, 0) + 1
    print("OpenPosition kinds:", pos)


# ---------------------------------------------------------------- maths
def chain_index(nav, flows, prev_series):
    """Time-weighted index: deposits/withdrawals don't count as gains or losses."""
    days = sorted(d for d in nav if nav[d] > 0)
    if len(days) < 2:
        return prev_series
    rets = {}
    for a, b in zip(days, days[1:]):
        base = nav[a] + flows.get(b, 0.0)  # money added that day is treated as invested from the start of the day
        if base > 0:
            r = nav[b] / base - 1
            if abs(r) > 0.35:  # almost certainly money moved in/out that the report did not label – ignore that day
                print(f"Note: {b} looked like an unlabelled deposit/withdrawal ({100 * r:+.0f}%); not counted as performance.")
                r = 0.0
            rets[b] = r
    prev = {p["date"]: p for p in prev_series}
    start = days[0].isoformat()
    kept = [p for p in prev_series if p["date"] < start]
    level = prev[start]["port"] if start in prev else (kept[-1]["port"] if kept else 100.0)
    series = kept + [{"date": start, "port": round(level, 4)}]
    for d in days[1:]:
        level *= 1 + rets.get(d, 0.0)
        series.append({"date": d.isoformat(), "port": round(level, 4)})
    # carry previous benchmark values across for now; filled properly below
    for p in series:
        if p["date"] in prev and "bench" in prev[p["date"]]:
            p["bench"] = prev[p["date"]]["bench"]
    return series


def add_benchmark(series, closes):
    if not closes or not series:
        return series
    ds = sorted(closes)

    def close_on(d):
        best = None
        for x in ds:
            if x <= d:
                best = x
            else:
                break
        return closes[best] if best else None

    base = close_on(date.fromisoformat(series[0]["date"]))
    if not base:
        return series
    for p in series:
        c = close_on(date.fromisoformat(p["date"]))
        if c:
            p["bench"] = round(100 * c / base, 4)
    return series


def stats(series, key):
    pts = [(p["date"], p[key]) for p in series if key in p]
    if len(pts) < 2:
        return {}
    first, last = pts[0][1], pts[-1][1]
    year = pts[-1][0][:4]
    prior = [v for d, v in pts if d < f"{year}-01-01"]
    ytd_base = prior[-1] if prior else first
    peak, mdd = -1, 0.0
    for _, v in pts:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    return {
        "sinceInception": round(100 * (last / first - 1), 2),
        "ytd": round(100 * (last / ytd_base - 1), 2),
        "maxDrawdown": round(100 * mdd, 2),
    }


def monthly(series, key):
    """{year: {month: % return}} from month-end index levels."""
    ends = {}
    for p in series:
        if key in p:
            ends[p["date"][:7]] = p[key]
    out, prev = {}, None
    first = next((p[key] for p in series if key in p), None)
    for ym in sorted(ends):
        base = prev if prev is not None else first
        y, m = ym.split("-")
        out.setdefault(y, {})[m] = round(100 * (ends[ym] / base - 1), 2)
        prev = ends[ym]
    years = {}
    for y in out:
        yr_pts = [p[key] for p in series if key in p and p["date"].startswith(y)]
        before = [p[key] for p in series if key in p and p["date"] < f"{y}-01-01"]
        base = before[-1] if before else yr_pts[0]
        years[y] = round(100 * (yr_pts[-1] / base - 1), 2)
    return out, years


# ---------------------------------------------------------------- outputs
def write_outputs(nav, flows, positions, first_buy, as_of, site):
    prev_perf = load("performance.json", {"series": []})
    prev_stocks = load("stocks.json", {"positions": []})
    closed = load("closed.json", {"positions": []})
    if prev_perf.get("sample"):
        prev_perf = {"series": []}
    if prev_stocks.get("sample"):
        prev_stocks = {"positions": []}
    if closed.get("sample"):
        closed = {"positions": []}

    series = chain_index(nav, flows, prev_perf.get("series", []))
    start = date.fromisoformat(series[0]["date"]) if series else as_of
    series = add_benchmark(series, fetch_benchmark(start))

    total = nav.get(max(nav)) if nav else sum(p["value"] for p in positions)
    prev_first = {p["symbol"]: p.get("firstBought") for p in prev_stocks.get("positions", [])}
    with_thesis = thesis_tickers()
    delay = int(site.get("newPositionDelayDays", 0) or 0)

    shown, hidden_w = [], 0.0
    for p in sorted(positions, key=lambda x: -x["value"]):
        w = 100 * p["value"] / total if total else 0
        fb = first_buy.get(p["symbol"])
        fb_s = fb.isoformat() if fb else prev_first.get(p["symbol"]) or ""
        is_new = fb is not None and (as_of - fb).days < delay
        if is_new and p["symbol"] not in with_thesis:
            hidden_w += w
            continue
        shown.append({
            "symbol": p["symbol"],
            "name": p["name"].title() if p["name"].isupper() else p["name"],
            "weight": round(w, 2),
            "returnPct": round(100 * (p["value"] / p["cost"] - 1), 2) if p["cost"] > 0 else None,
            "firstBought": fb_s,
        })
    invested = sum(100 * p["value"] / total for p in positions) if total else 0
    stocks = {
        "asOf": as_of.isoformat(),
        "source": "Interactive Brokers (Flex Web Service)",
        "positions": shown,
        "undisclosedNewWeight": round(hidden_w, 2),
        "cashWeight": round(max(0.0, 100 - invested), 2),
    }

    # Positions that disappeared since last run are recorded as closed.
    now_syms = {p["symbol"] for p in positions}
    known_closed = {(c["symbol"], c["closed"]) for c in closed["positions"]}
    for p in prev_stocks.get("positions", []):
        if p["symbol"] not in now_syms and (p["symbol"], as_of.isoformat()) not in known_closed:
            closed["positions"].insert(0, {
                "symbol": p["symbol"], "name": p.get("name", ""),
                "opened": p.get("firstBought", ""), "closed": as_of.isoformat(),
                "returnPct": p.get("returnPct"),
            })

    m_port, y_port = monthly(series, "port")
    m_bench, y_bench = monthly(series, "bench")
    perf = {
        "asOf": as_of.isoformat(),
        "method": "Time-weighted, after costs; deposits and withdrawals excluded",
        "series": series,
        "stats": {"portfolio": stats(series, "port"), "benchmark": stats(series, "bench")},
        "monthly": {"portfolio": m_port, "benchmark": m_bench},
        "yearly": {"portfolio": y_port, "benchmark": y_bench},
    }
    save("stocks.json", stocks)
    save("performance.json", perf)
    save("closed.json", closed)
    print(f"Synced {len(shown)} positions ({len(positions) - len(shown)} held back), {len(series)} index points, as of {as_of}.")


# ---------------------------------------------------------------- sample data
def write_sample(site):
    """Clearly-marked SAMPLE data so the site can be previewed before IBKR is connected."""
    rnd = random.Random(7)
    start = date.fromisoformat(site.get("startDate", "2026-01-02"))
    d, port, bench, series = start, 100.0, 100.0, []
    while d <= date(2026, 11, 20):
        if d.weekday() < 5:
            series.append({"date": d.isoformat(), "port": round(port, 4), "bench": round(bench, 4)})
            m = rnd.gauss(0.0004, 0.009)
            bench *= 1 + m
            port *= 1 + m * 1.1 + rnd.gauss(0.00025, 0.005)
        d += timedelta(days=1)
    m_port, y_port = monthly(series, "port")
    m_bench, y_bench = monthly(series, "bench")
    save("performance.json", {
        "sample": True, "asOf": series[-1]["date"],
        "method": "Time-weighted, after costs; deposits and withdrawals excluded",
        "series": series,
        "stats": {"portfolio": stats(series, "port"), "benchmark": stats(series, "bench")},
        "monthly": {"portfolio": m_port, "benchmark": m_bench},
        "yearly": {"portfolio": y_port, "benchmark": y_bench},
    })
    save("stocks.json", {
        "sample": True, "asOf": series[-1]["date"], "source": "Sample data",
        "positions": [
            {"symbol": "SAMPLE1", "name": "Sample holding one", "weight": 18.4, "returnPct": 24.6, "firstBought": "2026-01-05"},
            {"symbol": "SAMPLE2", "name": "Sample holding two", "weight": 15.1, "returnPct": 11.2, "firstBought": "2026-02-10"},
            {"symbol": "SAMPLE3", "name": "Sample holding three", "weight": 12.7, "returnPct": -6.3, "firstBought": "2026-03-18"},
            {"symbol": "SAMPLE4", "name": "Sample holding four", "weight": 10.9, "returnPct": 31.8, "firstBought": "2026-01-05"},
            {"symbol": "SAMPLE5", "name": "Sample holding five", "weight": 8.2, "returnPct": 3.4, "firstBought": "2026-06-02"},
        ],
        "undisclosedNewWeight": 0, "cashWeight": 34.7,
    })
    save("closed.json", {"sample": True, "positions": [
        {"symbol": "SAMPLE6", "name": "Sample closed position", "opened": "2026-02-03", "closed": "2026-08-14", "returnPct": 17.5},
        {"symbol": "SAMPLE7", "name": "Sample closed position", "opened": "2026-04-22", "closed": "2026-09-30", "returnPct": -9.1},
    ]})
    print("Sample data written.")


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="Use a downloaded Flex XML file instead of calling IBKR")
    ap.add_argument("--sample", action="store_true", help="Write sample data")
    args = ap.parse_args()
    site = load("site.json", {})
    if args.sample:
        return write_sample(site)
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            xml_text = f.read()
    else:
        token, query = os.environ.get("IBKR_FLEX_TOKEN"), os.environ.get("IBKR_FLEX_QUERY")
        if not token or not query:
            raise SystemExit("IBKR_FLEX_TOKEN / IBKR_FLEX_QUERY are not set – add them as GitHub secrets.")
        xml_text = fetch_flex(token, query)
    diagnose(xml_text)
    nav, flows, positions, first_buy = parse_flex(xml_text)
    print(f"NAV days: {len(nav)}, deposit/withdrawal days: {len(flows)}, stock positions: {len(positions)}")
    del xml_text  # the raw file (with money amounts) is never written anywhere
    as_of = max(nav) if nav else date.today()
    write_outputs(nav, flows, positions, first_buy, as_of, site)


if __name__ == "__main__":
    main()
