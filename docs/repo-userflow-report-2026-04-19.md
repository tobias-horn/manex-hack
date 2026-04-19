# Manex Repo Userflow Report

Date: 2026-04-19

This report explains the repo as a product, not just as a collection of files.
It follows the real operator flow from entry point to investigation, confirmation,
reporting, handoff, and AI-assisted actions.

It is based on the current code in this worktree and cross-checks the existing
project notes in `docs/`.

## 1. Executive summary

The app is a Next.js App Router investigation workspace for the Manex hackathon.
It is not a single-screen demo. It is a layered quality workflow with:

- a raw signal intake layer
- a global intelligence layer
- product-level and case-level investigation screens
- multiple competing clustering / RCA engines
- operator hypothesis review
- confirmed-case report generation
- economic impact framing
- team handoff preparation
- an approval-gated AI agent

The current default entry experience is:

1. open `/`
2. get redirected to `/articles`
3. review ranked cases on **Global intelligence**
4. open a dedicated **case viewer**
5. compare or pressure-test the working explanation
6. confirm the best hypothesis
7. generate a **confirmed case report**
8. inspect **economic blast radius**
9. queue the case to suggested teams
10. optionally use the floating AI agent to investigate or draft workflow actions

That means the repo is organized around one main closed loop:

**signal intake -> clustered cases -> human review -> confirmed report -> team handoff -> workflow write-back**

## 2. High-level repo shape

The main user-facing routes are:

- `/`
  Redirects to `/articles` with the selected pipeline mode.
- `/articles`
  Global intelligence dashboard and main starting point.
- `/cases/[caseId]`
  Focused dedicated case viewer.
- `/articles/[articleId]`
  Article-level hypothesis board.
- `/products/[productId]`
  Product dossier and evidence surface.
- `/traceability`
  Traceability explorer and blast-radius explorer.
- `/inbox`
  Raw quality-signal inbox.
- `/cases`
  App-owned case-state workbench.

The main logic layers are:

- `src/app/*`
  Page routes and API routes.
- `src/components/*`
  User-facing investigation surfaces.
- `src/lib/*`
  Read models, pipeline execution, persistence helpers, data access, and view-model shaping.
- `src/prompts/*`
  Prompt contracts for the AI-powered clustering, reporting, and agent flows.
- `docs/*`
  Internal product and implementation notes. These are unusually important in this repo and often document why the UX changed.

## 3. Start of the userflow

### 3.1 Entry point

The app homepage no longer behaves like a standalone landing page. `src/app/page.tsx`
immediately redirects to `/articles` and carries the current pipeline mode through
the query string.

So in practice, the product starts on **Global intelligence**.

### 3.2 Root layout behavior

`src/app/layout.tsx` mounts global UI that applies everywhere:

- theme setup and theme toggle
- the floating `AskTheAgent` widget

The agent only appears if:

- AI is configured, and
- at least one live data connection exists (`DATABASE_URL` or REST/PostgREST)

That means AI is treated as an optional augmentation layer, not a hard dependency
for the whole UI shell.

## 4. Core starting screen: Global intelligence

The main starting experience lives in `src/app/articles/page.tsx`.

This screen is the operational hub of the app.

### 4.1 What the screen does

It combines four jobs:

- shows the currently active investigation engine
- lets the user run or monitor the batch pipeline
- lists the strongest ranked cases directly
- surfaces global watchlists / anomalies / noise buckets separately from active cases

This is important architecturally:

- the app no longer starts from an article page
- the app no longer forces the user to enter a broad article board first
- the app starts with **ranked cases**, not raw data and not article shells

### 4.2 What the user sees first

The page opens with:

- the title **Global intelligence**
- top-line metrics for ranked cases, cross-article patterns, noise/rejects, active runs, and engine
- a collapsible engine switcher
- the ranked case inventory
- the global-pattern sections
- the live pipeline runner sidebar

### 4.3 Engine switching

The engine switcher is handled by `src/components/clustering-pipeline-toggle.tsx`
and the mode helper in `src/lib/manex-clustering-mode.ts`.

The app currently supports five modes:

- `current`
  Classic three-layer clustering.
- `deterministic`
  Deterministic issue-grouping pipeline.
