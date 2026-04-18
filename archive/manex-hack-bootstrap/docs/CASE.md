# The Challenge: Next-Generation Quality Reporting

## Context

Manex AI builds data infrastructure for the factories of the future. We break down data silos — production, quality, suppliers — and transfer them into a networked, semantic data model. On top of this foundation, developers can build entirely new workflows and applications that actively intervene in shopfloor operations.

## The Problem: The Static "Excel Graveyard"

When a quality issue occurs in industry, standards require an **8D Report** or an **FMEA** (Failure Mode and Effects Analysis). Today these reports are static, text-heavy Excel or Word documents.

Engineers spend hours formulating free text and filling out tables. Once finished, the document disappears into a folder. Corrective measures are forgotten, the connection to real machine data is lost, and when similar errors occur in the future, the process starts from scratch.

## Your Mission: Build an Interactive Quality Co-Pilot

Build an application that acts as an **interactive co-pilot** when a quality problem arises (such as a field claim or a cluster of defects). Three pillars:

### 1. Intelligent Generation
Use LLMs to automatically analyze existing data (test parameters, error codes, complaint texts) and generate a high-quality draft for the problem description and potential root-cause hypotheses.

### 2. Innovative Visualization
Say goodbye to boring tables. Think fault trees, timelines, Pareto analyses, BOM traceability views — any interactive representation that lets engineers and management immediately grasp the core of the problem. No limits on creativity.

### 3. From Document to Workflow (Closed-Loop)
The report must not remain static. Create corrective actions directly as **initiatives** in the system, assign responsibilities, and track progress through initiative updates.

---

## What We Provide

| Resource | Details |
|----------|---------|
| **Manex AI API** | REST endpoints for querying and writing to the semantic data model — see [API_REFERENCE.md](API_REFERENCE.md) |
| **Data Schema** | ER diagram with 19 entities (Items, Defects, BOM, Initiatives, Test Results, …) — see [SCHEMA.md](SCHEMA.md) |
| **Realistic Dataset** | ~7,000 rows of manufacturing data with four explicit root-cause stories and AI-generated defect images — see [DATA_PATTERNS.md](DATA_PATTERNS.md) |
| **Quickstart** | Connect in < 5 minutes — see [QUICKSTART.md](QUICKSTART.md) |

---

## Evaluation Criteria

| # | Criterion | What judges look for |
|---|-----------|---------------------|
| 1 | **Innovation in UI/UX** | Creative, dynamic, user-friendly representation vs. classic Excel |
| 2 | **GenAI Integration** | Intelligent, accurate AI drafts grounded in structured API data |
| 3 | **Actionability & Tracking** | Seamless conversion of findings into real initiatives with ownership |
| 4 | **Business Impact** | Plausible reduction of Time-to-Resolution; real value for the factory floor |

End-to-end thinking wins: the best solution combines smart AI integration with outstanding UI/UX and a clear understanding of business value.
