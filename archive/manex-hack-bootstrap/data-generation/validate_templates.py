#!/usr/bin/env python3
"""Validate manual text templates used by generate.py.

Checks:
- File presence
- JSON shape: list[{"tag": str, "text": str}]
- Required story tags per file
- Minimum count per file
- Basic text quality constraints
- Optional English-likeness heuristic (default enabled)

Usage:
  python validate_templates.py
  python validate_templates.py --strict-english
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

TEMPLATES_DIR = Path(__file__).parent / "templates"


@dataclass(frozen=True)
class TemplateSpec:
    filename: str
    min_count: int
    required_tags: tuple[str, ...]


SPECS: tuple[TemplateSpec, ...] = (
    TemplateSpec(
        filename="claim_texts_en.json",
        min_count=35,
        required_tags=("story1_supplier", "story3_thermal", "background"),
    ),
    TemplateSpec(
        filename="defect_notes_en.json",
        min_count=35,
        required_tags=("story1_supplier", "story2_calibration", "story4_operator", "background"),
    ),
    TemplateSpec(
        filename="rework_actions_en.json",
        min_count=25,
        required_tags=("story1_supplier", "story2_calibration", "background"),
    ),
)

GERMAN_HINT_WORDS = {
    "und", "nicht", "mit", "ohne", "nacharbeit", "fehler", "geraet",
    "pruefung", "montage", "reklamation", "ausfall", "linie", "wurde",
}


def looks_german(text: str) -> bool:
    lower = text.lower()
    if any(ch in lower for ch in ("ae", "oe", "ue", "ss")):
        # Soft hint only; many English words can include these pairs.
        pass
    words = set(re.findall(r"[a-zA-Z']+", lower))
    hits = words & GERMAN_HINT_WORDS
    return len(hits) >= 2


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)


def warn(msg: str) -> None:
    print(f"WARN: {msg}")


def ok(msg: str) -> None:
    print(f"OK:   {msg}")


def validate_entry_shape(entry: object, idx: int, path: Path) -> bool:
    if not isinstance(entry, dict):
        fail(f"{path.name}[{idx}] is not an object")
        return False
    if "tag" not in entry or "text" not in entry:
        fail(f"{path.name}[{idx}] missing required keys tag/text")
        return False
    if not isinstance(entry["tag"], str) or not entry["tag"].strip():
        fail(f"{path.name}[{idx}].tag must be non-empty string")
        return False
    if not isinstance(entry["text"], str) or not entry["text"].strip():
        fail(f"{path.name}[{idx}].text must be non-empty string")
        return False
    return True


def validate_file(spec: TemplateSpec, strict_english: bool) -> bool:
    path = TEMPLATES_DIR / spec.filename
    if not path.exists():
        fail(f"missing template file: {path}")
        return False

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"{path.name} is not valid JSON: {exc}")
        return False

    if not isinstance(data, list):
        fail(f"{path.name} must be a JSON list")
        return False

    if len(data) < spec.min_count:
        fail(f"{path.name} has {len(data)} entries, expected >= {spec.min_count}")
        return False

    all_ok = True
    tags: dict[str, int] = {}
    texts: list[str] = []

    for i, entry in enumerate(data):
        if not validate_entry_shape(entry, i, path):
            all_ok = False
            continue
        tag = entry["tag"].strip()
        text = entry["text"].strip()
        tags[tag] = tags.get(tag, 0) + 1
        texts.append(text)

        if len(text) < 12:
            fail(f"{path.name}[{i}] text too short (<12 chars)")
            all_ok = False

    for req in spec.required_tags:
        if tags.get(req, 0) == 0:
            fail(f"{path.name} missing required tag: {req}")
            all_ok = False

    unique_ratio = len(set(texts)) / max(1, len(texts))
    if unique_ratio < 0.8:
        fail(f"{path.name} has low uniqueness ratio ({unique_ratio:.2f}, expected >= 0.80)")
        all_ok = False

    germanish = sum(1 for t in texts if looks_german(t))
    germanish_ratio = germanish / max(1, len(texts))
    if germanish_ratio > 0.20:
        msg = f"{path.name} appears mixed-language ({germanish_ratio:.0%} likely German lines)"
        if strict_english:
            fail(msg)
            all_ok = False
        else:
            warn(msg)

    if all_ok:
        ok(f"{path.name} passed ({len(texts)} entries)")
    return all_ok


def run(strict_english: bool) -> int:
    print(f"Validating templates in {TEMPLATES_DIR}")
    results = [validate_file(spec, strict_english=strict_english) for spec in SPECS]
    if all(results):
        print("All template checks passed.")
        return 0
    print("Template validation failed.", file=sys.stderr)
    return 1


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--strict-english",
        action="store_true",
        help="Fail if too much content looks German",
    )
    return parser.parse_args(list(argv))


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    return run(strict_english=args.strict_english)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