- `hypothesis`
  Hypothesis engine with mechanism-family scoring.
- `investigate`
  Statistical anomaly RCA path.
- `dummy`
  Seeded read-only challenge walkthrough mode.

This is one of the most important product ideas in the repo:

- the UI shell is shared
- the caseboard/viewer shell is shared
- the underlying investigation engine can change

So the repo is designed as a common investigation product over multiple analysis engines.

### 4.4 Ranked cases

The ranked inventory is built from caseboards using `src/lib/manex-case-viewer.ts`.

Each ranked case card shows:

- article id
- case kind
- priority
- confidence
- title
- summary
- affected product count
- signal count
- article-level case count
- update timestamp

The CTA goes directly to `/cases/[caseId]`.

This is the main user-facing shift in the repo:

- Global intelligence opens **cases directly**
- article pages are now secondary investigation surfaces

### 4.5 Global patterns

Below the ranked cases, the app shows non-primary outputs:

- cross-article anomalies
- watchlists
- leading indicators
- noise buckets
- rejected cases

These are intentionally separated from the main case list so the operator can
distinguish:

- things to act on now
- things to monitor
- things to suppress or ignore

The watchlist section is collapsed by default so the main case inventory stays visible.

### 4.6 Pipeline runner

The right-hand runner uses `src/components/global-pipeline-runner.tsx`.

It can:

- start the relevant batch route for the active engine
- poll live stage progress
- show stage counts across active runs
- display batch success/failure state
- stop a running batch
- reset clustering state

This is the main control surface for actually generating case output.

Conceptually, the userflow is:

1. choose an engine
2. run the batch
3. wait for ranked cases to populate
4. open a case

## 5. Under the hood of Global intelligence

### 5.1 Classic pipeline

The classic pipeline lives mainly in:

- `src/lib/manex-case-clustering.ts`
- `src/lib/manex-case-clustering-state.ts`
- `src/prompts/manex-case-clustering.ts`

The current three-stage flow is:

1. build deterministic per-product dossiers
2. cluster one article into candidate cases
3. reconcile article outputs into the global inventory

The classic state layer persists:

- `team_signal_inbox`
- `team_product_dossier`
- `team_article_dossier`
- `team_case_run`
- `team_case_batch`
- `team_case_candidate`
- `team_case_candidate_member`

This is the main analysis backbone for the original UX.

### 5.2 Deterministic engine

The deterministic engine lives in:

- `src/lib/manex-deterministic-case-clustering.ts`
- `src/lib/manex-deterministic-case-clustering-state.ts`
- `src/prompts/manex-deterministic-case-clustering.ts`

Its role is to do more bounded issue extraction and grouping with less reliance
on the full classic three-stage LLM flow.

### 5.3 Hypothesis engine

The hypothesis engine lives in:

- `src/lib/manex-hypothesis-case-clustering.ts`
- `src/lib/manex-hypothesis-case-clustering-state.ts`
- `src/prompts/manex-hypothesis-case-clustering.ts`

Its role is to produce explicit competing explanation candidates like supplier,
design, process, operator, and noise-style stories before the UI shows them.

### 5.4 Investigate engine

The investigate path lives in:

- `src/lib/manex-investigate.ts`
- `src/lib/manex-investigate-state.ts`
- `src/prompts/manex-investigate.ts`

This engine is structurally different:

- it runs direct SQL-based sweeps
- it asks the model to narrate structured RCA stories from those evidence tables
- it does not depend on the same clustering reconciliation path

### 5.5 Dummy engine

Dummy mode is implemented in `src/lib/manex-dummy-clustering.ts`.

This is a UX-enabling mode, not a live-analysis mode.

It gives the team:

- a completed seeded run
- read-only caseboards
- deterministic UI testing against the published challenge stories

That is especially useful for hackathon iteration when live clustering is slow,
expensive, or temporarily unstable.

## 6. Case viewer

The dedicated case viewer is the most important detail screen in the current UX.

### 6.1 Route and loader

The route is:

- `src/app/cases/[caseId]/page.tsx`

The shared loader is:

- `src/lib/manex-case-viewer.ts`

The loader:

