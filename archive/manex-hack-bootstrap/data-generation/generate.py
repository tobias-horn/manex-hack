"""
Synthetic seed-data generator for the Manex Hackathon.

Generates a FK-consistent snapshot of ~9,500 rows spanning the quality domain
and writes it as INSERT statements to supabase/seed.sql.

Embeds four explicit root-cause stories so teams have genuine material for
FMEA, fault-tree, 8D, and LLM-driven report generation:

  Story 1 - Supplier incident:
    Batch SB-00007 (capacitor PM-00008 @ position C12 on Steuerplatine)
    from supplier "ElektroParts GmbH" received early Feb 2026 has elevated
    ESR; causes SOLDER_COLD defects (weeks 5-6/2026) and field claims
    (Mar 2026, lag 4-8 weeks).

  Story 2 - Process drift (calibration):
    Torque wrench at Section 'Montage Linie 1' drifted in Dec 2025, fixed
    early Jan 2026. Products built at that line/period show VIB_FAIL defects
    (weeks 49-52/2025).

  Story 3 - Design weakness (thermal):
    MC-200 resistor PM-00015 at BOM position R33 runs hot under nominal
    load; manifests only as field claims 8-12 weeks post-build. No in-
    factory test catches it.

  Story 4 - Operator/shift handling:
    Production orders PO-00012, PO-00018, PO-00024 had operator 'user_042'
    who handled packaging roughly; cosmetic defects only (VISUAL_SCRATCH,
    LABEL_MISALIGN), no functional impact.

Usage:
    python generate.py
    # writes ../supabase/seed.sql

Deterministic: a fixed RNG seed makes output reproducible.
"""

from __future__ import annotations

import json
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ======================================================================
# Configuration
# ======================================================================

RNG_SEED = 20260413  # deterministic

REPO_ROOT = Path(__file__).parent.parent
SEED_FILE = REPO_ROOT / "supabase" / "seed.sql"
TEMPLATES_DIR = Path(__file__).parent / "templates"

# Time range
DATE_START = datetime(2025, 10, 1, tzinfo=timezone.utc)
DATE_END   = datetime(2026, 4, 1, tzinfo=timezone.utc)

# Story timing anchors
STORY1_DEFECT_WEEKS = [(2026, 5), (2026, 6)]           # ~25 defects here
STORY1_BATCH_RECEIVED = date(2026, 2, 3)                # SB-00007 received
STORY2_WEEKS = [(2025, 49), (2025, 50), (2025, 51), (2025, 52)]  # ~20 defects

# Relative image path prefix. Clients should prepend the handout host, e.g.
#   http://<vm>:9000 + image_url
IMAGE_PATH_PREFIX = "/defect_images"

# Counts
N_PRODUCTS          = 500
N_TEST_RESULTS      = 2000
N_DEFECTS           = 150
N_FIELD_CLAIMS      = 40
N_REWORKS           = 120
N_PRODUCT_ACTIONS   = 50
N_PARTS             = 3500
N_PPI_PER_PRODUCT   = 6  # ~6 key parts per product

# Story scopes
STORY1_TARGET_PRODUCTS = 30     # MC-200 products built with SB-00007 part
STORY1_DEFECTS         = 25
STORY1_CLAIMS          = 12
STORY2_DEFECTS         = 20
STORY3_CLAIMS          = 15
STORY4_DEFECTS         = 15
FALSE_POSITIVE_DEFECTS = 10
NEAR_MISS_TEST_RESULTS = 50

# Users
USER_IDS_NORMAL = [f"user_{n:03d}" for n in (17, 23, 31, 44, 58, 71, 89)]
USER_STORY4 = "user_042"

# Defect code Pareto (15 total; top 3 ~70%)
DEFECT_CODES_TOP = ["SOLDER_COLD", "VISUAL_CRACK", "TEST_OOL"]
DEFECT_CODES_BACKGROUND = [
    "COLD_JOINT", "MISSING_PART", "WRONG_PART", "DIM_OOL", "LABEL_MISALIGN",
    "VISUAL_SCRATCH", "FUNC_FAIL", "POLARITY", "THERMAL_DRIFT", "BURNED",
    "CORROSION", "HAIRLINE",
]

# ======================================================================
# Helpers
# ======================================================================

rng = random.Random(RNG_SEED)


def rand_ts(start: datetime = DATE_START, end: datetime = DATE_END) -> datetime:
    """Uniform random timestamp in [start, end)."""
    delta = (end - start).total_seconds()
    return start + timedelta(seconds=rng.uniform(0, delta))


def iso_week_bounds(year: int, week: int) -> tuple[datetime, datetime]:
    """Return UTC (start, end) of the given ISO week."""
    monday = datetime.fromisocalendar(year, week, 1).replace(tzinfo=timezone.utc)
    return monday, monday + timedelta(days=7)


def ts_in_week(year: int, week: int) -> datetime:
    start, end = iso_week_bounds(year, week)
    return start + timedelta(seconds=rng.uniform(0, (end - start).total_seconds()))


