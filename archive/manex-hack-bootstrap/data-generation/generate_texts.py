"""
One-shot generator for German-language texts used in the hackathon dataset.

Produces three JSON files under templates/ that generate.py consumes:
  - claim_texts_de.json:    40 field-claim complaint texts (B2B German)
  - defect_notes_de.json:   40 shop-floor defect notes (German w/ abbreviations)
  - rework_actions_de.json: 30 rework action descriptions

Run manually once (costs a few cents in Gemini API). Commit the JSON outputs.
    export GOOGLE_API_KEY=...
    python generate_texts.py

The script mixes "neutral" samples with "story-tagged" samples that reference
specific components (capacitor C12, resistor R33, supplier ElektroParts) so
generate.py can embed them into the matching DEFECT/FIELD_CLAIM rows.
"""

import json
import os
import sys
from pathlib import Path

from google import genai
from google.genai import types

TEMPLATE_DIR = Path(__file__).parent / "templates"
TEMPLATE_DIR.mkdir(exist_ok=True)

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")

# ----------------------------------------------------------------------
# Batch specs — each spec is one Gemini call returning a JSON array.
# story_tag lets generate.py route tagged samples into the right rows.
# ----------------------------------------------------------------------

CLAIM_BATCHES = [
    {
        "tag": "story1_supplier",
        "count": 12,
        "prompt": """
Erzeuge {count} realistische deutschsprachige B2B-Reklamationstexte fuer einen
industriellen Motor Controller vom Typ MC-200. Hintergrund: Produkte mit einem
bestimmten 100uF-Kondensator (Position C12 auf der Steuerplatine) aus einer
fehlerhaften Charge der Firma ElektroParts GmbH fallen nach wenigen Wochen im
Feld aus (thermische Zyklen → kalte Loetstelle → Totalausfall).

Variiere Laenge (2-8 Saetze), Formalitaet, technisches Detail.
Manche Texte erwaehnen explizit Kondensator / C12 / "Totalausfall" /
"Ausfall nach wenigen Wochen". Andere sind vage ("Geraet funktioniert nicht
mehr").

Gib reines JSON zurueck: eine Liste von Strings, sonst nichts.
""",
    },
    {
        "tag": "story3_thermal",
        "count": 15,
        "prompt": """
Erzeuge {count} realistische deutschsprachige B2B-Reklamationstexte fuer einen
industriellen Motor Controller vom Typ MC-200. Hintergrund: Widerstand R33 auf
der Steuerplatine wird unter Nennlast ueber die Zeit zu heiss und driftet.
Kunden beobachten einen schleichenden Ausfall nach 8-12 Wochen Betrieb.

Texte sollen Begriffe wie "schleichender Ausfall", "Temperatur zu hoch",
"Drift", "Leistung nimmt ab", "unregelmaessiges Verhalten" verwenden. Nicht
jeder Text muss R33 direkt nennen, aber das Fehlerbild soll thermisch wirken.

Laenge 3-8 Saetze, gemischte Formalitaet. Reines JSON-Array zurueckgeben.
""",
    },
    {
        "tag": "background",
        "count": 13,
        "prompt": """
Erzeuge {count} realistische deutschsprachige B2B-Reklamationstexte fuer
Industrieprodukte (Motor Controller, Sensor Units, Controller-Boards) mit
diversen Fehlerbildern: Gehaeuseriss, LED blinkt nicht wie spezifiziert,
Verbindungsabbruch, falsche Seriennummer auf Label, etc.

Variiere Produkt, Fehlerbild, Laenge (2-8 Saetze), Formalitaet. Manche
Texte sind sehr kurz ("Geraet SN 4711 defekt, bitte Austausch"), andere
detailliert mit Messwerten. Reines JSON-Array zurueckgeben.
""",
    },
]