- resolves the correct article caseboard for the chosen engine
- builds a normalized hypothesis/case view model
- loads operator review state if Postgres exists
- computes economic blast radius for the selected case

### 6.2 Why this screen exists

The project note in `docs/case-viewer-2026-04-19.md` explains the intent:

- the old flow made users open an article first
- that added one navigation step
- the new flow opens a case directly from Global intelligence

So this screen is optimized for:

- one argument at a time
- one evidence drawer
- one operator decision surface

### 6.3 What the user sees

`src/components/case-viewer.tsx` renders:

- a hero with title, thesis, and summary
- compact case metrics
- the working explanation card
- support / assumptions / counterevidence / decisive test panels
- a `Why not yet` warning block
- ranking controls
- approve / reject controls
- an evidence timeline drawer
- the economic blast radius section

### 6.4 What “hypothesis review” means here

The case viewer is not just a read-only detail page. It is an operator review surface.

The user can mark the case as:

- `leading`
- `plausible`
- `weak`
- `ruled_out`
- `confirmed`

Those states are stored in the app-owned table:

- `team_hypothesis_review`

through:

- `src/app/api/articles/[articleId]/hypotheses/[candidateId]/review/route.ts`
- `src/lib/article-hypothesis-review-state.ts`

So the app separates:

- model-generated case output
- human judgment about that output

That boundary is one of the repo’s cleanest product decisions.

## 7. All the hypothesis stuff

This is spread across the article board, the case viewer, and the normalization layer.

### 7.1 Article-level hypothesis board

The article route is:

- `src/app/articles/[articleId]/page.tsx`

This page still exists even though it is no longer the primary entry point from
Global intelligence.

Its job is:

- to compare multiple competing hypotheses within one article
- to let the operator open evidence for each one
- to manage status review

### 7.2 Shared view-model layer

The normalization logic lives in:

- `src/lib/article-hypothesis-view.ts`

This is a key architectural piece.

It converts different engine outputs into one shared UI contract:

- title
- thesis
- summary
- why it fits
- what must be true
- what weakens it
- next checks
- why not
- timeline
- related products
- actions
- suggested action type/comment

Because of this layer, the same UI can render:

- classic clustering
- deterministic grouping
- hypothesis engine output
- statistical investigate mode
- dummy mode

### 7.3 Hypothesis board UX

`src/components/article-hypothesis-board.tsx` renders:

- a case shell
- a compact board of competing hypotheses
- an evidence drawer
- status controls

Each hypothesis card explicitly presents:

- positive support
- assumptions required
- counterevidence
- decisive tests
- `Why not?` constraints

That is more rigorous than a normal “AI answer card.” It is built to force
comparison and falsification, not just narrative convenience.

### 7.4 Hypothesis status behavior

The article board and case viewer share the same status semantics.

Once one hypothesis becomes `confirmed`, the UX changes state:

- the normal hypothesis board is replaced by the confirmed-case workspace
- the user is no longer in open comparison mode
- the case becomes a reporting and handoff object

This is the bridge from analysis into action.

## 8. Generate report

This is the biggest workflow transition in the whole product.

### 8.1 What triggers report generation

Report generation begins when the operator confirms a hypothesis.

At that point the UI renders `src/components/confirmed-case-workspace.tsx`
instead of the normal hypothesis/case review surface.

### 8.2 How the report is generated

The confirmed workspace immediately calls:

- `POST /api/articles/[articleId]/hypotheses/[candidateId]/confirmed-report`

That route uses:

- `src/lib/manex-confirmed-case-report.ts`

The report can be produced in two modes:

- `live_ai`
- `template`

If AI is available, the repo tries to generate a structured report with the shared
repair/hardening helpers.

If not, it builds a fallback report from the confirmed hypothesis content.

### 8.3 What the report contains

The report schema in `src/lib/manex-confirmed-case-report-schema.ts` includes:

- headline
- executive summary
- problem statement
- confirmed mechanism
- severity assessment
- scope
- evidence highlights
- containment actions
- corrective actions
- validation plan
- watchouts
- timeline
- suggested teams

This is effectively an 8D-style quality report draft shaped for the hackathon UX.

### 8.4 Where it is stored

Generated reports persist to:

