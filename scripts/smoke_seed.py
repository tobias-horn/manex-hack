#!/usr/bin/env python3
"""Lightweight smoke test for the provided seed.sql dataset.

This avoids needing a running Postgres/Docker stack just to validate that the
checked-in seed data still contains the documented stories and basic row counts.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path


INSERT_RE = re.compile(
    r"INSERT INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*?)\)\s*VALUES\s*(.*?);(?=\n\n|\n-- |\Z)",
    re.DOTALL,
)


def split_rows(values_blob: str) -> list[str]:
    rows: list[str] = []
    start: int | None = None
    depth = 0
    in_string = False
    i = 0

    while i < len(values_blob):
        ch = values_blob[i]
        nxt = values_blob[i + 1] if i + 1 < len(values_blob) else ""

        if in_string:
            if ch == "'" and nxt == "'":
                i += 2
                continue
            if ch == "'":
                in_string = False
            i += 1
            continue

        if ch == "'":
            in_string = True
        elif ch == "(":
            if depth == 0:
                start = i + 1
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0 and start is not None:
                rows.append(values_blob[start:i])
                start = None
        i += 1

    return rows


def split_fields(row_blob: str) -> list[str]:
    fields: list[str] = []
    start = 0
    in_string = False
    i = 0

    while i < len(row_blob):
        ch = row_blob[i]
        nxt = row_blob[i + 1] if i + 1 < len(row_blob) else ""

        if in_string:
            if ch == "'" and nxt == "'":
                i += 2
                continue
            if ch == "'":
                in_string = False
            i += 1
            continue

        if ch == "'":
            in_string = True
        elif ch == ",":
            fields.append(row_blob[start:i].strip())
            start = i + 1
        i += 1

    fields.append(row_blob[start:].strip())
    return fields


def decode_value(token: str):
    if token == "NULL":
        return None
    if token.startswith("'") and token.endswith("'"):
        return token[1:-1].replace("''", "'")
    if re.fullmatch(r"-?\d+", token):
        return int(token)
    if re.fullmatch(r"-?\d+\.\d+", token):
        return float(token)
    return token


def load_seed_into_sqlite(seed_path: Path) -> sqlite3.Connection:
    text = seed_path.read_text(encoding="utf-8")
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row

    for table, columns_blob, values_blob in INSERT_RE.findall(text):
        columns = [col.strip() for col in columns_blob.split(",")]
        rows = [tuple(decode_value(token) for token in split_fields(row)) for row in split_rows(values_blob)]
        quoted_columns = ", ".join(f'"{col}" TEXT' for col in columns)
        conn.execute(f'CREATE TABLE IF NOT EXISTS "{table}" ({quoted_columns})')
        placeholders = ", ".join("?" for _ in columns)
        conn.executemany(
            f'INSERT INTO "{table}" ({", ".join(f"""\"{col}\"""" for col in columns)}) VALUES ({placeholders})',
            rows,
        )

    return conn


