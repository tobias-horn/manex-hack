import {
  ArrowLeft,
  CircuitBoard,
  FolderKanban,
  Orbit,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { ClusteringPipelineToggle } from "@/components/clustering-pipeline-toggle";
import {
  GlobalPipelineRunner,
  type GlobalPipelineBatchStatus,
} from "@/components/global-pipeline-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { capabilities } from "@/lib/env";
import {
  getProposedCasesDashboard,
  type GlobalInventoryItem,
} from "@/lib/manex-case-clustering";
import { getDummyProposedCasesDashboard } from "@/lib/manex-dummy-clustering";
import {
  buildCaseViewerHref,
  buildClusteringModeHref,
  parseClusteringMode,
  type ClusteringMode,
} from "@/lib/manex-clustering-mode";
import {
  buildCaseInventoryItems,
  loadArticleCaseboard,
} from "@/lib/manex-case-viewer";
import {
  getDeterministicProposedCasesDashboard,
  type DeterministicGlobalInventoryItem,
} from "@/lib/manex-deterministic-case-clustering";
import {
  getHypothesisProposedCasesDashboard,
  type HypothesisGlobalInventoryItem,
} from "@/lib/manex-hypothesis-case-clustering";
import {
  getInvestigateDashboard,
  type InvestigateGlobalInventoryItem,
} from "@/lib/manex-investigate";

export const dynamic = "force-dynamic";

function Metric({
  label,
  value,
  caption,
}: {
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <div className="rounded-[22px] bg-[color:var(--surface-low)] px-4 py-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{caption}</p>
    </div>
  );
}

const toneStyles: Record<string, string> = {
  validated_case: "bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]",
  watchlist: "bg-[color:rgba(208,141,37,0.14)] text-[var(--warning-foreground)]",
  noise_bucket: "bg-[color:rgba(20,32,42,0.08)] text-foreground",
  rejected_case: "bg-[color:rgba(178,69,63,0.1)] text-[var(--destructive)]",
};

function inventoryHref(
  item:
    | GlobalInventoryItem
    | DeterministicGlobalInventoryItem
    | HypothesisGlobalInventoryItem
    | InvestigateGlobalInventoryItem,
  mode: ClusteringMode,
) {
  const articleId = item.articleIds[0];

  if (!articleId) {
    return buildClusteringModeHref("/articles", mode);
  }

  const candidateId = item.linkedCandidateIds[0];
  return candidateId
    ? buildCaseViewerHref(candidateId, articleId, mode)
    : buildClusteringModeHref("/articles", mode);
}

function GlobalPatternSection({
  title,
  description,
  items,
  mode,
  emptyText,
}: {
  title: string;
  description: string;
  items: Array<
    | GlobalInventoryItem
    | DeterministicGlobalInventoryItem
    | HypothesisGlobalInventoryItem
    | InvestigateGlobalInventoryItem
  >;
  mode: ClusteringMode;
  emptyText: string;
}) {
  return (
    <Card className="surface-sheet rounded-[30px] px-0 py-0">
      <CardHeader className="px-6 pt-6">
        <CardTitle className="section-title">{title}</CardTitle>
        <CardDescription className="mt-2 max-w-3xl leading-6">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        {items.length ? (
          items.map((item) => (
            <article
              key={item.inventoryTempId}
              className="rounded-[26px] border border-white/10 bg-black/8 p-5"
            >
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge className={toneStyles[item.inventoryKind]}>
                      {item.inventoryKind.replaceAll("_", " ")}
                    </Badge>
                    <Badge variant="outline">{item.caseTypeHint}</Badge>
                    <Badge variant="outline">
                      {item.priority} · {Math.round(item.confidence * 100)}%
                    </Badge>
                    {item.articleIds.length ? (
                      item.articleIds.map((articleId) => (
                        <Badge key={articleId} variant="outline">
                          {articleId}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="outline">Global</Badge>
                    )}
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{item.title}</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      {item.oneLineExplanation}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.strongestEvidence.slice(0, 5).map((evidence) => (
                      <Badge key={evidence} variant="secondary">
                        {evidence}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="flex w-full flex-col gap-3 xl:w-[260px] xl:flex-none">
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] px-4 py-4 text-sm leading-6 text-[var(--muted-foreground)]">
                    {item.summary}
                  </div>
                  <Button
                    size="lg"
                    variant="outline"
                    render={
                      <Link href={inventoryHref(item, mode)}>
                        <CircuitBoard className="size-4" />
                        Open case
                      </Link>
                    }
                  />
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-4 py-5 text-sm leading-6 text-[var(--muted-foreground)]">
            {emptyText}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type ArticlesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ArticlesPage({ searchParams }: ArticlesPageProps) {
  const search = await searchParams;
  const mode = parseClusteringMode(search.pipeline);
  const dummyDashboard =
    mode === "dummy" ? await getDummyProposedCasesDashboard() : null;
  const investigateDashboard =
    mode === "investigate" ? await getInvestigateDashboard() : null;
  const dashboard =
    mode === "dummy"
      ? (dummyDashboard ?? (await getHypothesisProposedCasesDashboard()))
      : mode === "deterministic"
      ? await getDeterministicProposedCasesDashboard()
      : mode === "hypothesis"
        ? await getHypothesisProposedCasesDashboard()
        : await getProposedCasesDashboard();
  const globalInventory =
    mode === "investigate"
      ? investigateDashboard?.globalInventory ?? null
      : dashboard.globalInventory;
  const crossArticleCases =
    mode === "dummy"
      ? globalInventory?.validatedCases ?? []
      : globalInventory?.validatedCases.filter((item) => item.articleIds.length > 1) ?? [];
  const watchlists = globalInventory?.watchlists ?? [];
  const leadingIndicators: Array<HypothesisGlobalInventoryItem | InvestigateGlobalInventoryItem> =
    (mode === "hypothesis" || mode === "dummy") &&
    globalInventory &&
    "leadingIndicators" in globalInventory &&
    Array.isArray(globalInventory.leadingIndicators)
      ? (globalInventory.leadingIndicators as HypothesisGlobalInventoryItem[])
      : [];
  const noiseBuckets = globalInventory?.noiseBuckets ?? [];
  const rejectedCases = globalInventory?.rejectedCases ?? [];
  const globalPatterns = [...crossArticleCases, ...watchlists, ...leadingIndicators, ...noiseBuckets, ...rejectedCases];
  const articleQueues =
    mode === "investigate"
      ? investigateDashboard?.articleQueues ?? []
      : dashboard.articleQueues;
  const caseInventory = buildCaseInventoryItems(
    await Promise.all(articleQueues.map((article) => loadArticleCaseboard(article.articleId, mode))),
  );
  const activeRuns =
    mode === "investigate" ? investigateDashboard?.activeRuns ?? [] : dashboard.activeRuns;
  const toggleItems = [
    {
      mode: "current" as const,
      label: "Classic three-layer clustering",
      description: "Original dossier, article-case, and global reconciliation flow.",
      href: buildClusteringModeHref("/articles", "current"),
    },
    {
      mode: "deterministic" as const,
      label: "Deterministic issue grouping",
      description: "Per-product issue extraction with deterministic article and global grouping.",
      href: buildClusteringModeHref("/articles", "deterministic"),
    },
    {
      mode: "hypothesis" as const,
      label: "Case hypothesis engine",
      description:
        "Mechanism-family analyzers rank supplier, process, design, handling, and noise investigations before AI writes the narrative.",
      href: buildClusteringModeHref("/articles", "hypothesis"),
    },
    {
      mode: "investigate" as const,
      label: "Statistical anomaly RCA",
      description:
        "Direct SQL sweeps plus OpenAI root-cause narration without the clustered case pipeline.",
      href: buildClusteringModeHref("/articles", "investigate"),
    },
    {
      mode: "dummy" as const,
      label: "Seeded dummy run",
      description:
        "Read-only completed run populated with the four published challenge stories so UI work can continue immediately.",
      href: buildClusteringModeHref("/articles", "dummy"),
    },
  ];
  const pipelineLabel =
    mode === "deterministic"
      ? "Deterministic issue-grouping pipeline"
      : mode === "hypothesis"
        ? "Case hypothesis engine"
        : mode === "investigate"
          ? "Statistical anomaly RCA"
          : mode === "dummy"
            ? "Seeded challenge dummy mode"
      : "Classic three-layer pipeline";
  const pipelineDescription =
    mode === "deterministic"
      ? "Run the bounded deterministic batch. Each article keeps its own issue extraction, then the batch reconciles the latest article-local outputs into a separate deterministic global view."
      : mode === "hypothesis"
        ? "Run the hypothesis engine batch. It reuses the shared product dossier, generates supplier/process/design/handling/noise candidates deterministically, scores overlap, then adds bounded AI narratives after the cases are already formed."
        : mode === "investigate"
          ? "Run the direct statistical anomaly batch. Each article gets six SQL evidence tables, OpenAI returns structured root-cause stories, and the dashboard aggregates those article-local findings without cluster merging."
          : mode === "dummy"
            ? "This mode does not execute clustering. It mounts a finished, read-only dummy run shaped around the four published challenge stories so the global and article UX can keep moving."
      : "Launch the original full dataset pipeline from Global Intelligence. This reports queue depth, live stage distribution, and article-by-article outcomes while the batch is still running.";
  const batchRoute =
    mode === "dummy"
      ? "/api/articles/cluster-all-hypothesis"
      : mode === "deterministic"
      ? "/api/articles/cluster-all-deterministic"
      : mode === "hypothesis"
        ? "/api/articles/cluster-all-hypothesis"
        : mode === "investigate"
          ? "/api/articles/cluster-all-investigate"
      : "/api/articles/cluster-all";
  const dummyBatch: GlobalPipelineBatchStatus | undefined =
    mode === "dummy"
      ? {
          status: "completed",
          requestedArticleIds: articleQueues.map((article) => article.articleId),
          totalArticleCount: articleQueues.length,
          startedAt: "2026-04-19T08:05:00.000Z",
          completedAt: "2026-04-19T08:09:00.000Z",
          lastUpdatedAt: "2026-04-19T08:09:00.000Z",
          concurrency: 4,
          okCount: articleQueues.length,
          errorCount: 0,
          errorMessage: null,
            articleResults: articleQueues.map((article) => ({
              articleId: article.articleId,
              ok: true,
              runId: article.latestRun?.id ?? null,
              issueCount:
                article.latestRun && "issueCount" in article.latestRun
                  ? article.latestRun.issueCount ?? 0
                  : 0,
              caseCount: article.proposedCaseCount,
              validatedCount: article.proposedCaseCount,
              watchlistCount: 1,
            noiseCount: 1,
            error: null,
            completedAt: article.latestRun?.completedAt ?? "2026-04-19T08:09:00.000Z",
          })),
        }
      : undefined;

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border spec-grid overflow-hidden rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <Sparkles className="size-3.5" />
                Overview
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                Global intelligence
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                A cross-article view of the current quality landscape, combining
                broader system patterns with the articles that currently stand
                out for review.
              </p>
            </div>

            <Button
              size="lg"
              variant="outline"
              render={
                <Link href="/">
                  <ArrowLeft className="size-4" />
                  Back to inbox
                </Link>
              }
            />
          </div>
        </header>

        <ClusteringPipelineToggle currentMode={mode} items={toggleItems} />

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_380px]">
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Patterns"
                value={globalPatterns.length}
                caption="Global watchlists, leading indicators, noise, and cross-article anomalies."
              />
              <Metric
                label="Watchlists"
                value={watchlists.length}
                caption="Things to monitor, not active article cases."
              />
              <Metric
                label="Detected noise"
                value={noiseBuckets.length + rejectedCases.length}
                caption="Distractors and down-ranked patterns."
              />
              <Metric
                label="Cases"
                value={caseInventory.length}
                caption="Ranked cases ready to open directly in the dedicated viewer."
              />
            </div>

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <Orbit className="size-3.5" />
                  Global patterns
                </Badge>
                <CardTitle className="section-title mt-3">
                  Watchlists, noise, and cross-article anomalies
                </CardTitle>
                <CardDescription className="mt-2 max-w-3xl leading-6">
                  This is not the main case list for the whole system. It is the
                  global intelligence layer: things to monitor, suppress, or compare
                  across articles before opening a focused case viewer.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 px-5 pb-5">
                <GlobalPatternSection
                  title="Cross-Article Anomalies"
                  description="Patterns that appear to connect more than one article family."
                  items={crossArticleCases}
                  mode={mode}
                  emptyText="No cross-article anomalies were promoted in the latest global pass."
                />
                <GlobalPatternSection
                  title="Watchlists"
                  description="Global monitoring patterns that should stay visible without becoming active cases."
                  items={watchlists}
                  mode={mode}
                  emptyText="No watchlists were emitted in the latest global pass."
                />
                {mode === "hypothesis" || mode === "dummy" ? (
                  <GlobalPatternSection
                    title="Leading Indicators"
                    description="Near-limit and marginal patterns that stayed visible as early warnings instead of becoming active investigations."
                    items={leadingIndicators}
                    mode={mode}
                    emptyText="No leading indicators were emitted in the latest global pass."
                  />
                ) : null}
                <GlobalPatternSection
                  title="Noise and distractors"
                  description="False positives, weak-only patterns, and suspected detection bias the system wants you to ignore or down-rank."
                  items={[...noiseBuckets, ...rejectedCases]}
                  mode={mode}
                  emptyText="No explicit noise buckets were emitted in the latest global pass."
                />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <GlobalPipelineRunner
              key={`${mode}:${mode === "investigate" ? investigateDashboard?.latestBatch?.id ?? "none" : dashboard.latestGlobalRun?.id ?? "none"}:${activeRuns.map((run) => run.id).join(",")}`}
              hasAi={capabilities.hasAi}
              initialActiveRuns={activeRuns}
              initialBatch={dummyBatch}
              routePath={batchRoute}
              pipelineLabel={pipelineLabel}
              pipelineDescription={pipelineDescription}
              startButtonLabel={
                mode === "deterministic"
                  ? "Run deterministic batch"
                  : mode === "hypothesis"
                    ? "Run hypothesis batch"
                    : mode === "investigate"
                      ? "Run statistical batch"
                      : mode === "dummy"
                        ? "Replay seeded batch"
                  : "Run complete pipeline"
              }
              supportsStop
              derivedCountLabel={
                mode === "hypothesis" || mode === "dummy"
                  ? "ranked hypotheses"
                  : mode === "investigate"
                    ? "statistical stories"
                    : "issues"
              }
              readOnly={mode === "dummy"}
              readOnlyMessage={
                mode === "dummy"
                  ? "This batch is pre-filled from the four published challenge stories. It is read-only by design so the team can iterate on UI and reporting without touching live clustering state."
                  : undefined
              }
            />

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <FolderKanban className="size-3.5" />
                  Ranked cases
                </Badge>
                <CardTitle className="section-title mt-3">
                  Case investigation inventory
                </CardTitle>
                <CardDescription className="mt-2 max-w-3xl leading-6">
                  This is the investigation entry point. Open a case directly, keep one explanation in focus, and avoid bouncing through an article-wide board first.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {caseInventory.length ? (
                  caseInventory.map((item) => (
                    <article
                      key={item.caseId}
                      className="rounded-[24px] border border-white/10 bg-black/8 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{item.articleId}</Badge>
                        <Badge variant="outline">
                          {item.caseKind}
                        </Badge>
                        <Badge variant="outline">
                          {item.affectedProductCount} affected products
                        </Badge>
                        <Badge variant="outline">{item.priority}</Badge>
                        {item.confidence !== null ? (
                          <Badge variant="outline">
                            {Math.round(item.confidence * 100)}% confidence
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-3 font-medium">
                        {item.title}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                        {item.summary}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.articleName ? (
                          <Badge variant="secondary">{item.articleName}</Badge>
                        ) : null}
                        <Badge variant="secondary">
                          {item.signalCount} signals in case
                        </Badge>
                        <Badge variant="secondary">
                          {item.articleCaseCount} ranked cases in article
                        </Badge>
                        {item.strongestEvidence.slice(0, 2).map((evidence) => (
                          <Badge key={evidence} variant="secondary">
                            {evidence}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          render={
                            <Link href={buildCaseViewerHref(item.caseId, item.articleId, mode)}>
                              Open case viewer
                            </Link>
                          }
                        />
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-4 py-5 text-sm leading-6 text-[var(--muted-foreground)]">
                    No ranked cases are available to open yet.
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </section>
      </div>
    </main>
  );
}