- `team_quality_case_report`

through:

- `src/lib/manex-confirmed-case-report-state.ts`

The record also stores:

- runtime mode (`live_ai` or `template`)
- model name
- prompt version
- selected team ids
- notification queue timestamps

So confirmed cases become durable app-owned objects, not just transient UI.

### 8.5 What the user sees

The confirmed workspace shows:

- top-level confirmed-case metrics
- a generated report body
- numbered sections for problem/mechanism/evidence/severity/containment/corrective action/validation/watchouts/traceability/timeline

This is the first place where the app clearly stops being “case triage UI” and
starts acting like “quality documentation software.”

## 9. Economic blast radius

This feature exists both as an analytical lens and as a storytelling layer for the
hackathon judging criteria.

### 9.1 Where it appears

It is shown in:

- the dedicated case viewer
- the confirmed-case workspace

through:

- `src/components/economic-blast-radius-section.tsx`

### 9.2 How it is computed

The underlying computation comes from:

- `buildEconomicBlastRadiusForCase(...)` in `src/lib/manex-case-clustering.ts`

It works over the selected product threads in a case and derives anchor-level
impact summaries from:

- defects
- claims
- rework
- traceability anchors
- process/handling anchors

### 9.3 What it explains

This section answers:

- where the cost is concentrated
- how widely the issue spreads across products
- how much cost has already escaped into field claims
- which anchors are the strongest business hotspots

The UI deliberately breaks cost into:

- defect cost
- claim cost
- rework cost

and ranks anchors by:

- total cost share
- product coverage
- claim share

### 9.4 Important interpretation rule

The UI explicitly warns that anchor rows can overlap.

So the section is designed for:

- ranking
- comparison
- management framing

not for summing independent totals across rows.

### 9.5 Connection to traceability

Supplier-batch anchors link into `/traceability`.

That turns blast radius from “interesting card” into an investigable path:

- economic hotspot -> traceability explorer -> installed-part and batch spread

## 10. Send to team mates

This feature is implemented as a structured handoff queue, not a real messaging integration.

### 10.1 Where it lives

Inside the confirmed-case workspace, the right column contains:

- suggested notification teams
- selectable recipients
- queue action

### 10.2 How teams are chosen

Team definitions live in:

- `src/lib/manex-confirmed-case-report-schema.ts`

The available teams are:

- Quality Management
- Supplier Quality
- Manufacturing Engineering
- Design Engineering
- Field Quality
- Operations & Training
- Procurement
- Customer Support

Suggestions come from the confirmed-case report logic in
`src/lib/manex-confirmed-case-report.ts`.

It uses the confirmed hypothesis family and evidence footprint to infer who
should be involved.

### 10.3 What “send” actually does today

The UI action calls:

- `PATCH /api/articles/[articleId]/hypotheses/[candidateId]/confirmed-report`

That does **not** deliver an email, Slack message, or workflow task externally.

What it really does is:

- ensure the report exists
- save the selected team ids
- stamp `notify_requested_at`
- stamp `notify_requested_by`

in `team_quality_case_report`

So the current feature is best described as:

**queue the handoff request**

not:

**actually message teammates**

The UI even says the real delivery hook can be connected later.

That matters for demos and for honest product explanation.

## 11. AI agents

The repo contains two different AI layers:

- the backend analysis/report pipelines
- the interactive floating agent

When people say “AI agents” in this repo, they usually mean the floating chat assistant.

### 11.1 Where the agent lives

UI:

- `src/components/ask-the-agent.tsx`

Streaming route:

- `src/app/api/agent/route.ts`

Execution route:

- `src/app/api/agent/execute/route.ts`

Tools:

- `src/lib/agent-tools.ts`

Prompt:

- `src/prompts/manex-agent.ts`

### 11.2 How the UX works

The agent is a floating assistant available globally when AI and live data access
are configured.

It can:

- search defects
- search field claims
- search test signals
- inspect installed parts
- inspect weekly summaries
- inspect rework
- inspect existing actions
- propose a product action
- propose an assignment
- draft a report proposal

### 11.3 Safety model

This is one of the better-designed parts of the repo.

The agent does **not** write immediately.

Instead:

