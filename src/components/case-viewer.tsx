"use client";

import {
  AlertTriangle,
  ArrowLeft,
  FlaskConical,
  FolderGit2,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { startTransition, useState } from "react";

import { ConfirmedCaseReportLoadingState } from "@/components/confirmed-case-report-loading-state";
import { ConfirmedCaseWorkspace } from "@/components/confirmed-case-workspace";
import { useConfirmedCaseReportFlow } from "@/components/use-confirmed-case-report-flow";
import { EconomicBlastRadiusSection } from "@/components/economic-blast-radius-section";
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
import type { EconomicBlastRadius } from "@/lib/manex-case-clustering";
import { buildClusteringModeHref, type ClusteringMode } from "@/lib/manex-clustering-mode";
import { formatUiDateTime } from "@/lib/ui-format";

type CaseViewerProps = {
  mode: ClusteringMode;
  viewModel: ArticleHypothesisBoardViewModel;
  selectedCaseId: string;
  economicBlastRadius: EconomicBlastRadius | null;
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

const rankingButtonTone: Record<"leading" | "plausible" | "weak", string> = {
  leading:
    "border-[color:rgba(0,92,151,0.2)] bg-[color:rgba(0,92,151,0.14)] text-[var(--primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[color:rgba(0,92,151,0.18)]",
  plausible:
    "border-[color:rgba(20,32,42,0.12)] bg-[color:rgba(255,255,255,0.88)] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] hover:bg-[color:rgba(245,248,250,0.98)] dark:bg-[color:rgba(28,34,40,0.92)]",
  weak:
    "border-[color:rgba(208,141,37,0.2)] bg-[color:rgba(208,141,37,0.14)] text-[var(--warning-foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[color:rgba(208,141,37,0.18)]",
};

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

function EvidenceTimeline({
  items,
  emptyText,
}: {
  items: Array<{
    id: string;
    timestamp: string | null;
    productId?: string | null;
    signalType?: string | null;
    section?: string | null;
    label: string;
    detail: string;
  }>;
  emptyText: string;
}) {
  if (!items.length) {
    return (
      <div className="rounded-[22px] border border-dashed border-white/10 bg-[color:var(--surface-low)] px-4 py-5 text-sm leading-6 text-[var(--muted-foreground)]">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="rounded-[24px] bg-[color:var(--surface-low)] px-4 py-4 sm:px-5">
      <div className="space-y-0">
        {items.map((item, index) => {
          const meta = [
            item.timestamp ? formatUiDateTime(item.timestamp) : null,
            item.productId ?? null,
            item.section ?? item.signalType ?? null,
          ].filter((value): value is string => Boolean(value));

          return (
            <article
              key={item.id}
              className={`grid grid-cols-[18px_minmax(0,1fr)] gap-4 ${
                index === items.length - 1 ? "" : "pb-6"
              }`}
            >
              <div className="relative flex justify-center pt-1">
                <span className="relative z-10 mt-1 size-3 rounded-full border-2 border-[color:var(--surface-low)] bg-[var(--primary)]" />
                {index < items.length - 1 ? (
                  <span className="absolute top-5 bottom-[-1.5rem] left-1/2 w-px -translate-x-1/2 bg-[color:rgba(92,108,125,0.28)]" />
                ) : null}
              </div>
              <div className="rounded-[20px] bg-[color:var(--surface-lowest)] px-4 py-4 shadow-[0_14px_28px_rgba(20,32,42,0.04)]">
                {meta.length ? (
                  <div className="text-[0.72rem] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                    {meta.join(" · ")}
                  </div>
                ) : null}
                <div className="mt-2 text-base font-semibold text-foreground">{item.label}</div>
                <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{item.detail}</p>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function CaseViewer({
  mode,
  viewModel,
  selectedCaseId,
  economicBlastRadius,
  hasPostgres,
}: CaseViewerProps) {
  const [statusById, setStatusById] = useState<Record<string, ArticleHypothesisBoardStatus>>(() =>
    Object.fromEntries(
      viewModel.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis.currentStatus]),
    ),
  );
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const hypotheses = viewModel.hypotheses.map((hypothesis) => ({
    ...hypothesis,
    currentStatus: statusById[hypothesis.id] ?? hypothesis.currentStatus,
  }));
  const {
    recordByHypothesisId,
    revealedHypothesisId,
    revealingHypothesisId,
    revealError,
    handleConfirmedStatus,
  } = useConfirmedCaseReportFlow({
    articleId: viewModel.articleId,
    mode,
    hypotheses,
  });
  const confirmedCase =
    hypotheses.find((hypothesis) => hypothesis.currentStatus === "confirmed") ?? null;
  const reportCase =
    (revealedHypothesisId
      ? hypotheses.find((hypothesis) => hypothesis.id === revealedHypothesisId) ?? null
      : null) ??
    null;
  const pendingReportCase =
    (revealingHypothesisId
      ? hypotheses.find((hypothesis) => hypothesis.id === revealingHypothesisId) ?? null
      : null) ??
    null;
  const selectedCase =
    confirmedCase ??
    hypotheses.find((hypothesis) => hypothesis.id === selectedCaseId) ??
    hypotheses[0] ??
    null;
  const evidenceTimeline = selectedCase?.timeline.length
    ? selectedCase.timeline
    : selectedCase?.evidenceSpine ?? [];

  async function updateStatus(
    hypothesis: ArticleHypothesisCardViewModel,
    nextStatus: ArticleHypothesisBoardStatus,
  ) {
    if (!hypothesis.reviewable || !hasPostgres) {
      return;
    }

    setActionError(null);

    const persistStatus = async (status: ArticleHypothesisBoardStatus) => {
      const previousStatus = statusById[hypothesis.id] ?? hypothesis.currentStatus;
      startTransition(() => {
        setStatusById((current) => ({
          ...current,
          [hypothesis.id]: status,
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
              status,
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
        throw new Error("Could not update the hypothesis status.");
      } finally {
        setPendingStatusId(null);
      }
    };

    try {
      await handleConfirmedStatus(hypothesis, nextStatus, persistStatus);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not update the hypothesis status.",
      );
    }
  }

  if (!selectedCase) {
    return (
      <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-5 py-5 text-sm leading-6 text-[var(--muted-foreground)]">
        This case is no longer available in the current pipeline snapshot.
      </div>
    );
  }

  if (pendingReportCase) {
    return <ConfirmedCaseReportLoadingState />;
  }

  if (reportCase) {
    return (
      <ConfirmedCaseWorkspace
        key={`${mode}:${reportCase.id}`}
        articleId={viewModel.articleId}
        articleName={viewModel.articleName}
        mode={mode}
        hypothesis={reportCase}
        economicBlastRadius={economicBlastRadius}
        hasPostgres={hasPostgres}
        initialRecord={recordByHypothesisId[reportCase.id] ?? null}
      />
    );
  }

  const compactCaseSummary = [
    {
      label: "Case type",
      value: selectedCase.caseKind,
      valueClassName: "text-[1.15rem] font-semibold tracking-[-0.02em] capitalize text-foreground",
      cardClassName:
        "border-[color:rgba(0,92,151,0.12)] bg-[linear-gradient(180deg,rgba(244,249,252,0.96),rgba(236,244,249,0.88))]",
      labelClassName: "text-[var(--primary)]",
    },
    {
      label: "Priority",
      value: selectedCase.priority,
      valueClassName: "text-[1.15rem] font-semibold tracking-[-0.02em] capitalize text-foreground",
      cardClassName:
        "border-[color:rgba(20,32,42,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,248,250,0.88))]",
      labelClassName: "",
    },
    {
      label: "Affected products",
      value: String(selectedCase.affectedProductCount),
      valueClassName: "text-4xl font-semibold tracking-[-0.05em] text-white",
      cardClassName:
        "border-[color:rgba(0,92,151,0.22)] bg-[linear-gradient(135deg,rgba(0,92,151,0.96),rgba(36,129,190,0.88))] shadow-[0_18px_34px_rgba(0,92,151,0.22)]",
      labelClassName: "!text-white/72",
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="glass-panel ghost-border spec-grid overflow-hidden rounded-[34px] px-0 py-0">
        <CardHeader className="space-y-6 px-6 pt-6 sm:px-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit">
                <Sparkles className="size-3.5" />
                Case intelligence
              </Badge>
              <CardTitle className="max-w-5xl font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                {selectedCase.title}
              </CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                Review the working explanation, then open the structured evidence when needed.
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                variant="outline"
                render={
                  <Link href={buildClusteringModeHref("/articles", mode)}>
                    <ArrowLeft className="size-4" />
                    Back to global intelligence
                  </Link>
                }
              />
              <Button size="lg" variant="outline" render={<Link href="/">Back to home</Link>} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-5 pb-5 pt-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_300px]">
            <div className="relative overflow-hidden rounded-[30px] border border-[color:rgba(0,92,151,0.12)] bg-[linear-gradient(135deg,rgba(0,92,151,0.1),rgba(255,255,255,0.96)_42%,rgba(248,251,252,0.98))] shadow-[0_18px_40px_rgba(20,32,42,0.06)] dark:bg-[linear-gradient(135deg,rgba(0,92,151,0.16),rgba(24,32,40,0.96)_40%,rgba(18,24,31,0.98))]">
              <div className="spec-grid absolute inset-0 opacity-35 [mask-image:linear-gradient(180deg,rgba(0,0,0,0.22),transparent_72%)]" />
              <div className="relative space-y-5 p-5 sm:p-6">
                <div className="space-y-3">
                  <CardTitle className="max-w-4xl font-heading text-[1.9rem] leading-tight font-semibold tracking-[-0.04em] sm:text-[2.35rem]">
                    {selectedCase.thesis}
                  </CardTitle>
                  <CardDescription className="max-w-4xl text-[15px] leading-7 text-[var(--muted-foreground)] sm:text-base">
                    {selectedCase.summary}
                  </CardDescription>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              {compactCaseSummary.map((item) => (
                <div
                  key={item.label}
                  className={`flex min-h-[108px] flex-col justify-between rounded-[24px] border p-4 shadow-[0_14px_28px_rgba(20,32,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(38,44,48,0.92),rgba(20,24,27,0.98))] ${item.cardClassName}`}
                >
                  <div className={`eyebrow ${item.labelClassName}`}>{item.label}</div>
                  <div className={item.valueClassName}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
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
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <InsightPanel
                  eyebrow="Observed support"
                  description="What the record points toward."
                  items={selectedCase.whyItFits}
                  toneClassName="bg-[linear-gradient(180deg,rgba(0,92,151,0.06),rgba(0,92,151,0.02))]"
                />
                <InsightPanel
                  eyebrow="Assumptions required"
                  description="What still has to hold for the explanation to work."
                  items={selectedCase.mustBeTrue}
                  toneClassName="bg-[linear-gradient(180deg,rgba(20,32,42,0.06),rgba(20,32,42,0.02))]"
                />
                <InsightPanel
                  eyebrow="Counterevidence"
                  description="What still weakens it or keeps rivals alive."
                  items={selectedCase.weakensIt}
                  toneClassName="bg-[linear-gradient(180deg,rgba(178,69,63,0.07),rgba(178,69,63,0.02))]"
                />
                <InsightPanel
                  eyebrow="Decisive test"
                  description="The fastest next check."
                  items={selectedCase.nextChecks}
                  toneClassName="bg-[linear-gradient(180deg,rgba(45,123,98,0.07),rgba(45,123,98,0.02))]"
                />
              </div>

              {selectedCase.whyNot.length ? (
                <div className="rounded-[22px] border border-[color:rgba(208,141,37,0.18)] bg-[linear-gradient(180deg,rgba(255,248,235,0.96),rgba(255,252,246,0.92))] px-4 py-3 shadow-[0_12px_28px_rgba(208,141,37,0.08)] dark:bg-[linear-gradient(180deg,rgba(52,39,18,0.42),rgba(38,31,18,0.28))]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:rgba(208,141,37,0.16)] text-[var(--warning-foreground)]">
                      <AlertTriangle className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="eyebrow text-[var(--warning-foreground)]">Why not yet</div>
                      <div className="mt-1 space-y-1.5">
                        {selectedCase.whyNot.map((item) => (
                          <p key={item} className="text-sm leading-6 text-foreground/90">
                            {item}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-4 border-t border-white/8 pt-4">
                {selectedCase.reviewable ? (
                  <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(246,249,251,0.92),rgba(238,243,247,0.82))] px-4 py-4 shadow-[0_18px_36px_rgba(20,32,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(25,32,39,0.92),rgba(20,26,32,0.94))]">
                    <div className="flex flex-wrap items-end gap-5 xl:gap-6">
                      <div className="space-y-2">
                        <div className="eyebrow text-[var(--muted-foreground)]">Ranking</div>
                        <div className="flex flex-wrap gap-2 rounded-[20px] border border-white/10 bg-white/55 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:bg-black/10">
                          {(["leading", "plausible", "weak"] as const).map((status) => {
                            const isActive = selectedCase.currentStatus === status;

                            return (
                              <Button
                                key={status}
                                type="button"
                                size="sm"
                                variant="outline"
                                className={
                                  isActive
                                    ? rankingButtonTone[status]
                                    : "border-transparent bg-transparent text-[var(--muted-foreground)] shadow-none hover:border-[color:rgba(20,32,42,0.08)] hover:bg-white/85 hover:text-foreground dark:hover:bg-white/6"
                                }
                                disabled={
                                  !hasPostgres ||
                                  pendingStatusId === selectedCase.id ||
                                  revealingHypothesisId === selectedCase.id
                                }
                                onClick={() => void updateStatus(selectedCase, status)}
                              >
                                {pendingStatusId === selectedCase.id &&
                                selectedCase.currentStatus === status ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : null}
                                {statusLabel[status]}
                              </Button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2 xl:ml-auto">
                        <div className="eyebrow text-[var(--muted-foreground)]">Decision</div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-emerald-700 bg-emerald-700 text-white shadow-[0_10px_20px_rgba(45,123,98,0.18)] hover:border-emerald-800 hover:bg-emerald-800 dark:border-emerald-600 dark:bg-emerald-600 dark:hover:border-emerald-500 dark:hover:bg-emerald-500"
                            disabled={
                              !hasPostgres ||
                              pendingStatusId === selectedCase.id ||
                              revealingHypothesisId === selectedCase.id
                            }
                            onClick={() => void updateStatus(selectedCase, "confirmed")}
                          >
                            {pendingStatusId === selectedCase.id ||
                            revealingHypothesisId === selectedCase.id ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            Accept hypothesis and generate report
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-[color:rgba(178,69,63,0.92)] bg-[color:rgba(178,69,63,0.92)] text-white shadow-[0_10px_20px_rgba(178,69,63,0.16)] hover:border-[color:rgba(158,57,52,0.96)] hover:bg-[color:rgba(158,57,52,0.96)]"
                            disabled={
                              !hasPostgres ||
                              pendingStatusId === selectedCase.id ||
                              revealingHypothesisId === selectedCase.id
                            }
                            onClick={() => void updateStatus(selectedCase, "ruled_out")}
                          >
                            {pendingStatusId === selectedCase.id &&
                            selectedCase.currentStatus === "ruled_out" ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            Reject hypothesis
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                    This case stays visible as context, but only surfaced ranked cases carry operator status.
                  </p>
                )}

                {actionError || revealError ? (
                  <div className="rounded-[24px] bg-[color:rgba(178,69,63,0.12)] px-4 py-4 text-sm leading-6 text-[var(--destructive)]">
                    {actionError ?? revealError}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="surface-panel rounded-[30px] px-0 py-0">
            <CardHeader className="px-6 pt-6">
              <Badge variant="outline">
                <FolderGit2 className="size-3.5" />
                Evidence drawer
              </Badge>
              <CardTitle className="section-title mt-3">Evidence timeline</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <EvidenceTimeline
                items={evidenceTimeline}
                emptyText="No evidence timeline is available for this case yet."
              />
            </CardContent>
          </Card>

          {!hasPostgres ? (
            <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-4 py-4 text-sm leading-6 text-[var(--muted-foreground)]">
              Operator status changes need `DATABASE_URL` because review state is stored in Postgres.
            </div>
          ) : null}
        </div>
      </section>

      <EconomicBlastRadiusSection blastRadius={economicBlastRadius} />
    </div>
  );
}
