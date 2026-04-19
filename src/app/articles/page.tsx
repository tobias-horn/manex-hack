import {
  ArrowLeft,
  CircuitBoard,
  EyeOff,
  FolderKanban,
  Orbit,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { ClusteringPipelineToggle } from "@/components/clustering-pipeline-toggle";
import { GlobalPipelineRunner } from "@/components/global-pipeline-runner";
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
import {
  buildClusteringModeHref,
  parseClusteringMode,
  type ClusteringMode,
} from "@/lib/manex-clustering-mode";
import {
  getDeterministicProposedCasesDashboard,
  type DeterministicGlobalInventoryItem,
} from "@/lib/manex-deterministic-case-clustering";
import {
  getHypothesisProposedCasesDashboard,
  type HypothesisGlobalInventoryItem,
} from "@/lib/manex-hypothesis-case-clustering";
import { formatUiDateTime } from "@/lib/ui-format";

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
    | HypothesisGlobalInventoryItem,
  mode: ClusteringMode,
) {
  const articleId = item.articleIds[0];

  if (!articleId) {
    return buildClusteringModeHref("/articles", mode);
  }

  const candidateId = item.linkedCandidateIds[0];
  return candidateId
    ? buildClusteringModeHref(`/articles/${articleId}?case=${candidateId}`, mode)
    : buildClusteringModeHref(`/articles/${articleId}`, mode);
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
    GlobalInventoryItem | DeterministicGlobalInventoryItem | HypothesisGlobalInventoryItem
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
                        Open article
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
  const dashboard =
    mode === "deterministic"
      ? await getDeterministicProposedCasesDashboard()
      : mode === "hypothesis"
        ? await getHypothesisProposedCasesDashboard()
        : await getProposedCasesDashboard();
  const crossArticleCases =
    dashboard.globalInventory?.validatedCases.filter((item) => item.articleIds.length > 1) ?? [];
  const watchlists = dashboard.globalInventory?.watchlists ?? [];
  const leadingIndicators =
    mode === "hypothesis" && dashboard.globalInventory && "leadingIndicators" in dashboard.globalInventory
      ? dashboard.globalInventory.leadingIndicators
      : [];
  const noiseBuckets = dashboard.globalInventory?.noiseBuckets ?? [];
  const rejectedCases = dashboard.globalInventory?.rejectedCases ?? [];
  const globalPatterns = [...crossArticleCases, ...watchlists, ...leadingIndicators, ...noiseBuckets, ...rejectedCases];
  const articleQueues = dashboard.articleQueues;
  const activeRuns = dashboard.activeRuns;
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
  ];
  const pipelineLabel =
    mode === "deterministic"
      ? "Deterministic issue-grouping pipeline"
      : mode === "hypothesis"
        ? "Case hypothesis engine"
      : "Classic three-layer pipeline";
  const pipelineDescription =
    mode === "deterministic"
      ? "Run the bounded deterministic batch. Each article keeps its own issue extraction, then the batch reconciles the latest article-local outputs into a separate deterministic global view."
      : mode === "hypothesis"
        ? "Run the hypothesis engine batch. It reuses the shared product dossier, generates supplier/process/design/handling/noise candidates deterministically, scores overlap, then adds bounded AI narratives after the cases are already formed."
      : "Launch the original full dataset pipeline from Global Intelligence. This reports queue depth, live stage distribution, and article-by-article outcomes while the batch is still running.";
  const batchRoute =
    mode === "deterministic"
      ? "/api/articles/cluster-all-deterministic"
      : mode === "hypothesis"
        ? "/api/articles/cluster-all-hypothesis"
      : "/api/articles/cluster-all";

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <Sparkles className="size-3.5" />
                Global intelligence
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                Global intelligence
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                This screen has two jobs: surface global patterns that should be
                monitored or suppressed, and show which articles currently have
                meaningful proposed cases worth opening for investigation.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge>{capabilities.hasAi ? "LLM pipeline live" : "OpenAI key missing"}</Badge>
                <Badge variant="outline">{pipelineLabel}</Badge>
                <Badge variant="outline">{globalPatterns.length} global patterns</Badge>
                <Badge variant="outline">
                  {articleQueues.length} articles with proposed cases
                </Badge>
              </div>
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
                label="Article queues"
                value={articleQueues.length}
                caption="Articles currently carrying proposed cases."
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
                  across articles before opening an article workspace.
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
                {mode === "hypothesis" ? (
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
              key={`${mode}:${dashboard.latestGlobalRun?.id ?? "none"}:${activeRuns.map((run) => run.id).join(",")}`}
              hasAi={capabilities.hasAi}
              initialActiveRuns={activeRuns}
              routePath={batchRoute}
              pipelineLabel={pipelineLabel}
              pipelineDescription={pipelineDescription}
              startButtonLabel={
                mode === "deterministic"
                  ? "Run deterministic batch"
                  : mode === "hypothesis"
                    ? "Run hypothesis batch"
                  : "Run complete pipeline"
              }
              supportsStop
              derivedCountLabel={mode === "hypothesis" ? "ranked hypotheses" : "issues"}
            />

            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <ShieldAlert className="size-3.5" />
                  Latest global pass
                </Badge>
                <CardTitle className="section-title mt-3">
                  Reconciliation state
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Run</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {dashboard.latestGlobalRun
                      ? `${dashboard.latestGlobalRun.articleId} · ${dashboard.latestGlobalRun.model}`
                      : "No completed pipeline run has persisted a global inventory yet."}
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Completed</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {dashboard.latestGlobalRun?.completedAt
                      ? formatUiDateTime(dashboard.latestGlobalRun.completedAt)
                      : "Not completed yet"}
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Summary</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {dashboard.globalInventory?.inventorySummary ??
                      "Once a run completes, this panel will summarize how the global pass separated real cases from watchlists and noise."}
                  </p>
                </div>
                {dashboard.globalInventory?.confidenceNotes.length ? (
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Confidence notes</div>
                    <div className="mt-2 space-y-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      {dashboard.globalInventory.confidenceNotes.map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <FolderKanban className="size-3.5" />
                  Articles with proposed cases
                </Badge>
                <CardTitle className="section-title mt-3">
                  Article investigation inventory
                </CardTitle>
                <CardDescription className="mt-2 max-w-3xl leading-6">
                  This is the real investigation entry point. Open an article when
                  it already has article-wide proposed cases worth reviewing.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {articleQueues.length ? (
                  articleQueues.map((article) => (
                    <article
                      key={article.articleId}
                      className="rounded-[24px] border border-white/10 bg-black/8 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{article.articleId}</Badge>
                        <Badge variant="outline">
                          {article.proposedCaseCount} proposed cases
                        </Badge>
                        <Badge variant="outline">
                          {article.affectedProductCount} affected products
                        </Badge>
                        {article.highestPriority ? (
                          <Badge variant="outline">
                            Highest priority: {article.highestPriority}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-3 font-medium">
                        {article.articleName ?? "Unnamed article"}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                        {article.leadingCaseTitle
                          ? `${article.leadingCaseTitle}${
                              article.topConfidence !== null
                                ? ` · ${Math.round(article.topConfidence * 100)}% confidence`
                                : ""
                            }`
                          : "Proposed cases are available for review."}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                        {article.summary ?? "No article summary available yet."}
                      </p>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          render={
                            <Link href={buildClusteringModeHref(`/articles/${article.articleId}`, mode)}>
                              Open article
                            </Link>
                          }
                        />
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-4 py-5 text-sm leading-6 text-[var(--muted-foreground)]">
                    No article currently has proposed cases to review.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <EyeOff className="size-3.5" />
                  Merge log
                </Badge>
                <CardTitle className="section-title mt-3">
                  What got suppressed or merged
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-5 pb-5 text-sm leading-6 text-[var(--muted-foreground)]">
                {dashboard.globalInventory?.caseMergeLog.length ? (
                  dashboard.globalInventory.caseMergeLog.map((item) => (
                    <p key={item}>{item}</p>
                  ))
                ) : (
                  <p>No merge or suppression notes are available yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