def sql_str(value: Any) -> str:
    """Render a Python value as a SQL literal. Escapes single quotes."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, datetime):
        return f"'{value.isoformat()}'"
    if isinstance(value, date):
        return f"'{value.isoformat()}'"
    s = str(value).replace("'", "''")
    return f"'{s}'"


def insert_rows(table: str, rows: list[dict]) -> str:
    """Emit a multi-row INSERT statement. Empty input returns ''."""
    if not rows:
        return ""
    cols = list(rows[0].keys())
    out: list[str] = [f"INSERT INTO {table} ({', '.join(cols)}) VALUES"]
    values = []
    for row in rows:
        values.append("  (" + ", ".join(sql_str(row[c]) for c in cols) + ")")
    out.append(",\n".join(values) + ";")
    return "\n".join(out)


# ======================================================================
# Text templates
# ======================================================================

def load_texts_with_fallback(primary_filename: str, legacy_filename: str) -> dict[str, list[str]]:
    """Load tagged-text JSON from primary file, fallback to legacy if needed."""
    primary = TEMPLATES_DIR / primary_filename
    legacy = TEMPLATES_DIR / legacy_filename

    path = primary if primary.exists() else legacy
    if not path.exists():
        print(
            f"  warning: missing {primary} and {legacy} — using stub placeholders",
            file=sys.stderr,
        )
        return {}

    entries = json.loads(path.read_text(encoding="utf-8"))
    buckets: dict[str, list[str]] = {}
    for entry in entries:
        buckets.setdefault(entry["tag"], []).append(entry["text"])
    return buckets


class TextBank:
    """Cycles through tagged texts so each is used at most once per tag."""

    def __init__(self, buckets: dict[str, list[str]], fallback: str):
        self.buckets = {k: list(v) for k, v in buckets.items()}
        for v in self.buckets.values():
            rng.shuffle(v)
        self._cursors: dict[str, int] = {}
        self.fallback = fallback

    def take(self, tag: str) -> str:
        items = self.buckets.get(tag) or self.buckets.get("background") or []
        if not items:
            return self.fallback
        cursor = self._cursors.get(tag, 0)
        text = items[cursor % len(items)]
        self._cursors[tag] = cursor + 1
        return text


claims_bank  = TextBank(load_texts_with_fallback("claim_texts_en.json", "claim_texts_de.json"),
                        "Customer complaint without details.")
defects_bank = TextBank(load_texts_with_fallback("defect_notes_en.json", "defect_notes_de.json"),
                        "Defect detected, details pending.")
rework_bank  = TextBank(load_texts_with_fallback("rework_actions_en.json", "rework_actions_de.json"),
                        "Rework completed.")


# ======================================================================
# Accumulators
# ======================================================================

tables: dict[str, list[dict]] = {
    "factory": [], "line": [], "section": [], "article": [], "configuration": [],
    "bom": [], "part_master": [], "bom_node": [], "supplier_batch": [], "part": [],
    "production_order": [], "product": [], "product_part_install": [],
    "test": [], "test_result": [],
    "defect": [], "field_claim": [], "rework": [], "product_action": [],
}

_counters: dict[str, int] = {}


def next_id(prefix: str, width: int = 5) -> str:
    _counters[prefix] = _counters.get(prefix, 0) + 1
    return f"{prefix}-{_counters[prefix]:0{width}d}"


# ======================================================================
# 1. Factory / Line / Section
# ======================================================================

SECTION_MONTAGE_L1: str = ""       # captured below for Story 2
SECTION_ENDPRUEFUNG_L2: str = ""   # captured for hotspot noise

def build_factories() -> None:
    global SECTION_MONTAGE_L1, SECTION_ENDPRUEFUNG_L2
    fac_augsburg = {"factory_id": next_id("FAC"), "name": "Werk Augsburg",
                    "country": "DE", "site_code": "AUG"}
    fac_dresden  = {"factory_id": next_id("FAC"), "name": "Werk Dresden",
                    "country": "DE", "site_code": "DRE"}
    tables["factory"].extend([fac_augsburg, fac_dresden])

    line_specs = [
        (fac_augsburg["factory_id"], "Linie 1", "assembly",  "North"),
        (fac_augsburg["factory_id"], "Linie 2", "assembly",  "South"),
        (fac_dresden["factory_id"],  "Linie 1", "test",      "East"),
        (fac_dresden["factory_id"],  "Linie 2", "packaging", "West"),
    ]
    lines = []
    for factory_id, name, line_type, area in line_specs:
        lines.append({
            "line_id": next_id("LIN"), "factory_id": factory_id,
            "name": name, "line_type": line_type, "area": area,
        })
    tables["line"].extend(lines)

    # 3 sections per line: Montage / Pruefung / Verpackung
    section_names = ["Montage", "Pruefung", "Verpackung"]
    for line in lines:
        for seq, name in enumerate(section_names, start=1):
            sec = {
                "section_id": next_id("SEC"),
                "line_id": line["line_id"],
                "name": f"{name} {line['name']}",
                "section_type": name.lower(),
                "sequence_no": seq,
            }
            tables["section"].append(sec)
            # Capture Story 2 section: "Montage Linie 1" of Werk Augsburg
            if (line["factory_id"] == fac_augsburg["factory_id"]
                    and line["name"] == "Linie 1" and name == "Montage"):
                SECTION_MONTAGE_L1 = sec["section_id"]
            # Capture hotspot section (detection bias distractor)
            if (line["factory_id"] == fac_augsburg["factory_id"]
                    and line["name"] == "Linie 2" and name == "Pruefung"):
                SECTION_ENDPRUEFUNG_L2 = sec["section_id"]

    assert SECTION_MONTAGE_L1 is not None
    assert SECTION_ENDPRUEFUNG_L2 is not None


# ======================================================================
# 2. Articles, configurations, BOMs, part masters, BOM nodes
# ======================================================================

# Locked article IDs — Story 1 and Story 3 target the first article.
ARTICLES = [
    ("ART-00001", "Motor Controller MC-200"),
    ("ART-00002", "Sensor Unit SU-100"),
    ("ART-00003", "Power Distribution PD-300"),
    ("ART-00004", "Controller Board CB-150"),
    ("ART-00005", "Gateway Module GM-400"),
]

# Fixed part master IDs — Story targets use locked numbers.
PART_MASTERS = [
    ("PM-00001", "Kondensator 10uF 16V",       "capacitor"),
    ("PM-00002", "Kondensator 47uF 25V",       "capacitor"),
    ("PM-00003", "Widerstand 100R 0.25W",      "resistor"),
    ("PM-00004", "Widerstand 1k 0.25W",        "resistor"),
    ("PM-00005", "LED 5mm rot",                "diode"),
    ("PM-00006", "Mikrocontroller STM32F4",    "ic"),
    ("PM-00007", "Spannungsregler LM7805",     "ic"),
    ("PM-00008", "Kondensator 100uF X7R",      "capacitor"),  # STORY 1 TARGET
    ("PM-00009", "Diode Schottky SK34",        "diode"),
    ("PM-00010", "Stecker 10-pin SPH",         "connector"),
    ("PM-00011", "Gehaeuse Aluminium A200",    "housing"),
    ("PM-00012", "Schrauben M3x8 verz.",       "fastener"),
    ("PM-00013", "Waermeleitpaste WLP-G",      "consumable"),
    ("PM-00014", "Platine Basis PCB-4L",       "pcb"),
    ("PM-00015", "Widerstand 4.7k Thermal",    "resistor"),  # STORY 3 TARGET
    ("PM-00016", "Optokoppler PC817",          "ic"),
    ("PM-00017", "Relais 12V SPDT",            "relay"),
    ("PM-00018", "Sicherung Traege T1A",       "fuse"),
    ("PM-00019", "Display OLED 128x64",        "display"),
    ("PM-00020", "Tastatur-Modul 4x4",         "input"),
]

# BOM layout per article. Each BOM has 3 assemblies, each with 3-4 components.
# For MC-200 (ART-00001) we hard-wire PM-00008 at C12 (Story 1) and
# PM-00015 at R33 (Story 3).
BOM_STRUCTURES: dict[str, list[tuple[str, list[tuple[str, str]]]]] = {
    # article_id -> list of (assembly_name, [(find_number, part_number), ...])
    "ART-00001": [
        ("Steuerplatine", [
            ("U1",  "PM-00006"),  # Microcontroller
            ("C12", "PM-00008"),  # STORY 1: capacitor target
            ("R33", "PM-00015"),  # STORY 3: thermal resistor
            ("U2",  "PM-00007"),  # Voltage regulator
        ]),
        ("Leistungsstufe", [
            ("C5",  "PM-00002"),
            ("D1",  "PM-00009"),
            ("K1",  "PM-00017"),  # Relay
        ]),
        ("Gehaeuse_IO", [
            ("H1",  "PM-00011"),  # Housing
            ("J1",  "PM-00010"),  # Connector
            ("SCR", "PM-00012"),  # Screws
        ]),
    ],
    "ART-00002": [
        ("Hauptplatine", [
            ("U1",  "PM-00006"),
            ("C1",  "PM-00001"),
            ("R1",  "PM-00003"),
            ("OC1", "PM-00016"),
        ]),
        ("Sensorik", [
            ("D1",  "PM-00009"),
            ("LED", "PM-00005"),
            ("C2",  "PM-00001"),
        ]),
        ("Gehaeuse", [
            ("H1",  "PM-00011"),
            ("J1",  "PM-00010"),
            ("SCR", "PM-00012"),
        ]),
    ],
    "ART-00003": [
        ("Leistungsteil", [
            ("U1",  "PM-00007"),  # Regulator
            ("C1",  "PM-00002"),
            ("D1",  "PM-00009"),
            ("F1",  "PM-00018"),  # Fuse
        ]),
        ("Relais_Stufe", [
            ("K1",  "PM-00017"),
            ("K2",  "PM-00017"),
            ("R1",  "PM-00004"),
        ]),
        ("Gehaeuse", [
            ("H1",  "PM-00011"),
            ("J1",  "PM-00010"),
            ("SCR", "PM-00012"),
        ]),
    ],
    "ART-00004": [
        ("Hauptplatine", [
            ("U1",  "PM-00006"),
            ("C1",  "PM-00001"),
            ("R1",  "PM-00003"),
            ("PCB", "PM-00014"),
        ]),
        ("Schnittstelle", [
            ("OC1", "PM-00016"),
            ("J1",  "PM-00010"),
            ("LED", "PM-00005"),
        ]),
        ("Montage", [
            ("H1",  "PM-00011"),
            ("SCR", "PM-00012"),
            ("TIM", "PM-00013"),
        ]),
    ],
    "ART-00005": [
        ("Funkteil", [
            ("U1",  "PM-00006"),
            ("C1",  "PM-00001"),
            ("R1",  "PM-00004"),
        ]),
        ("Anzeige", [
            ("DSP", "PM-00019"),
            ("KB",  "PM-00020"),
            ("LED", "PM-00005"),
        ]),
        ("Gehaeuse", [
            ("H1",  "PM-00011"),
            ("J1",  "PM-00010"),
            ("SCR", "PM-00012"),
        ]),
    ],
}


def build_articles_and_bom() -> None:
    # Articles
    for aid, name in ARTICLES:
        tables["article"].append({"article_id": aid, "name": name})
        _counters["ART"] = max(_counters.get("ART", 0), int(aid.split("-")[1]))

    # Configurations: 2 per article (A and B revisions)
    for aid, _ in ARTICLES:
        for rev, market in [("A", "EU"), ("B", "US")]:
            cfg = {
                "configuration_id": next_id("CFG"),
                "article_id": aid,
                "configuration_code": f"{aid}-REV-{rev}",
                "title": f"Revision {rev}",
                "market": market,
                "revision": rev,
                "valid_from": date(2025, 1, 1),
                "valid_to": None,
                "notes": None,
            }
            tables["configuration"].append(cfg)

    # BOMs: 1 per article (active version)
    bom_by_article: dict[str, str] = {}
    for aid, _ in ARTICLES:
        bom_id = next_id("BOM")
        bom_by_article[aid] = bom_id
        tables["bom"].append({
            "bom_id": bom_id, "article_id": aid,
            "configuration_id": None, "bom_version": "1.0", "status": "active",
            "valid_from": date(2025, 1, 1), "valid_to": None, "notes": None,
        })

    # Part masters
    for pn, title, commodity in PART_MASTERS:
        tables["part_master"].append({
            "part_number": pn, "title": title, "commodity": commodity,
            "drawing_number": f"DWG-{pn}", "revision": "A", "uom": "pc",
            "notes": None,
        })

    # BOM nodes — two-level (assembly -> component)
    global BOM_NODE_INDEX
    BOM_NODE_INDEX = {}  # article_id -> {find_number: bom_node_id}
    global BOM_NODE_LIST_BY_ARTICLE
    BOM_NODE_LIST_BY_ARTICLE = {}  # article_id -> list of (find_number, part_number, bom_node_id)

    for aid, structure in BOM_STRUCTURES.items():
        bom_id = bom_by_article[aid]
        BOM_NODE_INDEX[aid] = {}
        BOM_NODE_LIST_BY_ARTICLE[aid] = []
        for asm_name, components in structure:
            # Assembly node
            asm_id = next_id("BN")
            tables["bom_node"].append({
                "bom_node_id": asm_id, "bom_id": bom_id,
                "parent_bom_node_id": None, "part_number": None,
                "qty": 1, "node_type": "assembly", "find_number": asm_name,
            })
            # Component nodes under assembly
            for find_number, part_number in components:
                comp_id = next_id("BN")
                tables["bom_node"].append({
                    "bom_node_id": comp_id, "bom_id": bom_id,
                    "parent_bom_node_id": asm_id,
                    "part_number": part_number,
                    "qty": 1, "node_type": "component",
                    "find_number": find_number,
                })
                BOM_NODE_INDEX[aid][find_number] = comp_id
                BOM_NODE_LIST_BY_ARTICLE[aid].append(
                    (find_number, part_number, comp_id)
                )

    # Convenience for later stages
    global BOM_BY_ARTICLE
    BOM_BY_ARTICLE = bom_by_article


# ======================================================================
# 3. Supplier batches + parts
# ======================================================================

SUPPLIERS = [
    ("SUP-01", "ElektroParts GmbH"),
    ("SUP-02", "Mechanik-Werk AG"),
    ("SUP-03", "TechSupply Europe"),
    ("SUP-04", "PartStream Industries"),
]

BATCHES_SPEC = [
    # (part_number, supplier_idx, received_date, qty, is_bad_story1)
    ("PM-00001", 0, date(2025, 9, 15), 500, False),
    ("PM-00002", 1, date(2025, 9, 20), 400, False),
    ("PM-00003", 2, date(2025, 10, 5), 600, False),
    ("PM-00004", 2, date(2025, 10, 5), 500, False),
    ("PM-00005", 3, date(2025, 10, 12), 300, False),
    ("PM-00006", 0, date(2025, 10, 15), 200, False),
    # Keep the bad PM-00008 batch in the 7th slot so it really becomes SB-00007.
    ("PM-00008", 0, STORY1_BATCH_RECEIVED, 600, True),  # STORY 1 bad batch
    ("PM-00007", 0, date(2025, 11, 1), 250, False),
    ("PM-00008", 0, date(2025, 11, 10), 800, False),   # good batch of PM-00008
    ("PM-00008", 0, date(2026, 3, 1), 400, False),     # good follow-up batch
    ("PM-00009", 3, date(2025, 11, 20), 300, False),
    ("PM-00010", 1, date(2025, 10, 8),  400, False),
    ("PM-00011", 1, date(2025, 10, 10), 250, False),
    ("PM-00012", 1, date(2025, 10, 1),  1000, False),
    ("PM-00013", 3, date(2025, 10, 15), 300, False),
    ("PM-00014", 2, date(2025, 10, 20), 300, False),
    ("PM-00015", 2, date(2025, 9, 25), 400, False),
    ("PM-00016", 2, date(2025, 10, 25), 250, False),
    ("PM-00017", 0, date(2025, 11, 5), 200, False),
    ("PM-00018", 3, date(2025, 11, 12), 300, False),
    ("PM-00019", 2, date(2025, 11, 8),  200, False),
    ("PM-00020", 3, date(2025, 11, 18), 200, False),
]

STORY1_BATCH_ID: str = ""          # SB id for bad PM-00008 batch
STORY1_PART_IDS: list[str] = []    # PART ids from that bad batch

# Map part_number -> list of "good" (batch_id, part_id) tuples for install picking
GOOD_PARTS_BY_PART_NUMBER: dict[str, list[tuple[str, str]]] = {}


def build_batches_and_parts() -> None:
    global STORY1_BATCH_ID
    for part_number, sup_idx, received, qty, is_bad in BATCHES_SPEC:
        batch_id = next_id("SB")
        sup_id, sup_name = SUPPLIERS[sup_idx]
        tables["supplier_batch"].append({
            "batch_id": batch_id,
            "part_number": part_number,
            "batch_number": f"B{batch_id[-5:]}",
            "supplier_name": sup_name,
            "supplier_id": sup_id,
            "received_date": received,
            "qty": qty,
        })
        if is_bad:
            STORY1_BATCH_ID = batch_id

        # Generate a proportional slice of N_PARTS instances for this batch.
        instances = max(30, qty // 10)
        for _ in range(instances):
            part_id = next_id("P", width=6)
            created_ts = datetime.combine(received, datetime.min.time(),
                                          tzinfo=timezone.utc) \
                         + timedelta(hours=rng.uniform(0, 72))
            quality = "hold" if is_bad and rng.random() < 0.05 else "ok"
            tables["part"].append({
                "part_id": part_id,
                "part_number": part_number,
                "batch_id": batch_id,
                "serial_number": f"SN-{part_id[-6:]}",
                "created_ts": created_ts,
                "status": "available",
                "manufacturer_name": sup_name,
                "quality_status": quality,
                "notes": None,
            })
            if is_bad:
                STORY1_PART_IDS.append(part_id)
            else:
                GOOD_PARTS_BY_PART_NUMBER.setdefault(part_number, []).append(
                    (batch_id, part_id)
                )

    assert STORY1_BATCH_ID, "Story 1 bad batch not created"
    assert len(STORY1_PART_IDS) > STORY1_TARGET_PRODUCTS

    print(f"  parts total: {len(tables['part'])} (story1 bad: {len(STORY1_PART_IDS)})")


# ======================================================================
# 4. Production orders + products
# ======================================================================

# Article distribution. MC-200 is heavy to fit Story 1 + Story 3 scope.
ARTICLE_PRODUCT_COUNTS = {
    "ART-00001": 170,  # MC-200 — Story 1 + Story 3
    "ART-00002": 90,
    "ART-00003": 90,
    "ART-00004": 80,
    "ART-00005": 70,
}
assert sum(ARTICLE_PRODUCT_COUNTS.values()) == N_PRODUCTS

STORY4_ORDER_IDS = ["PO-00012", "PO-00018", "PO-00024"]

# Product index for later generation stages
PRODUCT_ARTICLE: dict[str, str] = {}
PRODUCT_BUILD_TS: dict[str, datetime] = {}
PRODUCT_ORDER: dict[str, str] = {}
PRODUCT_SECTION_BUILT: dict[str, str] = {}  # section where final assembly happened
STORY1_PRODUCTS: list[str] = []  # MC-200 products receiving SB-00007 part
STORY2_PRODUCTS: list[str] = []  # products built at Montage Linie 1 in Dec 2025
STORY4_PRODUCTS: list[str] = []  # products on PO-00012/18/24


def build_orders_and_products() -> None:
    global STORY1_PRODUCTS, STORY2_PRODUCTS, STORY4_PRODUCTS

    # 30 production orders total. PO-00012/18/24 reserved for Story 4 and
    # pinned to MC-200 so most Story 4 candidates are also MC-200 builds.
    articles_round_robin = list(ARTICLE_PRODUCT_COUNTS.keys())
    orders: list[dict] = []
    for idx in range(1, 31):
        order_id = f"PO-{idx:05d}"
        if order_id in STORY4_ORDER_IDS:
            article_id = "ART-00001"  # Story 4 orders all on MC-200
        else:
            article_id = articles_round_robin[(idx - 1) % len(articles_round_robin)]
        planned = (DATE_START + timedelta(days=int((idx - 1) * 180 / 30))).date()
        orders.append({
            "order_id": order_id, "article_id": article_id,
            "configuration_id": None,
            "planned_date": planned,
        })
    tables["production_order"].extend(orders)
    _counters["PO"] = 30

    # Build 500 products. Assign each to a plausible order (same article).
    order_by_article: dict[str, list[str]] = {}
    for o in orders:
        order_by_article.setdefault(o["article_id"], []).append(o["order_id"])

    # Story 1: pre-select MC-200 products to receive bad-batch capacitor.
    # These products must be built AFTER SB-00007 received (Feb 3 2026).
    mc200_needed_story1 = STORY1_TARGET_PRODUCTS

    for article_id, count in ARTICLE_PRODUCT_COUNTS.items():
        order_pool = order_by_article.get(article_id) or [orders[0]["order_id"]]
        for i in range(count):
            pid = next_id("PRD")
            # Build date: spread uniformly Oct 2025 - Mar 2026 unless Story 1 subset
            if article_id == "ART-00001" and len(STORY1_PRODUCTS) < mc200_needed_story1:
                # Force build after bad-batch receipt, weeks 5-8/2026
                year, week = rng.choice([(2026, 5), (2026, 6), (2026, 7)])
                build_ts = ts_in_week(year, week)
                STORY1_PRODUCTS.append(pid)
            else:
                build_ts = rand_ts()

            # Story 4: MC-200 products get ~20% chance of landing on a
            # story4 order (PO-00012/18/24). Capped at 30 products.
            order_choice = rng.choice(order_pool)
            if (article_id == "ART-00001"
                    and len(STORY4_PRODUCTS) < 30
                    and rng.random() < 0.22):
                order_choice = rng.choice(STORY4_ORDER_IDS)
                STORY4_PRODUCTS.append(pid)

            tables["product"].append({
                "product_id": pid,
                "article_id": article_id,
                "configuration_id": None,
                "bom_id": BOM_BY_ARTICLE[article_id],
                "order_id": order_choice,
                "build_ts": build_ts,
            })
            PRODUCT_ARTICLE[pid] = article_id
            PRODUCT_BUILD_TS[pid] = build_ts
            PRODUCT_ORDER[pid] = order_choice

            # Story 2: assign "built at Montage Linie 1" flag for Dec 2025 products
            iso_year, iso_week, _ = build_ts.isocalendar()
            if ((iso_year, iso_week) in STORY2_WEEKS
                    and rng.random() < 0.5):
                STORY2_PRODUCTS.append(pid)
                PRODUCT_SECTION_BUILT[pid] = SECTION_MONTAGE_L1
            else:
                # Assign a random assembly section
                assembly_sections = [
                    s["section_id"] for s in tables["section"]
                    if s["section_type"] == "montage"
                ]
                PRODUCT_SECTION_BUILT[pid] = rng.choice(assembly_sections)

    print(f"  products: {len(tables['product'])}, "
          f"story1={len(STORY1_PRODUCTS)}, "
          f"story2={len(STORY2_PRODUCTS)}, "
          f"story4={len(STORY4_PRODUCTS)}")


# ======================================================================
# 5. Product part installs
# ======================================================================

# Track which parts are installed in each product (for defect FK consistency)
PRODUCT_INSTALLED_PARTS: dict[str, list[tuple[str, str, str, str]]] = {}
# product_id -> list of (part_number, part_id, bom_node_id, find_number)


def build_product_part_installs() -> None:
    for product in tables["product"]:
        pid = product["product_id"]
        article_id = product["article_id"]
        build_ts = product["build_ts"]

        nodes = BOM_NODE_LIST_BY_ARTICLE[article_id]
        # Sample up to N_PPI_PER_PRODUCT key component nodes (skip assemblies)
        node_sample = nodes[:N_PPI_PER_PRODUCT]  # deterministic by article

        PRODUCT_INSTALLED_PARTS[pid] = []

        for find_number, part_number, bom_node_id in node_sample:
            # Story 1 override: MC-200 flagged products get bad batch at C12
            if (pid in STORY1_PRODUCTS
                    and article_id == "ART-00001"
                    and find_number == "C12"):
                bad_part_id = STORY1_PART_IDS.pop()
                chosen_part_id = bad_part_id
            else:
                # Pick a "good" part of the right part_number
                pool = GOOD_PARTS_BY_PART_NUMBER.get(part_number)
                if not pool:
                    # Fallback: any part of that number (including bad batch
                    # if nothing else exists). Shouldn't happen given batch qty.
                    pool = [(p["batch_id"], p["part_id"])
                            for p in tables["part"]
                            if p["part_number"] == part_number]
                if not pool:
                    continue
                _, chosen_part_id = rng.choice(pool)

            installed_ts = build_ts + timedelta(minutes=rng.uniform(0, 120))
            section_id = PRODUCT_SECTION_BUILT[pid]
            is_story4 = pid in STORY4_PRODUCTS
            user_id = USER_STORY4 if is_story4 else rng.choice(USER_IDS_NORMAL)
            tables["product_part_install"].append({
                "install_id": next_id("PPI", width=6),
                "product_id": pid,
                "part_id": chosen_part_id,
                "bom_node_id": bom_node_id,
                "installed_section_id": section_id,
                "qty": 1,
                "position_code": find_number,
                "installed_ts": installed_ts,
                "user_id": user_id,
            })
            PRODUCT_INSTALLED_PARTS[pid].append(
                (part_number, chosen_part_id, bom_node_id, find_number)
            )


# ======================================================================
# 6. Tests + test results
# ======================================================================

TESTS_SPEC = [
    # (test_key, title, test_type, part_target, lower, upper, section_type)
    ("ESR_TEST",      "ESR-Messung Kondensator", "electrical", "PM-00008", 0.0, 0.5, "pruefung"),
    ("VIB_TEST",      "Vibrationstest",          "mechanical", None,       0.0, 3.5, "pruefung"),
    ("THERMAL_TEST",  "Thermische Kurzpruefung", "thermal",    None,       20.0, 85.0, "pruefung"),
    ("FUNC_TEST",     "Funktionstest EOL",       "functional", None,       None, None, "pruefung"),
    ("VISUAL_CHECK",  "Sichtpruefung",           "visual",     None,       None, None, "pruefung"),
    ("DIM_CHECK",     "Dimensionspruefung",      "mechanical", None,       0.0, 1.0, "pruefung"),
    ("ELEC_BASELINE", "Elektrische Basismessung","electrical", None,       4.8, 5.2, "pruefung"),
    ("LABEL_CHECK",   "Label + SN Kontrolle",    "visual",     None,       None, None, "verpackung"),
]

TEST_BY_KEY: dict[str, str] = {}


def build_tests() -> None:
    # pick a default pruefung section per line-type for test definitions
    pruefung_sections = [s for s in tables["section"]
                         if s["section_type"] == "pruefung"]
    verpackung_sections = [s for s in tables["section"]
                           if s["section_type"] == "verpackung"]

    for key, title, ttype, part_target, low, high, section_type in TESTS_SPEC:
        sec_pool = (verpackung_sections if section_type == "verpackung"
                    else pruefung_sections)
        sec_id = sec_pool[0]["section_id"] if sec_pool else None
        test_id = next_id("TST")
        TEST_BY_KEY[key] = test_id
        tables["test"].append({
            "test_id": test_id,
            "section_id": sec_id,
            "part_number": part_target,
            "title": title,
            "test_location": title,
            "test_type": ttype,
            "lower_limit": low,
            "upper_limit": high,
            "image_url": None,
            "notes": None,
        })


def pass_rate_for(product_id: str, test_key: str) -> tuple[str, float | None, str | None]:
    """Decide test outcome for (product, test). Returns (overall_result, value, unit)."""
    # Default: 85 pass / 10 marginal / 5 OOL
    roll = rng.random()
    # Story 1: ESR_TEST on Story 1 products shifts toward marginal/OOL
    if test_key == "ESR_TEST" and product_id in STORY1_PRODUCTS:
        if roll < 0.45:
            val = rng.uniform(0.35, 0.49)
            return ("MARGINAL", val, "Ohm")
        else:
            val = rng.uniform(0.51, 0.75)
            return ("FAIL", val, "Ohm")
    # Story 2: VIB_TEST on Story 2 products shifts toward OOL
    if test_key == "VIB_TEST" and product_id in STORY2_PRODUCTS:
        if roll < 0.35:
            val = rng.uniform(3.2, 3.49)
            return ("MARGINAL", val, "g")
        elif roll < 0.75:
            val = rng.uniform(3.6, 4.8)
            return ("FAIL", val, "g")
        else:
            val = rng.uniform(1.0, 3.0)
            return ("PASS", val, "g")
    # Baseline
    if roll < 0.85:
        return ("PASS", _test_value(test_key, "pass"), _test_unit(test_key))
    elif roll < 0.95:
        return ("MARGINAL", _test_value(test_key, "marginal"), _test_unit(test_key))
    else:
        return ("FAIL", _test_value(test_key, "fail"), _test_unit(test_key))


def _test_value(test_key: str, band: str) -> float | None:
    if test_key == "ESR_TEST":
        return {"pass": rng.uniform(0.05, 0.3),
                "marginal": rng.uniform(0.35, 0.49),
                "fail": rng.uniform(0.51, 0.8)}[band]
    if test_key == "VIB_TEST":
        return {"pass": rng.uniform(0.5, 3.0),
                "marginal": rng.uniform(3.2, 3.49),
                "fail": rng.uniform(3.6, 4.8)}[band]
    if test_key == "THERMAL_TEST":
        return {"pass": rng.uniform(35, 70),
                "marginal": rng.uniform(78, 84),
                "fail": rng.uniform(86, 95)}[band]
    if test_key == "ELEC_BASELINE":
        return {"pass": rng.uniform(4.9, 5.1),
                "marginal": rng.uniform(4.82, 4.88),
                "fail": rng.uniform(4.5, 4.79)}[band]
    if test_key == "DIM_CHECK":
        return {"pass": rng.uniform(0.1, 0.8),
                "marginal": rng.uniform(0.9, 0.99),
                "fail": rng.uniform(1.01, 1.2)}[band]
    return None


def _test_unit(test_key: str) -> str | None:
    return {"ESR_TEST": "Ohm", "VIB_TEST": "g", "THERMAL_TEST": "C",
            "ELEC_BASELINE": "V", "DIM_CHECK": "mm"}.get(test_key)


# test_result index by product (needed later for DEFECT.detected_test_result_id)
TEST_RESULT_INDEX: dict[tuple[str, str], str] = {}  # (product_id, test_key) -> test_result_id


def build_test_results() -> None:
    pruefung_sections = [s for s in tables["section"]
                         if s["section_type"] == "pruefung"]

    # Each product gets 4 tests chosen from the catalog. Plus optionally
    # ESR_TEST and VIB_TEST for story-related products to guarantee signal.
    test_keys_general = ["THERMAL_TEST", "FUNC_TEST", "VISUAL_CHECK",
                         "ELEC_BASELINE", "DIM_CHECK", "LABEL_CHECK"]

    count = 0
    for product in tables["product"]:
        pid = product["product_id"]
        build_ts = product["build_ts"]
        per_product_tests: list[str] = []

        # All MC-200 get ESR_TEST (Story 1 signal)
        if product["article_id"] == "ART-00001":
            per_product_tests.append("ESR_TEST")
        # Story 2 candidates get VIB_TEST
        if pid in STORY2_PRODUCTS:
            per_product_tests.append("VIB_TEST")
        # Fill to 4 tests
        while len(per_product_tests) < 4:
            choice = rng.choice(test_keys_general)
            if choice not in per_product_tests:
                per_product_tests.append(choice)

        for key in per_product_tests:
            test_id = TEST_BY_KEY[key]
            test_ts = build_ts + timedelta(minutes=rng.uniform(60, 720))
            overall, val, unit = pass_rate_for(pid, key)
            section_id = rng.choice(pruefung_sections)["section_id"]
            tr_id = next_id("TR", width=6)
            tables["test_result"].append({
                "test_result_id": tr_id,
                "test_run_id": f"RUN-{pid[-5:]}-{key}",
                "test_id": test_id,
                "product_id": pid,
                "section_id": section_id,
                "ts": test_ts,
                "test_time_ms": rng.randint(500, 30000),
                "overall_result": overall,
                "test_key": key,
                "test_value": str(val) if val is not None else None,
                "unit": unit,
                "notes": None,
            })
            TEST_RESULT_INDEX[(pid, key)] = tr_id
            count += 1
            if count >= N_TEST_RESULTS:
                break
        if count >= N_TEST_RESULTS:
            break

    print(f"  test_results: {count}")


# ======================================================================
# 7. Defects
# ======================================================================

# Track products that already have a defect (avoid too much piling)
PRODUCTS_WITH_DEFECTS: set[str] = set()
DEFECTS_BY_PRODUCT: dict[str, list[str]] = {}  # product_id -> [defect_id]


def pick_installed_part(pid: str, wanted_pn: str | None = None) -> tuple[str, str] | None:
    """Pick an (part_number, bom_node_id) that is actually installed in pid."""
    installs = PRODUCT_INSTALLED_PARTS.get(pid, [])
    if not installs:
        return None
    if wanted_pn:
        candidates = [(pn, bn) for pn, _pid, bn, _fn in installs if pn == wanted_pn]
        if candidates:
            return rng.choice(candidates)
    pn, _pid, bn, _fn = rng.choice(installs)
    return (pn, bn)


def image_url_for_severity(severity: str, defect_code: str) -> str | None:
    if severity not in ("high", "critical"):
        return None
    # Map defect code to image filename (best-effort)
    mapping = {
        "SOLDER_COLD": "defect_01_cold_solder.jpg",
        "COLD_JOINT":  "defect_01_cold_solder.jpg",
        "VISUAL_CRACK": "defect_02_housing_crack.jpg",
        "HAIRLINE":     "defect_02_housing_crack.jpg",
        "BURNED":       "defect_03_burnt_resistor.jpg",
        "POLARITY":     "defect_04_bent_pin.jpg",
        "MISSING_PART": "defect_05_loose_wire.jpg",
        "CORROSION":    "defect_06_corrosion.jpg",
        "DIM_OOL":      "defect_07_misalignment.jpg",
        "THERMAL_DRIFT":"defect_08_bulging_cap.jpg",
        "FUNC_FAIL":    "defect_09_lens_scratch.jpg",
        "WRONG_PART":   "defect_10_debris.jpg",
        "LABEL_MISALIGN":"defect_11_bad_label.jpg",
        "TEST_OOL":     "defect_12_lifted_pad.jpg",
        "VISUAL_SCRATCH":"defect_02_housing_crack.jpg",
        "VIB_FAIL":     "defect_12_lifted_pad.jpg",
    }
    fname = mapping.get(defect_code, "defect_01_cold_solder.jpg")
    return f"{IMAGE_PATH_PREFIX}/{fname}"


def build_defects() -> None:
    # ---- Story 1: ~25 SOLDER_COLD on PM-00008, weeks 5-6/2026 ----
    story1_pool = [p for p in STORY1_PRODUCTS]
    rng.shuffle(story1_pool)
    for pid in story1_pool[:STORY1_DEFECTS]:
        picked = pick_installed_part(pid, wanted_pn="PM-00008")
        if not picked:
            continue
        pn, bn = picked
        week_year, week = rng.choice(STORY1_DEFECT_WEEKS)
        ts = ts_in_week(week_year, week)
        severity = rng.choices(["high", "critical", "medium"], weights=[5, 2, 1])[0]
        defect_id = next_id("DEF")
        defect_code = "SOLDER_COLD"
        tables["defect"].append({
            "defect_id": defect_id,
            "product_id": pid, "ts": ts,
            "source_type": "incoming_inspection",
            "defect_code": defect_code,
            "severity": severity,
            "detected_section_id": SECTION_ENDPRUEFUNG_L2,
            "occurrence_section_id": PRODUCT_SECTION_BUILT.get(pid),
            "detected_test_result_id": TEST_RESULT_INDEX.get((pid, "ESR_TEST")),
            "reported_part_number": pn,
            "image_url": image_url_for_severity(severity, defect_code),
            "cost": round(rng.uniform(50, 280), 2),
            "notes": defects_bank.take("story1_supplier"),
        })
        PRODUCTS_WITH_DEFECTS.add(pid)
        DEFECTS_BY_PRODUCT.setdefault(pid, []).append(defect_id)

    # ---- Story 2: ~20 VIB_FAIL at Montage L1, weeks 49-52/2025 ----
    story2_pool = list(STORY2_PRODUCTS)
    rng.shuffle(story2_pool)
    for pid in story2_pool[:STORY2_DEFECTS]:
        week_year, week = rng.choice(STORY2_WEEKS)
        ts = ts_in_week(week_year, week)
        severity = rng.choices(["medium", "high"], weights=[3, 2])[0]
        defect_id = next_id("DEF")
        defect_code = "VIB_FAIL"
        # reported part: a screw-related part if available
        picked = pick_installed_part(pid, wanted_pn="PM-00012")
        pn = picked[0] if picked else None
        tables["defect"].append({
            "defect_id": defect_id,
            "product_id": pid, "ts": ts,
            "source_type": "end_of_line_test",
            "defect_code": defect_code,
            "severity": severity,
            "detected_section_id": SECTION_ENDPRUEFUNG_L2,
            "occurrence_section_id": SECTION_MONTAGE_L1,
            "detected_test_result_id": TEST_RESULT_INDEX.get((pid, "VIB_TEST")),
            "reported_part_number": pn,
            "image_url": image_url_for_severity(severity, defect_code),
            "cost": round(rng.uniform(40, 180), 2),
            "notes": defects_bank.take("story2_calibration"),
        })
        PRODUCTS_WITH_DEFECTS.add(pid)
        DEFECTS_BY_PRODUCT.setdefault(pid, []).append(defect_id)

    # ---- Story 4: ~15 VISUAL_SCRATCH / LABEL_MISALIGN on PO-00012/18/24 ----
    story4_pool = [p for p in STORY4_PRODUCTS]
    rng.shuffle(story4_pool)
    for pid in story4_pool[:STORY4_DEFECTS]:
        defect_code = rng.choice(["VISUAL_SCRATCH", "LABEL_MISALIGN"])
        ts = PRODUCT_BUILD_TS[pid] + timedelta(hours=rng.uniform(1, 48))
        severity = "low"
        defect_id = next_id("DEF")
        picked = pick_installed_part(pid, wanted_pn="PM-00011")
        pn = picked[0] if picked else None
        tables["defect"].append({
            "defect_id": defect_id,
            "product_id": pid, "ts": ts,
            "source_type": "visual_inspection",
            "defect_code": defect_code,
            "severity": severity,
            "detected_section_id": SECTION_ENDPRUEFUNG_L2,
            "occurrence_section_id": PRODUCT_SECTION_BUILT.get(pid),
            "detected_test_result_id": None,
            "reported_part_number": pn,
            "image_url": None,  # low severity — no image
            "cost": round(rng.uniform(5, 40), 2),
            "notes": defects_bank.take("story4_operator"),
        })
        PRODUCTS_WITH_DEFECTS.add(pid)
        DEFECTS_BY_PRODUCT.setdefault(pid, []).append(defect_id)

    # ---- False positives: ~10 low-severity overturned defects ----
    fp_pool = [p["product_id"] for p in tables["product"]
               if p["product_id"] not in PRODUCTS_WITH_DEFECTS]
    rng.shuffle(fp_pool)
    for pid in fp_pool[:FALSE_POSITIVE_DEFECTS]:
        ts = PRODUCT_BUILD_TS[pid] + timedelta(hours=rng.uniform(1, 24))
        defect_code = rng.choice(["VISUAL_SCRATCH", "LABEL_MISALIGN"])
        defect_id = next_id("DEF")
        picked = pick_installed_part(pid)
        pn = picked[0] if picked else None
        tables["defect"].append({
            "defect_id": defect_id,
            "product_id": pid, "ts": ts,
            "source_type": "visual_inspection",
            "defect_code": defect_code,
            "severity": "low",
            "detected_section_id": SECTION_ENDPRUEFUNG_L2,
            "occurrence_section_id": PRODUCT_SECTION_BUILT.get(pid),
            "detected_test_result_id": None,
            "reported_part_number": pn,
            "image_url": None,
            "cost": 0,
            "notes": "bei Nachpruefung nicht bestaetigt — false positive, Produkt i.O.",
        })
        PRODUCTS_WITH_DEFECTS.add(pid)
        DEFECTS_BY_PRODUCT.setdefault(pid, []).append(defect_id)

    # ---- Background defects: Pareto-distributed up to N_DEFECTS ----
    remaining = N_DEFECTS - len(tables["defect"])
    all_products = [p["product_id"] for p in tables["product"]]
    # Hotspot: 40% of defects detected at SECTION_ENDPRUEFUNG_L2
    for _ in range(remaining):
        pid = rng.choice(all_products)
        # Pareto: top 3 codes account for ~70%
        if rng.random() < 0.70:
            defect_code = rng.choice(DEFECT_CODES_TOP)
        else:
            defect_code = rng.choice(DEFECT_CODES_BACKGROUND)
        build_ts = PRODUCT_BUILD_TS[pid]
        ts = build_ts + timedelta(hours=rng.uniform(1, 240))
        severity = rng.choices(["low", "medium", "high", "critical"],
                               weights=[4, 5, 3, 1])[0]
        detected = (SECTION_ENDPRUEFUNG_L2 if rng.random() < 0.40
                    else rng.choice(tables["section"])["section_id"])
        picked = pick_installed_part(pid)
        pn = picked[0] if picked else None
        defect_id = next_id("DEF")
        tables["defect"].append({
            "defect_id": defect_id,
            "product_id": pid, "ts": ts,
            "source_type": rng.choice(["visual_inspection", "end_of_line_test",
                                       "incoming_inspection"]),
            "defect_code": defect_code,
            "severity": severity,
            "detected_section_id": detected,
            "occurrence_section_id": PRODUCT_SECTION_BUILT.get(pid),
            "detected_test_result_id": None,
            "reported_part_number": pn,
            "image_url": image_url_for_severity(severity, defect_code),
            "cost": round(rng.uniform(10, 250), 2),
            "notes": defects_bank.take("background"),
        })
        DEFECTS_BY_PRODUCT.setdefault(pid, []).append(defect_id)

    print(f"  defects: {len(tables['defect'])}")


# ======================================================================
# 8. Field claims
# ======================================================================

def build_field_claims() -> None:
    # Story 1: ~12 claims Mar 2026 on Story 1 products, lag 4-8 weeks
    story1_products = [p for p in STORY1_PRODUCTS]
    rng.shuffle(story1_products)
    for pid in story1_products[:STORY1_CLAIMS]:
        build_ts = PRODUCT_BUILD_TS[pid]
        claim_ts = build_ts + timedelta(weeks=rng.randint(4, 8))
        picked = pick_installed_part(pid, wanted_pn="PM-00008")
        pn = picked[0] if picked else None
        mapped_defect = None
        if pid in DEFECTS_BY_PRODUCT:
            # Link to SOLDER_COLD defect if present
            for did in DEFECTS_BY_PRODUCT[pid]:
                d = next(d for d in tables["defect"] if d["defect_id"] == did)
                if d["defect_code"] == "SOLDER_COLD":
                    mapped_defect = did
                    break
        fc_id = next_id("FC")
        tables["field_claim"].append({
            "field_claim_id": fc_id,
            "product_id": pid,
            "claim_ts": claim_ts,
            "market": rng.choice(["DE", "FR", "IT", "NL", "US"]),
            "complaint_text": claims_bank.take("story1_supplier"),
            "reported_part_number": pn,
            "image_url": f"{IMAGE_PATH_PREFIX}/defect_08_bulging_cap.jpg",
            "cost": round(rng.uniform(200, 1500), 2),
            "detected_section_id": None,
            "mapped_defect_id": mapped_defect,
            "notes": None,
        })

    # Story 3: ~15 claims on MC-200, lag 8-12 weeks, no in-factory defect
    mc200_products = [pid for pid, aid in PRODUCT_ARTICLE.items()
                      if aid == "ART-00001"
                      and pid not in STORY1_PRODUCTS]
    rng.shuffle(mc200_products)
    for pid in mc200_products[:STORY3_CLAIMS]:
        build_ts = PRODUCT_BUILD_TS[pid]
        claim_ts = build_ts + timedelta(weeks=rng.randint(8, 12))
        # Only include claims that land Jan-Mar 2026
        if not (datetime(2026, 1, 1, tzinfo=timezone.utc) <= claim_ts <= DATE_END):
            continue
        picked = pick_installed_part(pid, wanted_pn="PM-00015")
        pn = picked[0] if picked else None
        fc_id = next_id("FC")
        tables["field_claim"].append({
            "field_claim_id": fc_id,
            "product_id": pid,
            "claim_ts": claim_ts,
            "market": rng.choice(["DE", "FR", "IT", "ES", "PL"]),
            "complaint_text": claims_bank.take("story3_thermal"),
            "reported_part_number": pn,
            "image_url": f"{IMAGE_PATH_PREFIX}/defect_03_burnt_resistor.jpg",
            "cost": round(rng.uniform(300, 2000), 2),
            "detected_section_id": None,
            "mapped_defect_id": None,  # no in-factory defect for Story 3
            "notes": None,
        })

    # Background claims up to N_FIELD_CLAIMS
    remaining = N_FIELD_CLAIMS - len(tables["field_claim"])
    all_products = [p["product_id"] for p in tables["product"]]
    rng.shuffle(all_products)
    for pid in all_products[:remaining * 3]:
        if len(tables["field_claim"]) >= N_FIELD_CLAIMS:
            break
        build_ts = PRODUCT_BUILD_TS[pid]
        claim_ts = build_ts + timedelta(weeks=rng.randint(2, 16))
        if claim_ts > DATE_END:
            continue
        picked = pick_installed_part(pid)
        pn = picked[0] if picked else None
        fc_id = next_id("FC")
        tables["field_claim"].append({
            "field_claim_id": fc_id,
            "product_id": pid,
            "claim_ts": claim_ts,
            "market": rng.choice(["DE", "FR", "IT", "US", "UK"]),
            "complaint_text": claims_bank.take("background"),
            "reported_part_number": pn,
            "image_url": None,
            "cost": round(rng.uniform(100, 1200), 2),
            "detected_section_id": None,
            "mapped_defect_id": None,
            "notes": None,
        })

    print(f"  field_claims: {len(tables['field_claim'])}")


# ======================================================================
# 9. Rework
# ======================================================================

def build_reworks() -> None:
    # Rework most defects except the false positives (those were overturned)
    rework_count = 0
    for defect in tables["defect"]:
        if defect["notes"] and "false positive" in defect["notes"]:
            continue
        if rework_count >= N_REWORKS:
            break
        pid = defect["product_id"]
        ts = defect["ts"] + timedelta(hours=rng.uniform(1, 48))
        code = defect["defect_code"]

        # Pick text tag + user based on story
        if code == "SOLDER_COLD" and defect["reported_part_number"] == "PM-00008":
            tag = "story1_supplier"
        elif code == "VIB_FAIL":
            tag = "story2_calibration"
        else:
            tag = "background"
        is_story4 = pid in STORY4_PRODUCTS
        user_id = USER_STORY4 if is_story4 else rng.choice(USER_IDS_NORMAL)

        tables["rework"].append({
            "rework_id": next_id("RW"),
            "defect_id": defect["defect_id"],
            "product_id": pid,
            "ts": ts,
            "rework_section_id": defect["occurrence_section_id"],
            "action_text": rework_bank.take(tag),
            "reported_part_number": defect["reported_part_number"],
            "user_id": user_id,
            "image_url": None,
            "time_minutes": rng.randint(5, 90),
            "cost": round(rng.uniform(15, 120), 2),
        })
        rework_count += 1

    print(f"  reworks: {len(tables['rework'])}")


# ======================================================================
# 10. Product actions
# ======================================================================

def build_product_actions() -> None:
    # 50 seeded actions mixed open / in-progress / done
    defects = tables["defect"][:]
    rng.shuffle(defects)
    for i in range(N_PRODUCT_ACTIONS):  # noqa: B007 - index used below
        defect = defects[i % len(defects)]
        pid = defect["product_id"]
        ts = defect["ts"] + timedelta(days=rng.uniform(0, 14))
        status = rng.choices(["open", "in_progress", "done"], weights=[2, 2, 3])[0]
        is_story4 = pid in STORY4_PRODUCTS
        user_id = USER_STORY4 if is_story4 else rng.choice(USER_IDS_NORMAL)
        tables["product_action"].append({
            "action_id": next_id("PA"),
            "product_id": pid,
            "ts": ts,
            "action_type": rng.choice(["investigate", "initiate_8d",
                                       "containment", "corrective",
                                       "preventive"]),
            "status": status,
            "user_id": user_id,
            "section_id": defect.get("detected_section_id"),
            "comments": rng.choice([
                "Initiative eroeffnet, Team benachrichtigt.",
                "Zwischenstand: Ursachensuche laeuft.",
                "Massnahme definiert, Umsetzung geplant.",
                "Abschluss dokumentiert, Wirksamkeit zu pruefen.",
                "Wartet auf Freigabe Qualitaetsmanagement.",
                None,
            ]),
            "defect_id": defect["defect_id"],
        })

    print(f"  product_actions: {len(tables['product_action'])}")


# ======================================================================
# Emit seed.sql
# ======================================================================

ORDER = [
    "factory", "line", "section", "article", "configuration", "bom",
    "part_master", "bom_node", "supplier_batch", "part",
    "production_order", "product", "product_part_install",
    "test", "test_result",
    "defect", "field_claim", "rework", "product_action",
]


def emit_sql() -> None:
    SEED_FILE.parent.mkdir(parents=True, exist_ok=True)
    with SEED_FILE.open("w", encoding="utf-8") as f:
        f.write("-- Auto-generated by data-generation/generate.py\n")
        f.write(f"-- {datetime.now(timezone.utc).isoformat()}\n")
        f.write("-- Deterministic RNG seed: %d\n" % RNG_SEED)
        f.write("\nBEGIN;\n\n")
        for table in ORDER:
            rows = tables[table]
            f.write(f"-- {table}: {len(rows)} rows\n")
            f.write(insert_rows(table, rows))
            f.write("\n\n")
        f.write("COMMIT;\n")
    total = sum(len(v) for v in tables.values())
    print(f"\nwrote {SEED_FILE} ({total} rows)")


# ======================================================================
# Main
# ======================================================================

def main() -> int:
    print("generating seed data...")
    build_factories()
    build_articles_and_bom()
    build_batches_and_parts()
    build_orders_and_products()
    build_product_part_installs()
    build_tests()
    build_test_results()
    build_defects()
    build_field_claims()
    build_reworks()
    build_product_actions()
    emit_sql()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
