"""Turn the UPS spreadsheets in data/ into the JSON files the app loads.

Run:  .venv/bin/python build_data.py [zone_chart.xlsx] [surcharge.xlsx]
With no arguments it uses the default files in data/.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).parent
DEFAULT_ZONES = ROOT / "data" / "ups-zones-088.xlsx"
DEFAULT_SURCHARGE = ROOT / "data" / "area-surcharge-zips-us-en.xlsx"
OUT = ROOT / "site" / "data"

# Friendly names for the surcharge sheets. Unknown sheets keep their own name.
LIST_NAMES = {
    "US 48 Zip": "US 48 Zip (DAS)",
    "US 48 Zip DAS Extended": "US 48 Zip DAS Extended",
    "Remote HI Zip": "Remote HI",
    "Remote AK Zip": "Remote AK",
    "Remote US 48 Zip": "Remote US 48",
}

PREFIX_RE = re.compile(r"^\s*(\d{3})\s*(?:-|to)?\s*(\d{3})?\s*$")
FOOTNOTE_RE = re.compile(r"Zone (\d+) for Ground, Zone (\d+) for Next Day Air and Zone (\d+) for 2nd Day Air")


def rows_of(path, sheet=None):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    return [list(r) for r in ws.iter_rows(values_only=True)]


def zip_prefixes(cell):
    """'005' -> ['005'];  '004-007' -> ['004'..'007'];  5 (number) -> ['005']."""
    if isinstance(cell, (int, float)):
        cell = str(int(cell)).zfill(3)
    m = PREFIX_RE.match(str(cell or ""))
    if not m:
        return []
    lo, hi = int(m[1]), int(m[2] or m[1])
    return [str(n).zfill(3) for n in range(lo, hi + 1)]


def zone_value(cell):
    """'002' -> 2, '-' or blank -> None (service not available)."""
    if isinstance(cell, (int, float)):
        return int(cell)
    s = str(cell).strip() if cell is not None else ""
    return int(s) if s.isdigit() else None


def parse_zones(path):
    rows = rows_of(path)
    header_i = next(i for i, r in enumerate(rows) if str(r[0] or "").strip().lower().startswith("dest"))
    services = [str(c).strip() for c in rows[header_i][1:] if c]
    origin = next((m[1] for r in rows[:header_i] if r[0] for m in [re.search(r"ZIP Codes (\d{3})", str(r[0]))] if m), "")

    prefix, zip5, footnote = {}, {}, None
    for r in rows[header_i + 1:]:
        first = r[0]
        if isinstance(first, str) and (m := FOOTNOTE_RE.search(first)):
            ground, nda, second = (int(x) for x in m.groups())
            footnote = {"Ground": ground, "Next Day Air": nda, "2nd Day Air": second}
            continue
        if isinstance(first, str) and not PREFIX_RE.match(first):
            footnote = None  # any other text ends a footnote ZIP list
            continue
        if footnote and isinstance(first, (int, float)):
            # Footnote rows list full 5-digit ZIPs. Services not named in the footnote are not offered.
            for z in r:
                if isinstance(z, (int, float)):
                    zip5[str(int(z)).zfill(5)] = [footnote.get(s) for s in services]
            continue
        for p in zip_prefixes(first):
            prefix[p] = [zone_value(c) for c in r[1:1 + len(services)]]

    if len(prefix) < 100:
        sys.exit(f"Only {len(prefix)} ZIP prefixes found in {path}. Has the file layout changed?")
    if not zip5:
        sys.exit(f"No Hawaii/Alaska footnote ZIPs found in {path}. Has the footnote wording changed?")
    return {"origin": origin, "services": services, "prefix": prefix, "zip5": zip5}


def parse_surcharge(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    lists, effective = {}, ""
    for ws in wb.worksheets:
        zips = set()
        for r in ws.iter_rows(values_only=True):
            for c in r:
                if isinstance(c, (int, float)) and 500 < c < 100000:
                    zips.add(str(int(c)).zfill(5))  # stored as numbers, so 1002 -> "01002"
                elif isinstance(c, str) and c.strip().startswith("Effective") and not effective:
                    effective = c.strip().removeprefix("Effective").strip()
        lists[LIST_NAMES.get(ws.title.strip(), ws.title.strip())] = sorted(zips)
    problems = [n for n in LIST_NAMES.values() if not lists.get(n)] + [n for n, z in lists.items() if not z]
    if problems:
        sys.exit(f"Missing or empty surcharge sheets in {path}: {', '.join(sorted(set(problems)))}. Has the file layout changed?")
    return {"effective": effective, "lists": lists}


def main():
    zones_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_ZONES
    sur_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_SURCHARGE
    OUT.mkdir(parents=True, exist_ok=True)
    zones, sur = parse_zones(zones_path), parse_surcharge(sur_path)
    (OUT / "zones.json").write_text(json.dumps(zones, separators=(",", ":")))
    (OUT / "surcharge.json").write_text(json.dumps(sur, separators=(",", ":")))
    print(f"zones.json: origin {zones['origin']}, {len(zones['prefix'])} prefixes, {len(zones['zip5'])} HI/AK ZIPs")
    print(f"surcharge.json: effective {sur['effective']}, " + ", ".join(f"{k} {len(v)}" for k, v in sur["lists"].items()))


if __name__ == "__main__":
    main()