1. it gathers evidence with read tools
2. it returns a proposal
3. the human approves or denies it
4. only then does `/api/agent/execute` persist the write

So the AI layer is:

- evidence-first
- proposal-based
- approval-gated

### 11.4 What the agent can actually write

After approval, the execute route can persist:

- product actions
- assignments
- report-like 8D actions

Those writes are normalized into workflow actions through the Manex data access layer.

For report proposals, approval creates an `initiate_8d`-style workflow action
anchored to a product.

### 11.5 What the agent “knows”

The system prompt in `src/prompts/manex-agent.ts` is heavily specialized for the
challenge dataset.

It explicitly embeds the four known hidden story patterns and tells the model:

- gather evidence first
- avoid speculation when the user asked only for facts
- treat some signals as noise
- never claim it wrote anything before approval

This means the agent is not a general chatbot. It is a challenge-specific
forensic copilot.

## 12. Supporting surfaces along the way

Even though the main requested flow starts from Global intelligence, the repo has
important supporting screens that feed the investigation story.

### 12.1 Inbox

Route:

- `/inbox`

Files:

- `src/app/inbox/page.tsx`
- `src/lib/quality-inbox.ts`

Purpose:

- merge defects, field claims, FAIL tests, and MARGINAL tests into one normalized signal feed
- give an operator a raw triage surface before case formation

This is the lowest-level human-readable read model in the app.

### 12.2 Product dossier

Route:

- `/products/[productId]`

Files:

- `src/app/products/[productId]/page.tsx`
- `src/lib/manex-product-dossier.ts`

Purpose:

- inspect one product holistically
- view defects, claims, installed parts, evidence images, tests, weekly context, and workflow actions
- jump into traceability or the leading related case

This screen is the best product-centric drilldown in the repo.

### 12.3 Traceability explorer

Route:

- `/traceability`

Files:

- `src/app/traceability/page.tsx`
- `src/lib/manex-traceability.ts`

Purpose:

- inspect installed parts for one product
- inspect batch-based blast radius
- prepare graph-ready nodes and edges for more visual RCA later

This is the main deterministic supply-chain / component-context surface.

### 12.4 Case state layer

Route:

- `/cases`

Files:

- `src/app/cases/page.tsx`
- `src/lib/manex-case-state.ts`
- `src/components/case-workbench.tsx`

Purpose:

- maintain app-owned case / hypothesis / note state without mutating protected seed data

This is more of a foundation/admin surface than the primary investigation flow,
but it matters architecturally because it shows the repo’s boundary discipline.

## 13. End-to-end userflow, step by step

This is the cleanest “from start to finish” flow in the current repo.

### 13.1 Primary happy path

1. User opens `/`.
2. App redirects to `/articles`.
3. User sees **Global intelligence**.
4. User optionally switches engine.
5. User starts or monitors a pipeline batch from the runner.
6. Ranked cases appear in the inventory.
7. User opens a case directly into `/cases/[caseId]`.
8. User reads the working explanation and evidence timeline.
9. User ranks the case or confirms/rejects it.
10. If the case is confirmed, the UI switches into the confirmed-case workspace.
11. The app generates a confirmed-case report.
12. The user inspects the economic blast radius.
13. The user selects suggested teams.
14. The app queues the notification request.
15. The user can optionally use the AI agent to draft extra actions or assignments.

### 13.2 Alternative path: article-first comparison

1. User opens an article board at `/articles/[articleId]`.
2. User compares up to a few competing hypotheses.
3. User opens evidence for one hypothesis.
4. User updates its status.
5. Confirmation transitions into the same confirmed-case workflow.

### 13.3 Alternative path: product-first investigation

1. User opens `/products/[productId]`.
2. User reads product-specific facts and symptom trails.
3. User checks batch/supplier context and evidence images.
4. User opens the related case or traceability explorer.
5. User writes or updates a workflow action from the product page.

### 13.4 Alternative path: raw-signal triage

1. User opens `/inbox`.
2. User filters by window, article, defect code, or signal type.
3. User scans raw symptoms first.
4. User pivots to global intelligence, traceability, or case state from there.

## 14. Data and persistence model

The app reads from two broad source categories:

- protected Manex source data
- app-owned state tables

