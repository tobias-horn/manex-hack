import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CircleOff,
  Link2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleClusterRunner } from "@/components/article-cluster-runner";
import { ClusteringPipelineToggle } from "@/components/clustering-pipeline-toggle";
import { ProductActionPanel } from "@/components/product-action-panel";
import { QualitySignalImage } from "@/components/quality-signal-image";
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
import { getArticleCaseboard } from "@/lib/manex-case-clustering";
import {
  buildClusteringModeHref,
  parseClusteringMode,
} from "@/lib/manex-clustering-mode";
import { getDeterministicArticleCaseboard } from "@/lib/manex-deterministic-case-clustering";
import type { Initiative } from "@/lib/quality-workspace";
import { formatUiDateTime } from "@/lib/ui-format";

export const dynamic = "force-dynamic";

type ArticleCaseboardPageProps = {
  params: Promise<{ articleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const signalTone = {
  defect: "bg-[color:rgba(0,92,151,0.1)] text-[var(--primary)]",
  field_claim: "bg-[color:rgba(178,69,63,0.1)] text-[var(--destructive)]",
  bad_test: "bg-[color:rgba(178,69,63,0.12)] text-[var(--destructive)]",
  marginal_test: "bg-[color:rgba(208,141,37,0.14)] text-[var(--warning-foreground)]",
};

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
}

function normalizeQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getSuspectedMechanism(candidate: Record<string, unknown> | null) {
  if (typeof candidate?.suspectedCommonRootCause === "string") {
    return candidate.suspectedCommonRootCause;
  }

  return "Deterministic grouping kept this case together because multiple bounded product issue cards reused the same anchors, evidence phrases, and fingerprint tokens across the article.";
}

function getConflictingEvidence(candidate: Record<string, unknown> | null) {
  return Array.isArray(candidate?.conflictingEvidence)
    ? candidate.conflictingEvidence.filter((item): item is string => typeof item === "string")
    : [];
}

function mapActionsToFeed(
  actions: Array<{
    id: string;
    productId: string;
    defectId: string | null;
    actionType: string;
    status: string;
    comments: string;
    recordedAt: string;
  }>,
): Initiative[] {
  return actions.map((action) => ({
    id: action.id,
    productId: action.productId,
    defectId: action.defectId,
    actionType: action.actionType,
    status: action.status,
    comments: action.comments || "No notes attached.",
    timestamp: formatUiDateTime(action.recordedAt),
  }));
}

function TopChips({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
      <div className="eyebrow">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length ? (
          items.map((item) => (
            <Badge key={item} variant="secondary">
              {item}
            </Badge>
          ))
        ) : (
          <p className="text-sm leading-6 text-[var(--muted-foreground)]">Nothing dominant yet.</p>
        )}
      </div>
    </div>
  );
}