DEFECT_NOTE_BATCHES = [
    {
        "tag": "story1_supplier",
        "count": 10,
        "prompt": """
Erzeuge {count} kurze deutschsprachige Shopfloor-Notizen zu Loetfehlern
am Kondensator C12 (100uF) auf der Steuerplatine. Stil: Kuerzel,
Abkuerzungen, kleingeschrieben erlaubt, Tippfehler OK, 1-2 Saetze.
Beispiel: "Loetfehler an Kond. C12, kalte Loetstelle visuell erk."
Reines JSON-Array von Strings.
""",
    },
    {
        "tag": "story2_calibration",
        "count": 8,
        "prompt": """
Erzeuge {count} kurze deutschsprachige Shopfloor-Notizen zu
Vibrationstest-Fehlern (VIB_TEST) wegen zu locker angezogener Schrauben
an Montage Linie 1. Shopfloor-Stil, 1-2 Saetze, Kuerzel erlaubt.
Beispiel: "Vibrationstestwert 4.2g ueberschr. GW 3.5g, Schraubmoment gepr."
Reines JSON-Array.
""",
    },
    {
        "tag": "story4_operator",
        "count": 7,
        "prompt": """
Erzeuge {count} kurze deutschsprachige Shopfloor-Notizen zu kosmetischen
Defekten (Kratzer am Gehaeuse, schiefes Label, Seriennummer unlesbar).
Shopfloor-Stil, 1-2 Saetze, kleingeschrieben OK.
Beispiel: "kratzer am geh. oberseite, ca 3cm, vermutl. beim verp. entst."
Reines JSON-Array.
""",
    },
    {
        "tag": "background",
        "count": 15,
        "prompt": """
Erzeuge {count} diverse kurze deutschsprachige Shopfloor-Defekt-Notizen
(diverse Codes: kalte Loetstelle, Haarriss Gehaeuse, Test OOL, LED fehlt,
Verpolung, Nacharbeit noetig, Pruefung wiederholt). 1-2 Saetze, Kuerzel
und kleine Tippfehler erlaubt. Reines JSON-Array.
""",
    },
]

REWORK_BATCHES = [
    {
        "tag": "story1_supplier",
        "count": 8,
        "prompt": """
Erzeuge {count} deutschsprachige Nacharbeitsmassnahmen-Texte zu
Kondensator-Austausch auf der Steuerplatine (Position C12, 100uF X7R)
nach kalter Loetstelle. 1-2 Saetze, technisch. Referenziere alternative
Chargen (z.B. SB-00012) und visuell/elektrisch i.O.-Prueftexte.
Reines JSON-Array.
""",
    },
    {
        "tag": "story2_calibration",
        "count": 7,
        "prompt": """
Erzeuge {count} deutschsprachige Nacharbeitsmassnahmen zu
Schraubmoment-Nachziehen an Montage Linie 1 nach VIB_TEST-Fail.
1-2 Saetze, technisch. Erwaehne Moment in Nm, Nachpruefung VIB i.O.
Reines JSON-Array.
""",
    },
    {
        "tag": "background",
        "count": 15,
        "prompt": """
Erzeuge {count} diverse deutschsprachige Nacharbeitsmassnahmen-Texte
fuer Industrie-QA: Bauteil getauscht, Nachloetung, Label erneuert,
Gehaeuse ausgetauscht, Firmware neu geflasht, Schraubverbindung
nachgezogen, etc. 1-2 Saetze, technisch, konkrete Angaben.
Reines JSON-Array.
""",
    },
]


def call_gemini(client: genai.Client, prompt: str, count: int) -> list[str]:
    """Call Gemini and extract a JSON list of strings from the response."""
    full_prompt = prompt.format(count=count).strip()
    resp = client.models.generate_content(
        model=MODEL,
        contents=full_prompt,
        config=types.GenerateContentConfig(
            temperature=0.7,
            max_output_tokens=4096,
            response_mime_type="application/json",
        ),
    )
    text = (resp.text or "").strip()
    if not text:
        raise RuntimeError("model returned empty response text")

    # Strip markdown fences if the model wrapped the JSON.
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip("` \n")

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"model returned non-JSON (first 500 chars):\n{text[:500]}\n---\n{e}"
        )

    if not isinstance(data, list) or not all(isinstance(x, str) for x in data):
        raise RuntimeError(f"expected list[str], got: {type(data)} with first={data[:1]!r}")

    if len(data) < count:
        print(f"  warning: asked for {count}, got {len(data)}", file=sys.stderr)

    return data


def run_batches(client: genai.Client, batches: list[dict], out_file: Path) -> None:
    """Run a group of batches and write the combined tagged output."""
    out: list[dict] = []
    for batch in batches:
        print(f"  batch tag={batch['tag']} count={batch['count']}")
        items = call_gemini(client, batch["prompt"], batch["count"])
        for text in items:
            out.append({"tag": batch["tag"], "text": text})

    out_file.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"  wrote {len(out)} entries to {out_file}")


def main() -> int:
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: GOOGLE_API_KEY (or GEMINI_API_KEY) not set", file=sys.stderr)
        return 1

    client = genai.Client(api_key=api_key)

    print("generating field claim texts...")
    run_batches(client, CLAIM_BATCHES, TEMPLATE_DIR / "claim_texts_de.json")

    print("generating defect notes...")
    run_batches(client, DEFECT_NOTE_BATCHES, TEMPLATE_DIR / "defect_notes_de.json")

    print("generating rework action texts...")
    run_batches(client, REWORK_BATCHES, TEMPLATE_DIR / "rework_actions_de.json")

    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