### 14.1 Source data

The data access layer in `src/lib/manex-data-access.ts` reads:

- defects
- field claims
- installed BOM parts
- quality summaries
- test results
- product actions
- rework

It can work through:

- Postgres
- REST/PostgREST

### 14.2 App-owned state

The app writes its own product state into separate tables such as:

- `team_case_run`
- `team_case_batch`
- `team_case_candidate`
- `team_case_candidate_member`
- `team_hypothesis_review`
- `team_quality_case_report`
- and the older `/cases` workbench tables like `cases`, `hypotheses`, `investigation_notes`

This is a strong pattern in the repo:

- do not mutate protected seed data for derived reasoning state
- create app-owned tables for workflow and review layers

## 15. What is especially strong in this repo

From a product and architecture standpoint, the strongest ideas are:

- direct-case entry from Global intelligence instead of article-first navigation
- one shared UI shell over multiple investigation engines
- explicit operator review state separate from model output
- confirmed-case transition into a report/handoff workflow
- economic blast radius as a business-impact lens
- AI proposals that require human approval before writing
- clean app-owned persistence boundaries

## 16. Current limitations and caveats

A few features look stronger in the UI than they are operationally today, and
that should be explained honestly.

### 16.1 Team handoff is queued, not delivered

The “send to teammates” feature currently stores the request and selected teams.
It does not yet push into a real external notification system.

### 16.2 Some modes are read-model variants over shared UI

The UX is polished and unified, but not every engine uses the exact same backend
logic. That is intentional, but it means “same screen” does not mean “same algorithm.”

### 16.3 AI is optional

If AI credentials are missing, the shell still renders and parts of the workflow
can fall back to template or dummy behavior.

### 16.4 Some product surfaces are still “investigation scaffolds”

The `/cases` workbench and some action layers are foundation layers for later
workflow expansion, not yet full production-grade case-management features.

## 17. File map for the requested features

### 17.1 Global intelligence

- `src/app/articles/page.tsx`
- `src/components/clustering-pipeline-toggle.tsx`
- `src/components/global-pipeline-runner.tsx`
- `src/lib/manex-case-viewer.ts`

### 17.2 Case viewer

- `src/app/cases/[caseId]/page.tsx`
- `src/components/case-viewer.tsx`
- `src/lib/manex-case-viewer.ts`

### 17.3 Hypothesis flow

- `src/app/articles/[articleId]/page.tsx`
- `src/components/article-hypothesis-board.tsx`
- `src/lib/article-hypothesis-view.ts`
- `src/lib/article-hypothesis-review-state.ts`
- `src/app/api/articles/[articleId]/hypotheses/[candidateId]/review/route.ts`

### 17.4 Generate report

- `src/components/confirmed-case-workspace.tsx`
- `src/lib/manex-confirmed-case-report.ts`
- `src/lib/manex-confirmed-case-report-schema.ts`
- `src/lib/manex-confirmed-case-report-state.ts`
- `src/app/api/articles/[articleId]/hypotheses/[candidateId]/confirmed-report/route.ts`

### 17.5 Economic blast radius

- `src/components/economic-blast-radius-section.tsx`
- `src/lib/manex-case-clustering.ts`
- `src/app/traceability/page.tsx`
- `src/lib/manex-traceability.ts`

### 17.6 Send to teammates

- `src/components/confirmed-case-workspace.tsx`
- `src/lib/manex-confirmed-case-report-schema.ts`
- `src/lib/manex-confirmed-case-report-state.ts`
- `src/app/api/articles/[articleId]/hypotheses/[candidateId]/confirmed-report/route.ts`

### 17.7 AI agents

- `src/components/ask-the-agent.tsx`
- `src/app/api/agent/route.ts`
- `src/app/api/agent/execute/route.ts`
- `src/lib/agent-tools.ts`
- `src/prompts/manex-agent.ts`

## 18. Bottom line

The repo’s current product story is:

**start from ranked cases, not raw tables; confirm the best explanation with evidence; turn the confirmed explanation into a report, impact view, and team handoff; keep AI useful but approval-gated.**

That makes the app much more than a clustering demo. It is already structured as
an investigation-to-action quality workspace.
