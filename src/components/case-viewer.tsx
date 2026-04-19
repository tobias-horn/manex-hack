"use client";

import {
  Eye,
  FlaskConical,
  FolderGit2,
  Layers3,
  LoaderCircle,
} from "lucide-react";
import Link from "next/link";
import { startTransition, useState } from "react";

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
import type {
  ArticleHypothesisBoardStatus,
  ArticleHypothesisBoardViewModel,
  ArticleHypothesisCardViewModel,
} from "@/lib/article-hypothesis-view";
import { buildCaseViewerHref, type ClusteringMode } from "@/lib/manex-clustering-mode";
import { formatUiDateTime, formatUiRelative } from "@/lib/ui-format";

type CaseViewerProps = {
  mode: ClusteringMode;
  viewModel: ArticleHypothesisBoardViewModel;
  selectedCaseId: string;
  hasPostgres: boolean;
};

type ReviewResponse = {
  ok?: boolean;
  error?: string;
};

const statusTone: Record<ArticleHypothesisBoardStatus, string> = {
  leading: "bg-[color:rgba(0,92,151,0.12)] text-[var(--primary)]",
  plausible: "bg-[color:rgba(20,32,42,0.08)] text-foreground",
  weak: "bg-[color:rgba(208,141,37,0.16)] text-[var(--warning-foreground)]",
  ruled_out: "bg-[color:rgba(178,69,63,0.14)] text-[var(--destructive)]",
  confirmed: "bg-[color:rgba(45,123,98,0.14)] text-emerald-700",
};

const statusLabel: Record<ArticleHypothesisBoardStatus, string> = {
  leading: "Leading",
  plausible: "Plausible",
  weak: "Weak",
  ruled_out: "Ruled out",
  confirmed: "Confirmed",
};

function formatConfidence(value: number | null) {
  return value !== null ? `${Math.round(value * 100)}% confidence` : "No confidence score";
}

function InsightPanel({
  eyebrow,
  description,
  items,
  toneClassName,
}: {
  eyebrow: string;
  description: string;
  items: string[];
  toneClassName: string;
}) {
  return (
    <div className={`h-full rounded-[24px] border border-white/8 p-4 ${toneClassName}`}>
      <div className="eyebrow">{eyebrow}</div>
      <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">{description}</p>
      <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
        {items.length ? (
          items.map((item) => <p key={item}>• {item}</p>)
        ) : (
          <p>Nothing explicit was surfaced here yet.</p>
        )}
      </div>
    </div>
  );
}

