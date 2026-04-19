import {
  ArrowLeft,
  CircuitBoard,
  ChevronDown,
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
import { Button, buttonVariants } from "@/components/ui/button";
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
} from "@/lib/manex-clustering-mode";
import {
  buildCaseInventoryItems,
  loadArticleCaseboard,
  type CaseInventoryItem,
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
import { formatUiDateTime } from "@/lib/ui-format";

export const dynamic = "force-dynamic";

function HeadlineMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[color:rgba(255,255,255,0.66)] px-4 py-3 shadow-[0_12px_26px_rgba(20,32,42,0.04)] backdrop-blur-sm dark:bg-[color:rgba(23,34,43,0.7)]">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-[1.65rem] font-semibold tracking-[-0.04em]">{value}</div>
      <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{detail}</p>
    </div>
  );
}

const toneStyles: Record<string, string> = {
  validated_case: "bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]",
  watchlist: "bg-[color:rgba(208,141,37,0.14)] text-[var(--warning-foreground)]",
  noise_bucket: "bg-[color:rgba(20,32,42,0.08)] text-foreground",
  rejected_case: "bg-[color:rgba(178,69,63,0.1)] text-[var(--destructive)]",
};

const priorityTone: Record<string, string> = {
  critical: "bg-[color:rgba(178,69,63,0.12)] text-[var(--destructive)]",
  high: "bg-[color:rgba(208,141,37,0.16)] text-[var(--warning-foreground)]",
  medium: "bg-[color:rgba(20,32,42,0.08)] text-foreground",
  low: "bg-[color:rgba(20,32,42,0.08)] text-foreground",
};

