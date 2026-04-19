"use client";

import {
  Eye,
  FlaskConical,
  FolderGit2,
  Layers3,
  LoaderCircle,
} from "lucide-react";
import { startTransition, useState } from "react";

import { ConfirmedCaseReportLoadingState } from "@/components/confirmed-case-report-loading-state";
import { ConfirmedCaseWorkspace } from "@/components/confirmed-case-workspace";
import { useConfirmedCaseReportFlow } from "@/components/use-confirmed-case-report-flow";
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
import { type ClusteringMode } from "@/lib/manex-clustering-mode";
import { formatUiDateTime } from "@/lib/ui-format";

type ArticleHypothesisBoardProps = {
  mode: ClusteringMode;
  viewModel: ArticleHypothesisBoardViewModel;
  economicBlastRadiusByHypothesisId: Record<string, EconomicBlastRadius | null>;
  hasPostgres: boolean;
};

type ReviewResponse = {
  ok?: boolean;
  error?: string;
};

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

export function ArticleHypothesisBoard({
  mode,
  viewModel,
  economicBlastRadiusByHypothesisId,
  hasPostgres,
}: ArticleHypothesisBoardProps) {
  const [selectedId, setSelectedId] = useState(viewModel.defaultHypothesisId);
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
  const confirmedHypothesis =
    hypotheses.find((hypothesis) => hypothesis.currentStatus === "confirmed") ?? null;
  const reportHypothesis =
    (revealedHypothesisId
      ? hypotheses.find((hypothesis) => hypothesis.id === revealedHypothesisId) ?? null
      : null) ??
    null;
  const pendingReportHypothesis =
    (revealingHypothesisId
      ? hypotheses.find((hypothesis) => hypothesis.id === revealingHypothesisId) ?? null
      : null) ??
    null;
  const selectedHypothesis =
    (confirmedHypothesis
      ? [confirmedHypothesis]
      : hypotheses
    ).find((hypothesis) => hypothesis.id === selectedId) ??
    confirmedHypothesis ??
    hypotheses[0] ??
    null;
  const evidenceTimeline = selectedHypothesis?.timeline.length
    ? selectedHypothesis.timeline
    : selectedHypothesis?.evidenceSpine ?? [];
  const caseShellHighlights = [
    {
      label: "Issue type",
      value: viewModel.caseShell.issueType,
      className: "md:col-span-2 xl:col-span-2",
      valueClassName: "text-lg font-semibold tracking-[-0.01em]",
    },
    {
      label: "Priority",
      value: viewModel.caseShell.priority,
      className: "md:col-span-2 xl:col-span-2",
      valueClassName: "text-lg font-semibold tracking-[-0.01em]",
    },
    {
      label: "Affected products",
      value: String(viewModel.caseShell.affectedProductCount),
      className: "md:col-span-2 xl:col-span-2",
      valueClassName: "text-2xl font-semibold tracking-[-0.03em]",
    },
    {
      label: "Strongest shared signal",
      value: viewModel.caseShell.strongestSharedSignal,
      className: "md:col-span-3 xl:col-span-6",
      valueClassName: "text-sm leading-6 text-foreground/90 sm:text-[15px]",
    },
    {
      label: "Scope",
      value: `${viewModel.caseShell.proposedHypothesisCount} hypotheses · ${viewModel.caseShell.articleProductCount} products · ${viewModel.caseShell.totalSignals} signals`,
      className: "md:col-span-3 xl:col-span-4",
      valueClassName: "text-sm leading-6 text-foreground/90 sm:text-[15px]",
    },
  ];

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
        if (status === "confirmed") {
          setSelectedId(hypothesis.id);
        }
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

  if (pendingReportHypothesis) {
    return <ConfirmedCaseReportLoadingState />;
  }

  if (reportHypothesis) {
    return (
      <ConfirmedCaseWorkspace
        key={`${mode}:${reportHypothesis.id}`}
        articleId={viewModel.articleId}
        articleName={viewModel.articleName}
        mode={mode}
        hypothesis={reportHypothesis}
        economicBlastRadius={economicBlastRadiusByHypothesisId[reportHypothesis.id] ?? null}
        hasPostgres={hasPostgres}
        initialRecord={recordByHypothesisId[reportHypothesis.id] ?? null}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card className="surface-panel rounded-[34px] px-0 py-0">
        <CardHeader className="space-y-4 px-6 pt-6 sm:px-7">
          <Badge variant="outline" className="w-fit">
            <Layers3 className="size-3.5" />
            Case shell
          </Badge>
          <CardTitle className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
            {viewModel.caseShell.title}
          </CardTitle>
          <CardDescription className="max-w-none text-base leading-7 text-[var(--muted-foreground)]">
            {viewModel.caseShell.summary}
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-3 px-5 pb-5 md:grid-cols-6 xl:grid-cols-10">
          {caseShellHighlights.map((item) => (
            <div key={item.label} className={item.className}>
              <div className="flex h-full flex-col gap-3 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,251,252,0.96))] p-4 shadow-[0_14px_30px_rgba(20,32,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(38,44,48,0.92),rgba(20,24,27,0.98))]">
                <div className="eyebrow">{item.label}</div>
                <div className={item.valueClassName}>{item.value}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <section
        id="hypotheses"
        className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]"
      >
        <div className="space-y-6">
          <Card className="surface-sheet rounded-[30px] px-0 py-0">
            <CardHeader className="px-6 pt-6">
              <Badge variant="outline">
                <FlaskConical className="size-3.5" />
                Competing hypotheses
              </Badge>
              <CardTitle className="section-title mt-3">Argument board</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-5 pb-5">
              {hypotheses.length ? (
                hypotheses.map((hypothesis) => {
                  const isSelected = selectedHypothesis?.id === hypothesis.id;

                  return (
                    <article
                      key={hypothesis.id}
                      className={
                        isSelected
                          ? "rounded-[28px] border border-[color:rgba(0,92,151,0.26)] bg-[color:rgba(0,92,151,0.06)] px-5 py-5"
                          : "rounded-[28px] border border-white/10 bg-black/8 px-5 py-5 transition hover:border-white/20"
                      }
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={statusTone[hypothesis.currentStatus]}>
                              {statusLabel[hypothesis.currentStatus]}
                            </Badge>
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-foreground">
                              {hypothesis.title}
                            </h3>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
                              {hypothesis.thesis}
                            </p>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          onClick={() => setSelectedId(hypothesis.id)}
                        >
                          <Eye className="size-4" />
                          {isSelected ? "Showing evidence" : "Open evidence"}
                        </Button>
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <div className="h-full rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(0,92,151,0.06),rgba(0,92,151,0.02))] p-4">
                          <div className="eyebrow text-[var(--primary)]">Observed support</div>
                          <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                            What the current record points toward.
                          </p>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
                            {hypothesis.whyItFits.map((item) => (
                              <p key={item}>• {item}</p>
                            ))}
                          </div>
                        </div>
                        <div className="h-full rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,32,42,0.06),rgba(20,32,42,0.02))] p-4">
                          <div className="eyebrow text-foreground">Assumptions required</div>
                          <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                            What still has to hold for this explanation to work.
                          </p>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
                            {hypothesis.mustBeTrue.map((item) => (
                              <p key={item}>• {item}</p>
                            ))}
                          </div>
                        </div>
                        <div className="h-full rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(178,69,63,0.07),rgba(178,69,63,0.02))] p-4">
                          <div className="eyebrow text-[var(--destructive)]">Counterevidence</div>
                          <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                            What still weakens it or keeps rivals alive.
                          </p>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
                            {hypothesis.weakensIt.map((item) => (
                              <p key={item}>• {item}</p>
                            ))}
                          </div>
                        </div>
                        <div className="h-full rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(45,123,98,0.07),rgba(45,123,98,0.02))] p-4">
                          <div className="eyebrow text-emerald-700">Decisive test</div>
                          <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                            The fastest next check.
                          </p>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
                            {hypothesis.nextChecks.map((item) => (
                              <p key={item}>• {item}</p>
                            ))}
                          </div>
                        </div>
                      </div>

                      {isSelected ? (
                        <div className="mt-4 rounded-[22px] bg-[color:rgba(20,32,42,0.04)] px-4 py-4">
                          <div className="eyebrow">Why not?</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {hypothesis.whyNot.map((item) => (
                              <Badge key={item} variant="secondary">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-col gap-4 border-t border-white/8 pt-4">
                        {hypothesis.reviewable ? (
                          <>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={
                                  !hasPostgres ||
                                  pendingStatusId === hypothesis.id ||
                                  revealingHypothesisId === hypothesis.id
                                }
                                onClick={() => void updateStatus(hypothesis, "confirmed")}
                              >
                                {pendingStatusId === hypothesis.id ||
                                revealingHypothesisId === hypothesis.id ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : null}
                                Accept hypothesis and generate report
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={
                                  !hasPostgres ||
                                  pendingStatusId === hypothesis.id ||
                                  revealingHypothesisId === hypothesis.id
                                }
                                onClick={() => void updateStatus(hypothesis, "ruled_out")}
                              >
                                Reject hypothesis
                              </Button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {(["leading", "plausible", "weak"] as const).map((status) => (
                                <Button
                                  key={status}
                                  type="button"
                                  size="sm"
                                  variant={
                                    hypothesis.currentStatus === status ? "default" : "outline"
                                  }
                                  disabled={
                                    !hasPostgres ||
                                    pendingStatusId === hypothesis.id ||
                                    revealingHypothesisId === hypothesis.id
                                  }
                                  onClick={() => void updateStatus(hypothesis, status)}
                                >
                                  {pendingStatusId === hypothesis.id &&
                                  hypothesis.currentStatus === status ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : null}
                                  {statusLabel[status]}
                                </Button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                            This alternative stays visible for reference, but only surfaced hypotheses carry operator status.
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-4 py-5 text-sm leading-6 text-[var(--muted-foreground)]">
                  No article-level hypotheses are available yet. Run the article analysis to seed the first argument board.
                </div>
              )}

              {actionError || revealError ? (
                <div className="rounded-[24px] bg-[color:rgba(178,69,63,0.12)] px-4 py-4 text-sm leading-6 text-[var(--destructive)]">
                  {actionError ?? revealError}
                </div>
              ) : null}
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
              <CardTitle className="section-title mt-3">
                Evidence timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {selectedHypothesis ? (
                <EvidenceTimeline
                  items={evidenceTimeline}
                  emptyText="No evidence timeline is available for this selection yet."
                />
              ) : (
                <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                  Select a hypothesis to inspect its supporting evidence.
                </p>
              )}
            </CardContent>
          </Card>

          {!hasPostgres ? (
            <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-4 py-4 text-sm leading-6 text-[var(--muted-foreground)]">
              Operator status changes need `DATABASE_URL` because review state is stored in Postgres.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