export default async function ArticleCaseboardPage({
  params,
  searchParams,
}: ArticleCaseboardPageProps) {
  const { articleId } = await params;
  const search = await searchParams;
  const selectedCaseId = normalizeQueryValue(search.case);
  const mode = parseClusteringMode(search.pipeline);
  const caseboard =
    mode === "deterministic"
      ? await getDeterministicArticleCaseboard(articleId)
      : await getArticleCaseboard(articleId);

  if (!caseboard) {
    notFound();
  }

  const dossier = caseboard.dossier;
  const proposedCases = caseboard.proposedCases;
  const selectedCase =
    proposedCases.find((candidate) => candidate.id === selectedCaseId) ??
    proposedCases[0] ??
    null;
  const selectedThreads =
    selectedCase && dossier
      ? dossier.productThreads.filter((thread) =>
          selectedCase.includedProductIds.includes(thread.productId),
        )
      : dossier?.productThreads.filter((thread) => thread.signals.length > 0).slice(0, 3) ?? [];

  const selectedTimeline = selectedThreads
    .flatMap((thread) =>
      thread.signals.map((signal) => ({
        ...signal,
        productId: thread.productId,
        productSummary: thread.stage1Synthesis.productSummary,
      })),
    )
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 18);

  const selectedFrames = selectedThreads
    .flatMap((thread) => thread.evidenceFrames)
    .filter(
      (frame, index, collection) =>
        collection.findIndex((candidate) => candidate.id === frame.id) === index,
    )
    .slice(0, 6);

  const selectedReportedParts = uniqueStrings(
    selectedThreads.flatMap((thread) => thread.summaryFeatures.reportedPartNumbers),
  ).slice(0, 8);
  const selectedFindNumbers = uniqueStrings(
    selectedThreads.flatMap((thread) => thread.summaryFeatures.bomFindNumbers),
  ).slice(0, 8);
  const selectedBatches = uniqueStrings(
    selectedThreads.flatMap((thread) => thread.summaryFeatures.supplierBatches),
  ).slice(0, 8);
  const standaloneSignals =
    "standaloneSignals" in caseboard ? caseboard.standaloneSignals : [];
  const selectedNoiseFlags = uniqueStrings([
    ...selectedThreads.flatMap((thread) => thread.stage1Synthesis.possibleNoiseFlags),
    ...standaloneSignals
      .filter((signal) => selectedThreads.some((thread) => thread.productId === signal.productId))
      .map((signal) => signal.reason),
  ]).slice(0, 10);
  const selectedActions = mapActionsToFeed(
    selectedThreads.flatMap((thread) =>
      thread.actions.map((action) => ({
        id: action.id,
        productId: thread.productId,
        defectId: action.defectId,
        actionType: action.actionType,
        status: action.status,
        comments: action.comments,
        recordedAt: action.recordedAt,
      })),
    ),
  ).slice(0, 8);
  const defaultProductId = selectedThreads[0]?.productId ?? "";
  const defaultDefectId = selectedThreads[0]?.defects[0]?.id ?? "";
  const toggleItems = [
    {
      mode: "current" as const,
      label: "Classic three-layer clustering",
      description: "Original dossier, article-case, and global reconciliation flow.",
      href: buildClusteringModeHref(`/articles/${caseboard.articleId}`, "current"),
    },
    {
      mode: "deterministic" as const,
      label: "Deterministic issue grouping",
      description: "Small per-product issue extraction with deterministic article grouping.",
      href: buildClusteringModeHref(`/articles/${caseboard.articleId}`, "deterministic"),
    },
  ];
  const pipelineLabel =
    mode === "deterministic"
      ? "Deterministic issue-grouping pipeline"
      : "Classic three-layer pipeline";
  const runnerDescription =
    mode === "deterministic"
      ? "Stage 1 reuses the shared article dossier, extracts a few bounded issue cards per product, then groups them deterministically before reconciling the latest article output into the deterministic global view."
      : "Stage 1 builds deterministic product and article dossiers, Stage 2 drafts and reviews article-local cases, and Stage 3 reconciles the article against the latest global inventory. The output stays investigative and proposed.";
  const outsideCaseSecondaryText =
    mode === "deterministic"
      ? caseboard.incidents.length || caseboard.noise.length
        ? `${caseboard.incidents.length} single-product incidents and ${caseboard.noise.length} noise items stayed outside shared cases.`
        : "No incidents or explicit noise items were emitted in the latest deterministic run."
      : standaloneSignals.length
        ? `${standaloneSignals.length} faults stayed real but non-clustered.`
        : "No standalone faults were emitted in the latest run.";
  const conflictingEvidence = getConflictingEvidence(selectedCase as Record<string, unknown> | null);

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <Sparkles className="size-3.5" />
                Article intelligence
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                {caseboard.articleId}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                This screen separates article-wide cases from product-specific threads so
                investigators can review shared mechanisms without losing the per-unit evidence story.
              </p>
              <div className="flex flex-wrap gap-2">
                {caseboard.articleName ? <Badge variant="outline">{caseboard.articleName}</Badge> : null}
                <Badge variant="outline">{pipelineLabel}</Badge>
                {caseboard.dashboardCard ? (
                  <Badge variant="outline">
                    {caseboard.dashboardCard.productCount} products · {caseboard.dashboardCard.totalSignals} signals
                  </Badge>
                ) : null}
                <Badge variant="outline">{proposedCases.length} proposed cases</Badge>
                {caseboard.globalInventory ? (
                  <Badge variant="outline">
                    {caseboard.globalInventory.validatedCases.length} validated globally
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                variant="outline"
                render={
                  <Link href={buildClusteringModeHref("/articles", mode)}>
                    <ArrowLeft className="size-4" />
                    Back to proposed cases
                  </Link>
                }
              />
              <Button size="lg" variant="outline" render={<Link href="/">Back to inbox</Link>} />
            </div>
          </div>
        </header>

        <ClusteringPipelineToggle currentMode={mode} items={toggleItems} />

        <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_390px]">
          <div className="space-y-6">
            <ArticleClusterRunner
              key={`${mode}:${caseboard.latestRun?.id ?? "none"}:${proposedCases.length}`}
              articleId={caseboard.articleId}
              hasAi={capabilities.hasAi}
              latestRun={caseboard.latestRun}
              proposedCaseCount={proposedCases.length}
              routePath={
                mode === "deterministic"
                  ? `/api/articles/${caseboard.articleId}/cluster-deterministic`
                  : `/api/articles/${caseboard.articleId}/cluster`
              }
              pipelineLabel={pipelineLabel}
              pipelineDescription={runnerDescription}
              actionLabel={
                mode === "deterministic" ? "deterministic clustering" : "article clustering"
              }
            />

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">Article-wide cases</Badge>
                <CardTitle className="section-title mt-3">Proposed case candidates</CardTitle>
                <CardDescription className="mt-2 leading-6">
                  Each card is a shared multi-product pattern proposed by the article-local
                  clustering stage.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {proposedCases.length ? (
                  proposedCases.map((candidate) => {
                    const isSelected = selectedCase?.id === candidate.id;

                    return (
                      <Link
                        key={candidate.id}
                        href={buildClusteringModeHref(
                          `/articles/${caseboard.articleId}?case=${candidate.id}`,
                          mode,
                        )}
                        className={
                          isSelected
                            ? "block rounded-[22px] border border-[color:rgba(0,92,151,0.28)] bg-[color:rgba(0,92,151,0.08)] p-4"
                            : "block rounded-[22px] border border-white/10 bg-black/8 p-4 transition hover:border-white/20"
                        }
                      >
                        <div className="flex flex-wrap gap-2">
                          <Badge>{candidate.caseKind}</Badge>
                          <Badge variant="outline">
                            {candidate.priority} ·{" "}
                            {candidate.confidence !== null
                              ? `${Math.round(candidate.confidence * 100)}%`
                              : "n/a"}
                          </Badge>
                        </div>
                        <div className="mt-3 font-medium">{candidate.title}</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                          {candidate.summary}
                        </p>
                        <div className="mt-3 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                          {candidate.includedProductIds.length} products ·{" "}
                          {candidate.includedSignalIds.length} signals
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/10 bg-black/8 p-4 text-sm leading-6 text-[var(--muted-foreground)]">
                    Run the article pipeline to generate the first proposed cases.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <CircleOff className="size-3.5" />
                  Product-specific threads
                </Badge>
                <CardTitle className="section-title mt-3">Outside article-wide cases</CardTitle>
                <CardDescription className="mt-2 leading-6">
                  These are real product threads and signals that stayed unresolved, weak, or intentionally non-clustered.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Unassigned products</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {caseboard.unassignedProducts.length
                      ? `${caseboard.unassignedProducts.length} products were kept outside any proposed case.`
                      : "No products were left completely unassigned in the latest run."}
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Standalone faults</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {outsideCaseSecondaryText}
                  </p>
                </div>
                {mode === "deterministic" ? (
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Watchlists</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      {caseboard.watchlists.length
                        ? `${caseboard.watchlists.length} deterministic watchlists were kept visible without becoming article cases.`
                        : "No deterministic watchlists were emitted in the latest run."}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>{selectedCase ? "Article-wide case" : "Article overview"}</Badge>
                <CardTitle className="section-title mt-3">
                  {selectedCase?.title ?? "No case selected yet"}
                </CardTitle>
                <CardDescription className="mt-2 max-w-3xl leading-6">
                  {selectedCase?.summary ??
                    "Choose an article-wide case from the left rail to see which product threads support it."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 px-5 pb-5">
                {selectedCase ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{selectedCase.caseKind}</Badge>
                      <Badge variant="outline">
                        {selectedCase.priority} ·{" "}
                        {selectedCase.confidence !== null
                          ? `${Math.round(selectedCase.confidence * 100)}%`
                          : "n/a"}
                      </Badge>
                      <Badge variant="outline">
                        {selectedCase.includedProductIds.length} products
                      </Badge>
                      <Badge variant="outline">
                        {selectedCase.includedSignalIds.length} signals
                      </Badge>
                    </div>
                    <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                      <div className="eyebrow">Suspected common mechanism</div>
                      <p className="mt-2 text-sm leading-6">
                        {getSuspectedMechanism(selectedCase as Record<string, unknown>)}
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <TopChips title="Reported parts" items={selectedReportedParts} />
                      <TopChips title="BOM positions" items={selectedFindNumbers} />
                      <TopChips title="Supplier batches" items={selectedBatches} />
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <Boxes className="size-3.5" />
                  Product-specific threads
                </Badge>
                <CardTitle className="section-title mt-3">Per-product evidence threads</CardTitle>
                <CardDescription className="mt-2 leading-6">
                  Each thread is a Stage 1 product dossier: one unit, one evidence story, kept separate from the article-wide case object.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 px-5 pb-5 md:grid-cols-2">
                {selectedThreads.length ? (
                  selectedThreads.map((thread) => (
                    <article
                      key={thread.productId}
                      className="rounded-[24px] border border-white/10 bg-[color:var(--raised-overlay-surface)] p-4"
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge>{thread.productId}</Badge>
                        {thread.orderId ? <Badge variant="outline">{thread.orderId}</Badge> : null}
                        {thread.buildTs ? (
                          <Badge variant="outline">
                            {formatUiDateTime(thread.buildTs)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                        {thread.stage1Synthesis.productSummary}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {thread.stage1Synthesis.suspiciousPatterns.slice(0, 3).map((item) => (
                          <Badge key={item} variant="secondary">
                            {item}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          render={
                            <Link
                              href={buildClusteringModeHref(`/products/${thread.productId}`, mode)}
                            >
                              Open product dossier
                            </Link>
                          }
                        />
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/10 bg-black/8 p-4 text-sm leading-6 text-[var(--muted-foreground)]">
                    No clustered products are selected yet.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <Link2 className="size-3.5" />
                  Evidence spine
                </Badge>
                <CardTitle className="section-title mt-3">Signals from selected product threads</CardTitle>
                <CardDescription className="mt-2 leading-6">
                  This timeline merges the selected product threads so you can inspect the shared signal pattern behind the article-wide case.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {selectedTimeline.length ? (
                  selectedTimeline.map((signal) => (
                    <article
                      key={`${signal.productId}:${signal.signalId}`}
                      className="rounded-[22px] border border-white/10 bg-black/8 p-4"
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{signal.productId}</Badge>
                        <Badge
                          className={
                            signalTone[signal.signalType as keyof typeof signalTone] ??
                            "bg-[color:rgba(20,32,42,0.08)] text-foreground"
                          }
                        >
                          {signal.signalType}
                        </Badge>
                        {signal.severity ? <Badge variant="outline">{signal.severity}</Badge> : null}
                      </div>
                      <div className="mt-3 font-medium">{signal.headline}</div>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                        {signal.notePreview}
                      </p>
                      <div className="mt-3 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                        {formatUiDateTime(signal.occurredAt)} · {signal.section ?? "section unknown"}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/10 bg-black/8 p-4 text-sm leading-6 text-[var(--muted-foreground)]">
                    No evidence timeline is available for the current selection yet.
                  </div>
                )}
              </CardContent>
            </Card>

            {selectedFrames.length ? (
              <Card className="surface-sheet rounded-[30px] px-0 py-0">
                <CardHeader className="px-6 pt-6">
                  <Badge variant="outline">Evidence images</Badge>
                  <CardTitle className="section-title mt-3">Relevant visual evidence</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3">
                  {selectedFrames.map((frame) => (
                    <article
                      key={frame.id}
                      className="rounded-[24px] border border-white/10 bg-black/8 p-4"
                    >
                      <QualitySignalImage
                        alt={`${frame.sourceType} ${frame.sourceId}`}
                        src={frame.imageUrl}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline">{frame.sourceType}</Badge>
                        <Badge variant="outline">{frame.sourceId}</Badge>
                      </div>
                      <div className="mt-3 font-medium">{frame.title}</div>
                      <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                        {frame.caption}
                      </p>
                    </article>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-6">
            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <AlertTriangle className="size-3.5" />
                  Guidance
                </Badge>
                <CardTitle className="section-title mt-3">Shared evidence and caution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Strongest evidence</div>
                  <div className="mt-2 space-y-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {selectedCase?.strongestEvidence.length ? (
                      selectedCase.strongestEvidence.map((item) => <p key={item}>{item}</p>)
                    ) : (
                      <p>No strongest-evidence lines are available yet.</p>
                    )}
                  </div>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Conflicting evidence</div>
                  <div className="mt-2 space-y-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {conflictingEvidence.length ? (
                      conflictingEvidence.map((item) => <p key={item}>{item}</p>)
                    ) : (
                      <p>No strong conflict signals were highlighted for this case.</p>
                    )}
                  </div>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Noise and caution</div>
                  <div className="mt-2 space-y-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {selectedNoiseFlags.length ? (
                      selectedNoiseFlags.map((item) => <p key={item}>{item}</p>)
                    ) : (
                      <p>No strong noise flags were attached to the selected products.</p>
                    )}
                  </div>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Recommended next trace checks</div>
                  <div className="mt-2 space-y-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {selectedCase?.recommendedNextTraceChecks.length ? (
                      selectedCase.recommendedNextTraceChecks.map((item) => <p key={item}>{item}</p>)
                    ) : (
                      <p>No next trace checks are available until a case is selected.</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {defaultProductId ? (
              <ProductActionPanel
                initialActions={selectedActions}
                defaultProductId={defaultProductId}
                defaultDefectId={defaultDefectId}
              />
            ) : (
              <Card className="surface-panel rounded-[30px] px-0 py-0">
                <CardHeader className="px-6 pt-6">
                  <Badge variant="outline">Closed loop</Badge>
                  <CardTitle className="section-title mt-3">Action lane</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 text-sm leading-6 text-[var(--muted-foreground)]">
                  Select a proposed case with at least one included product to create an action from this workspace.
                </CardContent>
              </Card>
            )}

            {caseboard.globalInventory ? (
              <Card className="surface-sheet rounded-[30px] px-0 py-0">
                <CardHeader className="px-6 pt-6">
                  <Badge variant="outline">Global context</Badge>
                  <CardTitle className="section-title mt-3">Watchlists and noise</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-5 pb-5">
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Validated globally</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      {caseboard.globalInventory.validatedCases.length} validated cases in the latest global pass.
                    </p>
                  </div>
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Watchlists</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      {caseboard.globalInventory.watchlists.length} watchlists kept visible without opening an investigation.
                    </p>
                  </div>
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Noise buckets</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      {caseboard.globalInventory.noiseBuckets.length} patterns were down-ranked as noise or distractors.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