export function CaseViewer({
  mode,
  viewModel,
  selectedCaseId,
  hasPostgres,
}: CaseViewerProps) {
  const [statusById, setStatusById] = useState<Record<string, ArticleHypothesisBoardStatus>>(() =>
    Object.fromEntries(
      viewModel.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis.currentStatus]),
    ),
  );
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const hypotheses = viewModel.hypotheses.map((hypothesis) => ({
    ...hypothesis,
    currentStatus: statusById[hypothesis.id] ?? hypothesis.currentStatus,
  }));
  const selectedCase =
    hypotheses.find((hypothesis) => hypothesis.id === selectedCaseId) ?? hypotheses[0] ?? null;
  const companionCases = hypotheses.filter((hypothesis) => hypothesis.id !== selectedCase?.id);

  async function updateStatus(
    hypothesis: ArticleHypothesisCardViewModel,
    nextStatus: ArticleHypothesisBoardStatus,
  ) {
    if (!hypothesis.reviewable || !hasPostgres) {
      return;
    }

    const previousStatus = statusById[hypothesis.id] ?? hypothesis.currentStatus;
    startTransition(() => {
      setStatusById((current) => ({
        ...current,
        [hypothesis.id]: nextStatus,
      }));
      setPendingStatusId(hypothesis.id);
    });

    try {
      const response = await fetch(
        `/api/articles/${viewModel.articleId}/hypotheses/${hypothesis.id}/review`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pipelineMode: mode,
            status: nextStatus,
            candidateTitle: hypothesis.title,
          }),
        },
      );

      const payload = (await response.json()) as ReviewResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not update the hypothesis status.");
      }
    } catch {
      setStatusById((current) => ({
        ...current,
        [hypothesis.id]: previousStatus,
      }));
    } finally {
      setPendingStatusId(null);
    }
  }

  if (!selectedCase) {
    return (
      <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-5 py-5 text-sm leading-6 text-[var(--muted-foreground)]">
        This case is no longer available in the current pipeline snapshot.
      </div>
    );
  }

  const caseSummaryCards = [
    {
      label: "Case type",
      value: selectedCase.caseKind,
      className: "md:col-span-2 xl:col-span-2",
      valueClassName: "text-lg font-semibold tracking-[-0.01em]",
    },
    {
      label: "Priority",
      value: selectedCase.priority,
      className: "md:col-span-2 xl:col-span-2",
      valueClassName: "text-lg font-semibold tracking-[-0.01em]",
    },
    {
      label: "Affected products",
      value: String(selectedCase.affectedProductCount),
      className: "md:col-span-2 xl:col-span-2",
      valueClassName: "text-2xl font-semibold tracking-[-0.03em]",
    },
    {
      label: "Strongest shared signal",
      value: selectedCase.strongestSharedSignal,
      className: "md:col-span-3 xl:col-span-6",
      valueClassName: "text-sm leading-6 text-foreground/90 sm:text-[15px]",
    },
    {
      label: "Scope",
      value: `${selectedCase.signalCount} signals · ${viewModel.caseShell.proposedHypothesisCount} ranked cases in ${viewModel.articleId}`,
      className: "md:col-span-3 xl:col-span-4",
      valueClassName: "text-sm leading-6 text-foreground/90 sm:text-[15px]",
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="surface-panel rounded-[34px] px-0 py-0">
        <CardHeader className="space-y-4 px-6 pt-6 sm:px-7">
          <Badge variant="outline" className="w-fit">
            <Layers3 className="size-3.5" />
            Case viewer
          </Badge>
          <div className="flex flex-wrap gap-2">
            <Badge className={statusTone[selectedCase.currentStatus]}>
              {statusLabel[selectedCase.currentStatus]}
            </Badge>
            <Badge variant="outline">{viewModel.articleId}</Badge>
            {viewModel.articleName ? <Badge variant="outline">{viewModel.articleName}</Badge> : null}
            <Badge variant="outline">{formatConfidence(selectedCase.confidence)}</Badge>
          </div>
          <CardTitle className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
            {selectedCase.title}
          </CardTitle>
          <CardDescription className="max-w-none text-base leading-7 text-[var(--muted-foreground)]">
            {selectedCase.summary}
          </CardDescription>
          <div className="rounded-[24px] bg-[color:rgba(20,32,42,0.04)] px-4 py-4 text-sm leading-7 text-foreground">
            {selectedCase.thesis}
          </div>
        </CardHeader>

        <CardContent className="grid gap-3 px-5 pb-5 md:grid-cols-6 xl:grid-cols-10">
          {caseSummaryCards.map((item) => (
            <div key={item.label} className={item.className}>
              <div className="flex h-full flex-col gap-3 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,251,252,0.96))] p-4 shadow-[0_14px_30px_rgba(20,32,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(38,44,48,0.92),rgba(20,24,27,0.98))]">
                <div className="eyebrow">{item.label}</div>
                <div className={item.valueClassName}>{item.value}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="space-y-6">
          <Card className="surface-sheet rounded-[30px] px-0 py-0">
            <CardHeader className="px-6 pt-6">
              <Badge variant="outline">
                <FlaskConical className="size-3.5" />
                Investigation frame
              </Badge>
              <CardTitle className="section-title mt-3">Working explanation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 px-5 pb-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={statusTone[selectedCase.currentStatus]}>
                  {statusLabel[selectedCase.currentStatus]}
                </Badge>
                <Badge variant="outline">{selectedCase.caseKind}</Badge>
                <Badge variant="outline">{selectedCase.priority}</Badge>
                {selectedCase.reportedParts.slice(0, 2).map((item) => (
                  <Badge key={item} variant="outline">
                    {item}
                  </Badge>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <InsightPanel
                  eyebrow="Observed support"
                  description="What the current record positively points toward."
                  items={selectedCase.whyItFits}
                  toneClassName="bg-[linear-gradient(180deg,rgba(0,92,151,0.06),rgba(0,92,151,0.02))]"
                />
                <InsightPanel
                  eyebrow="Assumptions required"
                  description="Conditions that must hold for this explanation to stay coherent."
                  items={selectedCase.mustBeTrue}
                  toneClassName="bg-[linear-gradient(180deg,rgba(20,32,42,0.06),rgba(20,32,42,0.02))]"
                />
                <InsightPanel
                  eyebrow="Counterevidence"
                  description="Friction in the record, missing proof, or rival explanations still alive."
                  items={selectedCase.weakensIt}
                  toneClassName="bg-[linear-gradient(180deg,rgba(178,69,63,0.07),rgba(178,69,63,0.02))]"
                />
                <InsightPanel
                  eyebrow="Decisive test"
                  description="The shortest next move that should meaningfully strengthen or weaken it."
                  items={selectedCase.nextChecks}
                  toneClassName="bg-[linear-gradient(180deg,rgba(45,123,98,0.07),rgba(45,123,98,0.02))]"
                />
              </div>

              {selectedCase.whyNot.length ? (
                <div className="rounded-[22px] bg-[color:rgba(20,32,42,0.04)] px-4 py-4">
                  <div className="eyebrow">Why not?</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedCase.whyNot.map((item) => (
                      <Badge key={item} variant="secondary">
                        {item}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-4 border-t border-white/8 pt-4">
                {selectedCase.reviewable ? (
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        "leading",
                        "plausible",
                        "weak",
                        "ruled_out",
                        "confirmed",
                      ] as const
                    ).map((status) => (
                      <Button
                        key={status}
                        type="button"
                        size="sm"
                        variant={selectedCase.currentStatus === status ? "default" : "outline"}
                        disabled={!hasPostgres || pendingStatusId === selectedCase.id}
                        onClick={() => void updateStatus(selectedCase, status)}
                      >
                        {pendingStatusId === selectedCase.id &&
                        selectedCase.currentStatus === status ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                        {statusLabel[status]}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                    This case stays visible as context only. Operator status is only stored for surfaced ranked cases.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {companionCases.length ? (
            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <Eye className="size-3.5" />
                  Nearby cases
                </Badge>
                <CardTitle className="section-title mt-3">Other ranked cases in this article</CardTitle>
                <CardDescription className="mt-2 leading-6">
                  Keep alternatives one click away without turning this back into a noisy article-wide board.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {companionCases.map((hypothesis) => (
                  <article
                    key={hypothesis.id}
                    className="rounded-[24px] border border-white/10 bg-black/8 p-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <Badge className={statusTone[hypothesis.currentStatus]}>
                            {statusLabel[hypothesis.currentStatus]}
                          </Badge>
                        </div>
                        <div className="text-base font-semibold">{hypothesis.title}</div>
                        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                          {hypothesis.summary}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <Link href={buildCaseViewerHref(hypothesis.id, viewModel.articleId, mode)}>
                            Open case
                          </Link>
                        }
                      />
                    </div>
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
                <FolderGit2 className="size-3.5" />
                Evidence drawer
              </Badge>
              <CardTitle className="section-title mt-3">Proof and provenance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-5 pb-5">
              <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                <div className="eyebrow">Evidence spine</div>
                <div className="mt-3 space-y-3">
                  {selectedCase.evidenceSpine.length ? (
                    selectedCase.evidenceSpine.map((item) => (
                      <article
                        key={item.id}
                        className="rounded-[18px] bg-[color:var(--surface-lowest)] px-3 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {item.timestamp ? (
                            <Badge variant="outline">{formatUiDateTime(item.timestamp)}</Badge>
                          ) : null}
                          {item.productId ? <Badge variant="outline">{item.productId}</Badge> : null}
                          {item.signalType ? <Badge variant="outline">{item.signalType}</Badge> : null}
                        </div>
                        <div className="mt-3 text-sm font-medium text-foreground">{item.label}</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                          {item.detail}
                        </p>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                      No evidence spine is available for this case yet.
                    </p>
                  )}
                </div>
              </div>

              <details className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                  Full timeline
                </summary>
                <div className="mt-4 space-y-3">
                  {selectedCase.timeline.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-[18px] bg-[color:var(--surface-lowest)] px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {item.timestamp ? (
                          <Badge variant="outline">{formatUiDateTime(item.timestamp)}</Badge>
                        ) : null}
                        {item.productId ? <Badge variant="outline">{item.productId}</Badge> : null}
                        {item.section ? <Badge variant="outline">{item.section}</Badge> : null}
                      </div>
                      <div className="mt-3 text-sm font-medium text-foreground">{item.label}</div>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                        {item.detail}
                      </p>
                    </article>
                  ))}
                </div>
              </details>

              <details className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                  Related products
                </summary>
                <div className="mt-4 space-y-3">
                  {selectedCase.relatedProducts.map((product) => (
                    <article
                      key={product.productId}
                      className="rounded-[18px] bg-[color:var(--surface-lowest)] px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{product.productId}</Badge>
                        {product.orderId ? <Badge variant="outline">{product.orderId}</Badge> : null}
                        {product.buildTs ? (
                          <Badge variant="outline">{formatUiRelative(product.buildTs)}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                        {product.summary}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {product.suspiciousPatterns.map((item) => (
                          <Badge key={item} variant="secondary">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </details>

              {selectedCase.frames.length ? (
                <details className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                    Images and provenance
                  </summary>
                  <div className="mt-4 grid gap-3">
                    {selectedCase.frames.map((frame) => (
                      <article
                        key={frame.id}
                        className="rounded-[18px] bg-[color:var(--surface-lowest)] p-3"
                      >
                        <QualitySignalImage
                          alt={`${frame.sourceType} ${frame.sourceId}`}
                          src={frame.imageUrl}
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="outline">{frame.sourceType}</Badge>
                          <Badge variant="outline">{frame.sourceId}</Badge>
                        </div>
                        <div className="mt-3 text-sm font-medium text-foreground">{frame.title}</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                          {frame.caption}
                        </p>
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}

              {selectedCase.memberNotes.length ? (
                <details className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                    Exact provenance notes
                  </summary>
                  <div className="mt-4 space-y-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {selectedCase.memberNotes.map((item) => (
                      <p key={item}>• {item}</p>
                    ))}
                  </div>
                </details>
              ) : null}
            </CardContent>
          </Card>

          {!hasPostgres ? (
            <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-4 py-4 text-sm leading-6 text-[var(--muted-foreground)]">
              Operator status changes need `DATABASE_URL` because the review state is stored in app-owned Postgres tables.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