class SmokeTester:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.pass_count = 0
        self.fail_count = 0

    def scalar(self, sql: str):
        return self.conn.execute(sql).fetchone()[0]

    def check_eq(self, label: str, sql: str, expected):
        actual = self.scalar(sql)
        if actual == expected:
            print(f"PASS {label}: got {actual}")
            self.pass_count += 1
        else:
            print(f"FAIL {label}: got {actual}, want {expected}")
            self.fail_count += 1

    def check_ge(self, label: str, sql: str, threshold: int):
        actual = self.scalar(sql)
        if isinstance(actual, (int, float)) and actual >= threshold:
            print(f"PASS {label}: got {actual}, >= {threshold}")
            self.pass_count += 1
        else:
            print(f"FAIL {label}: got {actual}, want >= {threshold}")
            self.fail_count += 1

    def finish(self) -> int:
        total = self.pass_count + self.fail_count
        print()
        if self.fail_count:
            print(f"{self.fail_count} of {total} checks failed")
            return 1
        print(f"all {total} checks passed")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test supabase/seed.sql without Docker")
    parser.add_argument(
        "--seed",
        default="supabase/seed.sql",
        help="Path to the seed SQL file (default: supabase/seed.sql)",
    )
    args = parser.parse_args()

    seed_path = Path(args.seed).resolve()
    if not seed_path.exists():
        print(f"seed file not found: {seed_path}", file=sys.stderr)
        return 2

    conn = load_seed_into_sqlite(seed_path)
    tester = SmokeTester(conn)

    print(f"Loaded seed data from {seed_path}")
    print("== Row counts")
    tester.check_ge("factory rows", "SELECT count(*) FROM factory", 2)
    tester.check_ge("line rows", "SELECT count(*) FROM line", 4)
    tester.check_ge("section rows", "SELECT count(*) FROM section", 12)
    tester.check_ge("article rows", "SELECT count(*) FROM article", 5)
    tester.check_ge("bom_node rows", "SELECT count(*) FROM bom_node", 50)
    tester.check_ge("part rows", "SELECT count(*) FROM part", 500)
    tester.check_ge("product rows", "SELECT count(*) FROM product", 500)
    tester.check_ge("product_part_install rows", "SELECT count(*) FROM product_part_install", 2500)
    tester.check_ge("test_result rows", "SELECT count(*) FROM test_result", 1500)
    tester.check_ge("defect rows", "SELECT count(*) FROM defect", 140)
    tester.check_ge("field_claim rows", "SELECT count(*) FROM field_claim", 35)
    tester.check_ge("rework rows", "SELECT count(*) FROM rework", 100)
    tester.check_ge("product_action rows", "SELECT count(*) FROM product_action", 45)

    print("== Referential integrity")
    tester.check_eq(
        "defect reported part exists on same product",
        """
        SELECT count(*)
        FROM defect d
        WHERE d.reported_part_number IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM product_part_install ppi
            JOIN part p ON ppi.part_id = p.part_id
            WHERE ppi.product_id = d.product_id
              AND p.part_number = d.reported_part_number
          )
        """,
        0,
    )
    tester.check_eq(
        "field claim mapped_defect references an existing defect",
        """
        SELECT count(*)
        FROM field_claim fc
        WHERE fc.mapped_defect_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM defect d WHERE d.defect_id = fc.mapped_defect_id
          )
        """,
        0,
    )
    tester.check_eq(
        "rework rows attach to a real defect",
        """
        SELECT count(*)
        FROM rework r
        WHERE NOT EXISTS (
          SELECT 1 FROM defect d WHERE d.defect_id = r.defect_id
        )
        """,
        0,
    )

    print("== Story signatures")
    tester.check_ge(
        "supplier batch SB-00007 installed in products",
        """
        SELECT count(DISTINCT ppi.product_id)
        FROM product_part_install ppi
        JOIN part p ON ppi.part_id = p.part_id
        WHERE p.batch_id = 'SB-00007'
        """,
        25,
    )
    tester.check_ge(
        "SOLDER_COLD defects on PM-00008",
        """
        SELECT count(*)
        FROM defect
        WHERE defect_code = 'SOLDER_COLD' AND reported_part_number = 'PM-00008'
        """,
        20,
    )
    tester.check_ge(
        "VIB_FAIL defects in Dec 2025",
        """
        SELECT count(*)
        FROM defect
        WHERE defect_code = 'VIB_FAIL'
          AND ts >= '2025-12-01'
          AND ts < '2026-01-01'
        """,
        15,
    )
    tester.check_ge(
        "MC-200 field claims in Jan-Mar 2026",
        """
        SELECT count(*)
        FROM field_claim fc
        JOIN product p ON fc.product_id = p.product_id
        WHERE p.article_id = 'ART-00001'
          AND fc.claim_ts >= '2026-01-01'
          AND fc.claim_ts < '2026-04-01'
        """,
        8,
    )
    tester.check_ge(
        "field claims referencing PM-00015",
        """
        SELECT count(*)
        FROM field_claim
        WHERE reported_part_number = 'PM-00015'
        """,
        5,
    )
    tester.check_ge(
        "story 4 defects on PO-00012/18/24",
        """
        SELECT count(*)
        FROM defect d
        JOIN product p ON d.product_id = p.product_id
        WHERE p.order_id IN ('PO-00012', 'PO-00018', 'PO-00024')
        """,
        10,
    )
    tester.check_ge(
        "story 4 rework by user_042",
        """
        SELECT count(*)
        FROM rework r
        JOIN product p ON r.product_id = p.product_id
        WHERE r.user_id = 'user_042'
          AND p.order_id IN ('PO-00012', 'PO-00018', 'PO-00024')
        """,
        8,
    )

    print("== Noise and assets")
    tester.check_ge(
        "false positive low-severity defects",
        """
        SELECT count(*)
        FROM defect
        WHERE severity = 'low' AND lower(notes) LIKE '%false positive%'
        """,
        8,
    )
    tester.check_ge(
        "defects detected in Pruefung sections",
        """
        SELECT CAST(
          100.0 * SUM(CASE WHEN lower(s.name) LIKE 'pruefung%' THEN 1 ELSE 0 END)
          / NULLIF(count(*), 0)
          AS INTEGER
        )
        FROM defect d
        LEFT JOIN section s ON d.detected_section_id = s.section_id
        """,
        30,
    )
    tester.check_eq(
        "high/critical defects always have image_url",
        """
        SELECT count(*)
        FROM defect
        WHERE severity IN ('high', 'critical')
          AND (image_url IS NULL OR image_url = '')
        """,
        0,
    )
    tester.check_ge(
        "field claims with image_url",
        """
        SELECT count(*)
        FROM field_claim
        WHERE image_url IS NOT NULL AND image_url <> ''
        """,
        15,
    )

    return tester.finish()


if __name__ == "__main__":
    raise SystemExit(main())