function trimInventorySummary(value: string, maxLength = 210) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength).replace(/[,:;\-\s]+$/, "")}…`;
}

function CaseInventoryCard({
  item,
  mode,
}: {
  item: CaseInventoryItem;
  mode: ReturnType<typeof parseClusteringMode>;
}) {
  const compactFacts = [
    `${item.affectedProductCount} products`,
    `${item.signalCount} signals`,
    item.articleCaseCount === 1 ? "Top case in article" : `${item.articleCaseCount} ranked cases`,
  ];

  return (
    <article className="rounded-[30px] border border-[color:rgba(20,32,42,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(247,250,252,0.99))] p-6 shadow-[0_1px_0_rgba(255,255,255,0.85),0_22px_44px_rgba(20,32,42,0.06)] dark:border-white/12 dark:bg-[linear-gradient(180deg,rgba(30,41,51,0.96),rgba(19,27,35,0.98))] sm:p-7">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]">
              {item.articleId}
            </Badge>
            <Badge variant="outline">{item.caseKind.replaceAll("_", " ")}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={priorityTone[item.priority] ?? priorityTone.low}>
              <span className="capitalize">{item.priority}</span> priority
            </Badge>
            {item.confidence !== null ? (
              <div className="text-sm font-medium tracking-[0.08em] text-[var(--muted-foreground)] uppercase">
                {Math.round(item.confidence * 100)}% confidence
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="max-w-4xl text-[1.44rem] leading-[1.06] font-semibold tracking-[-0.045em] text-foreground sm:text-[1.7rem]">
            {item.title}
          </div>
          <p className="max-w-3xl text-[1rem] leading-7 text-[var(--muted-foreground)]">
            {trimInventorySummary(item.summary)}
          </p>
        </div>

        <div className="rounded-[18px] border border-[color:rgba(20,32,42,0.08)] bg-[color:rgba(20,32,42,0.03)] px-4 py-3 dark:border-white/10 dark:bg-white/4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--muted-foreground)]">
            {compactFacts.map((fact, index) => (
              <div key={fact} className="flex items-center gap-4">
                {index > 0 ? (
                  <span className="hidden h-1 w-1 rounded-full bg-[color:rgba(92,109,127,0.55)] sm:block" />
                ) : null}
                <span className="font-medium text-foreground">{fact}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-[color:rgba(20,32,42,0.08)] pt-5 dark:border-white/10 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="text-base font-semibold text-foreground">
              {item.articleName ?? "Article-local case"}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-6 text-[var(--muted-foreground)]">
              {item.updatedAt ? <span>Updated {formatUiDateTime(item.updatedAt)}</span> : null}
            </div>
          </div>
          <Link
            href={buildCaseViewerHref(item.caseId, item.articleId, mode)}
            className={buttonVariants({
              size: "default",
              variant: "outline",
              className:
                "w-full border-[color:rgba(20,32,42,0.14)] bg-white/75 md:w-auto md:min-w-[208px]",
            })}
          >
            Open case viewer
          </Link>
        </div>
      </div>
    </article>
  );
}

function RankedCaseInventorySection({
  caseInventory,
  mode,
}: {
  caseInventory: CaseInventoryItem[];
  mode: ReturnType<typeof parseClusteringMode>;
}) {
  return (
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
          Open a case directly from the strongest candidates. This list stays
          intentionally brief so the detail view can carry the full evidence.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 px-5 pb-6">
        {caseInventory.length ? (
          caseInventory.map((item) => (
            <CaseInventoryCard key={item.caseId} item={item} mode={mode} />
          ))
        ) : (
          <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-4 py-5 text-sm leading-6 text-[var(--muted-foreground)]">
            No ranked cases are available to open yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GlobalPatternSection({
  title,
  description,
  items,
  emptyText,
  resolveHref,
  collapsedByDefault = false,
}: {
  title: string;
  description: string;
  items: Array<
    | GlobalInventoryItem
    | DeterministicGlobalInventoryItem
    | HypothesisGlobalInventoryItem
    | InvestigateGlobalInventoryItem
  >;
  emptyText: string;
  resolveHref: (
    item:
      | GlobalInventoryItem
      | DeterministicGlobalInventoryItem
      | HypothesisGlobalInventoryItem
      | InvestigateGlobalInventoryItem,
  ) => string | null;
  collapsedByDefault?: boolean;
}) {
  const content = (
    <div className="space-y-4">
      {items.length ? (
        items.map((item) => {
          const href = resolveHref(item);

          return (
            <article
              key={item.inventoryTempId}
              className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(246,249,251,0.98))] p-5 shadow-[0_18px_38px_rgba(20,32,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(30,41,51,0.94),rgba(19,27,35,0.98))]"
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
                  {href ? (
                    <Link
                      href={href}
                      className={buttonVariants({ size: "lg", variant: "outline" })}
                    >
                      <CircuitBoard className="size-4" />
                      Open case
                    </Link>
                  ) : (
                    <div
                      className={buttonVariants({
                        size: "lg",
                        variant: "outline",
                        className: "pointer-events-none opacity-50",
                      })}
                    >
                      <CircuitBoard className="size-4" />
                      No ranked case yet
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })
      ) : (
        <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-4 py-5 text-sm leading-6 text-[var(--muted-foreground)]">
          {emptyText}
        </div>
      )}
    </div>
  );

  if (collapsedByDefault) {
    return (
      <details className="surface-sheet group rounded-[30px]">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-6 py-6 [&::-webkit-details-marker]:hidden">
          <span className="block space-y-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="section-title">{title}</span>
              <Badge variant="outline">{items.length}</Badge>
            </span>
            <span className="block max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
              {description}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-[color:var(--surface-low)] px-3 py-2 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
            <span className="group-open:hidden">Expand</span>
            <span className="hidden group-open:inline">Collapse</span>
            <ChevronDown className="size-4 transition-transform duration-200 group-open:rotate-180" />
          </span>
        </summary>
        <div className="px-5 pb-5">{content}</div>
      </details>
    );
  }

  return (
    <Card className="surface-sheet rounded-[30px] px-0 py-0">
      <CardHeader className="px-6 pt-6">
        <CardTitle className="section-title">{title}</CardTitle>
        <CardDescription className="mt-2 max-w-3xl leading-6">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">{content}</CardContent>
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
  const firstCaseByArticleId = new Map(
    caseInventory.map((item) => [item.articleId, item.caseId] as const),
  );
  const resolveInventoryHref = (
    item:
      | GlobalInventoryItem
      | DeterministicGlobalInventoryItem
      | HypothesisGlobalInventoryItem
      | InvestigateGlobalInventoryItem,
  ) => {
    const articleId = item.articleIds[0];

    if (!articleId) {
      return null;
    }

    const candidateId =
      item.linkedCandidateIds.find((value) => value.trim().length > 0) ??
      item.articleIds
        .map((value) => firstCaseByArticleId.get(value) ?? null)
        .find((value): value is string => Boolean(value));

    return candidateId ? buildCaseViewerHref(candidateId, articleId, mode) : null;
  };
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
        <header className="glass-panel ghost-border spec-grid overflow-hidden rounded-[30px] px-5 py-6 sm:px-6 sm:py-7">
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    <Sparkles className="size-3.5" />
                    Default workspace
                  </Badge>
                  <Badge>{pipelineLabel}</Badge>
                </div>
                <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                  Global intelligence
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                  One landing surface for ranked cases, cross-article patterns, and the
                  currently active investigation engine. Open the strongest case directly,
                  then drop into the focused viewer only when you need proof.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  size="lg"
                  variant="outline"
                  render={
                    <Link href="/inbox">
                      <ArrowLeft className="size-4" />
                      Open inbox
                    </Link>
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <HeadlineMetric
                label="Ranked cases"
                value={caseInventory.length}
                detail={`${articleQueues.length} articles currently in scope`}
              />
              <HeadlineMetric
                label="Cross-article"
                value={crossArticleCases.length}
                detail={`${watchlists.length} watchlists still visible`}
              />
              <HeadlineMetric
                label="Noise + rejects"
                value={noiseBuckets.length + rejectedCases.length}
                detail={`${globalPatterns.length} global patterns surfaced`}
              />
              <HeadlineMetric
                label="Active runs"
                value={activeRuns.length}
                detail={
                  activeRuns.length
                    ? `${activeRuns.length} article runs are still live`
                    : "No live article batches right now"
                }
              />
              <HeadlineMetric
                label="Engine"
                value={
                  mode === "current"
                    ? "Classic"
                    : mode === "deterministic"
                      ? "Deterministic"
                      : mode === "hypothesis"
                        ? "Hypothesis"
                        : mode === "investigate"
                          ? "Statistical"
                          : "Dummy"
                }
                detail="Collapsed switcher below keeps engine changes out of the main scan path"
              />
            </div>
          </div>
        </header>

        <ClusteringPipelineToggle currentMode={mode} items={toggleItems} />

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_380px]">
          <div className="space-y-6">
            <RankedCaseInventorySection caseInventory={caseInventory} mode={mode} />

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
                  emptyText="No cross-article anomalies were promoted in the latest global pass."
                  resolveHref={resolveInventoryHref}
                />
                <GlobalPatternSection
                  title="Watchlists"
                  description="Global monitoring patterns that should stay visible without becoming active cases."
                  items={watchlists}
                  emptyText="No watchlists were emitted in the latest global pass."
                  resolveHref={resolveInventoryHref}
                  collapsedByDefault
                />
                {mode === "hypothesis" || mode === "dummy" ? (
                  <GlobalPatternSection
                    title="Leading Indicators"
                    description="Near-limit and marginal patterns that stayed visible as early warnings instead of becoming active investigations."
                    items={leadingIndicators}
                    emptyText="No leading indicators were emitted in the latest global pass."
                    resolveHref={resolveInventoryHref}
                  />
                ) : null}
                <GlobalPatternSection
                  title="Noise and distractors"
                  description="False positives, weak-only patterns, and suspected detection bias the system wants you to ignore or down-rank."
                  items={[...noiseBuckets, ...rejectedCases]}
                  emptyText="No explicit noise buckets were emitted in the latest global pass."
                  resolveHref={resolveInventoryHref}
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
          </div>
        </section>
      </div>
    </main>
  );
}
