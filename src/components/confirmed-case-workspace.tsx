"use client";

import {
  ArrowLeft,
  BellRing,
  CheckCheck,
  LoaderCircle,
  MoveRight,
  NotebookText,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

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
import type { ArticleHypothesisCardViewModel } from "@/lib/article-hypothesis-view";
import type { EconomicBlastRadius } from "@/lib/manex-case-clustering";
import { buildClusteringModeHref, type ClusteringMode } from "@/lib/manex-clustering-mode";
import {
  QUALITY_NOTIFICATION_TEAMS,
  type ConfirmedCaseReportRecord,
  type QualityNotificationTeamId,
} from "@/lib/manex-confirmed-case-report-schema";
import {
  fetchConfirmedCaseReport,
  queueConfirmedCaseReport,
} from "@/lib/manex-confirmed-case-report-client";
import { formatUiDateTime } from "@/lib/ui-format";

type ConfirmedCaseWorkspaceProps = {
  articleId: string;
  articleName: string | null;
  mode: ClusteringMode;
  hypothesis: ArticleHypothesisCardViewModel;
  economicBlastRadius: EconomicBlastRadius | null;
  hasPostgres: boolean;
  initialRecord?: ConfirmedCaseReportRecord | null;
};

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

type ReportFact = {
  label: string;
  value: string;
};

function chunkItems<T>(items: T[], size: number) {
  const rows: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }

  return rows;
}

function ReportFactsTable({
  items,
}: {
  items: ReportFact[];
}) {
  const rows = chunkItems(items, 4);

  return (
    <div className="overflow-hidden rounded-[20px] border border-[color:rgba(20,32,42,0.08)] bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(243,247,250,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(27,34,40,0.96),rgba(22,29,35,0.94))]">
      <div className="overflow-x-auto">
        <table className="min-w-[860px] w-full border-collapse">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={`row-${rowIndex}`}
                className={
                  rowIndex > 0
                    ? "border-t border-[color:rgba(20,32,42,0.08)] dark:border-white/8"
                    : ""
                }
              >
                {row.map((item, itemIndex) => (
                  <td
                    key={item.label}
                    className={`align-top px-4 py-3 ${
                      itemIndex > 0
                        ? "border-l border-[color:rgba(20,32,42,0.08)] dark:border-white/8"
                        : ""
                    }`}
                  >
                    <div className="lab-stamp whitespace-nowrap text-[0.64rem] text-[var(--muted-foreground)]">
                      {item.label}
                    </div>
                    <div
                      className="mt-1 max-w-[240px] truncate whitespace-nowrap text-[13px] leading-6 font-medium text-foreground"
                      title={item.value}
                    >
                      {item.value}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportSection({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-3 border-t border-[color:rgba(20,32,42,0.08)] pt-4 first:border-t-0 first:pt-0 dark:border-white/8">
        <div className="lab-stamp shrink-0 text-[0.66rem] text-[var(--muted-foreground)]">{label}</div>
        <h3 className="font-heading text-[1rem] leading-6 font-semibold tracking-[-0.01em] text-foreground">
          {title}
        </h3>
      </div>
      <div className="pl-0 text-[13px] leading-6 text-foreground/92 sm:pl-[74px]">{children}</div>
    </section>
  );
}

function ReportList({
  items,
  ordered = false,
}: {
  items: string[];
  ordered?: boolean;
}) {
  if (!items.length) {
    return (
      <p className="text-[15px] leading-7 text-[var(--muted-foreground)]">
        No items were generated for this section.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item} className="flex items-start gap-3">
          <div className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border border-[color:rgba(20,32,42,0.12)] text-[0.62rem] font-semibold text-[var(--muted-foreground)] dark:border-white/10">
            {ordered ? index + 1 : <MoveRight className="size-3.5" />}
          </div>
          <p className="flex-1 text-[13px] leading-6 text-foreground/92">{item}</p>
        </div>
      ))}
    </div>
  );
}

function ReportTraceabilityRow({
  label,
  items,
}: {
  label: string;
  items: string[];
}) {
  return (
    <div className="grid gap-1 border-t border-[color:rgba(20,32,42,0.08)] py-2 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[180px_minmax(0,1fr)] dark:border-white/8">
      <div className="lab-stamp text-[0.66rem] text-[var(--muted-foreground)]">{label}</div>
      <div className="text-[13px] leading-6 text-foreground/92">
        {items.length ? items.join(" · ") : "Not surfaced in this report."}
      </div>
    </div>
  );
}

function ReportTimeline({
  items,
}: {
  items: ConfirmedCaseReportRecord["report"]["timeline"];
}) {
  if (!items.length) {
    return (
      <p className="text-[15px] leading-7 text-[var(--muted-foreground)]">
        No condensed timeline was generated for this report.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <article key={item.id} className="grid gap-2 md:grid-cols-[168px_minmax(0,1fr)]">
          <div className="relative pl-4">
            {index < items.length - 1 ? (
              <div className="absolute top-1 bottom-[-1rem] left-[6px] w-px bg-[color:rgba(20,32,42,0.12)] dark:bg-white/10" />
            ) : null}
            <div className="absolute top-1 left-0 size-3 rounded-full border border-[color:rgba(20,32,42,0.16)] bg-[color:var(--surface-lowest)] dark:border-white/12 dark:bg-[color:var(--surface-lowest)]" />
            <div className="lab-stamp text-[0.66rem] text-[var(--muted-foreground)]">
              {item.timestamp ? formatUiDateTime(item.timestamp) : "Undated"}
            </div>
            {item.context ? (
              <div className="mt-1 text-[11px] leading-5 text-[var(--muted-foreground)]">{item.context}</div>
            ) : null}
          </div>
          <div className="border-b border-[color:rgba(20,32,42,0.08)] pb-3 dark:border-white/8">
            <h4 className="text-[13px] leading-6 font-semibold text-foreground">{item.label}</h4>
            <p className="mt-1 text-[13px] leading-6 text-[var(--muted-foreground)]">{item.detail}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ConfirmedCaseWorkspace({
  articleId,
  mode,
  hypothesis,
  economicBlastRadius,
  hasPostgres,
  initialRecord = null,
}: ConfirmedCaseWorkspaceProps) {
  const [record, setRecord] = useState<ConfirmedCaseReportRecord | null>(initialRecord);
  const [selectedTeamIds, setSelectedTeamIds] = useState<QualityNotificationTeamId[]>(() =>
    initialRecord
      ? initialRecord.selectedTeamIds.length
        ? initialRecord.selectedTeamIds
        : initialRecord.report.suggestedTeams
            .filter((team) => team.preselected)
            .map((team) => team.teamId)
      : [],
  );
  const [isLoading, setIsLoading] = useState(!initialRecord);
  const [isQueueing, setIsQueueing] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  useEffect(() => {
    if (initialRecord) {
      return;
    }

    let cancelled = false;

    async function loadReport() {
      setIsLoading(true);
      setFeedback(null);

      try {
        const nextRecord = await fetchConfirmedCaseReport({
          articleId,
          candidateId: hypothesis.id,
          pipelineMode: mode,
          candidateTitle: hypothesis.title,
        });

        if (cancelled) {
          return;
        }

        setRecord(nextRecord);
        setSelectedTeamIds(
          nextRecord.selectedTeamIds.length
            ? nextRecord.selectedTeamIds
            : nextRecord.report.suggestedTeams
                .filter((team) => team.preselected)
                .map((team) => team.teamId),
        );
      } catch (error) {
        if (!cancelled) {
          setFeedback({
            tone: "error",
            text:
              error instanceof Error
                ? error.message
                : "Could not generate the confirmed case report.",
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadReport();

    return () => {
      cancelled = true;
    };
  }, [articleId, hypothesis.id, hypothesis.title, initialRecord, mode]);

  const teamLookup = useMemo(
    () => new Map(QUALITY_NOTIFICATION_TEAMS.map((team) => [team.id, team])),
    [],
  );

  const selectedSet = useMemo(() => new Set(selectedTeamIds), [selectedTeamIds]);

  const report = record?.report ?? null;
  const reportFacts: ReportFact[] = report
    ? [
        { label: "Article", value: articleId },
        {
          label: "Generated",
          value: record ? formatUiDateTime(record.updatedAt) : "In progress",
        },
        { label: "Products", value: String(report.scope.affectedProductCount) },
        { label: "Signals", value: String(report.scope.signalCount) },
        { label: "Priority", value: hypothesis.priority },
        { label: "Case type", value: hypothesis.caseKind },
        {
          label: "Source",
          value: record?.runtimeMode === "live_ai" ? "AI draft" : "Template draft",
        },
        { label: "Anchor", value: report.confirmedMechanism },
      ]
    : [];

  function toggleTeam(teamId: QualityNotificationTeamId) {
    setSelectedTeamIds((current) =>
      current.includes(teamId)
        ? current.filter((item) => item !== teamId)
        : [...current, teamId],
    );
  }

  async function queueNotifications() {
    if (!selectedTeamIds.length) {
      setFeedback({
        tone: "error",
        text: "Select at least one team before sending the report onward.",
      });
      return;
    }

    setIsQueueing(true);
    setFeedback(null);

    try {
      const nextRecord = await queueConfirmedCaseReport({
        articleId,
        candidateId: hypothesis.id,
        pipelineMode: mode,
        selectedTeamIds,
      });

      setRecord(nextRecord);
      setSelectedTeamIds(nextRecord.selectedTeamIds);
      setFeedback({
        tone: "success",
        text:
          "Notification request queued. The actual delivery hook can be connected later without changing this screen.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Could not queue the notification request.",
      });
    } finally {
      setIsQueueing(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="glass-panel ghost-border spec-grid overflow-hidden rounded-[34px] px-0 py-0">
        <CardHeader className="space-y-6 px-6 pt-6 sm:px-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="outline">
                  <Sparkles className="size-3.5" />
                  Case intelligence
                </Badge>
                <Badge className="w-fit bg-[color:rgba(45,123,98,0.14)] text-emerald-700">
                  <CheckCheck className="size-3.5" />
                  Confirmed case
                </Badge>
                {record ? (
                  <Badge variant="outline">
                    <NotebookText className="size-3.5" />
                    {record.runtimeMode === "live_ai" ? "AI drafted report" : "Template drafted report"}
                  </Badge>
                ) : null}
              </div>
              <div className="space-y-3">
                <CardTitle className="max-w-5xl font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                  {report?.headline ?? hypothesis.title}
                </CardTitle>
                <CardDescription className="max-w-4xl text-base leading-7 text-[var(--muted-foreground)]">
                  {report?.executiveSummary ?? hypothesis.summary}
                </CardDescription>
              </div>
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

        <CardContent className="grid gap-3 px-5 pb-5 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Affected products",
              value: String(report?.scope.affectedProductCount ?? hypothesis.affectedProductCount),
              valueClassName: "text-2xl font-semibold tracking-[-0.03em]",
            },
            {
              label: "Supporting signals",
              value: String(report?.scope.signalCount ?? hypothesis.signalCount),
              valueClassName: "text-2xl font-semibold tracking-[-0.03em]",
            },
            {
              label: "Last generated",
              value: record ? formatUiDateTime(record.updatedAt) : "Generating...",
              valueClassName: "text-sm leading-6 text-foreground/90",
            },
            {
              label: "Confirmed mechanism",
              value: report?.confirmedMechanism ?? hypothesis.thesis,
              valueClassName: "text-sm leading-6 text-foreground/90",
            },
          ].map((item) => (
            <div key={item.label}>
              <div className="flex h-full flex-col gap-3 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,251,252,0.96))] p-4 shadow-[0_14px_30px_rgba(20,32,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(38,44,48,0.92),rgba(20,24,27,0.98))]">
                <div className="eyebrow">{item.label}</div>
                <div className={item.valueClassName}>{item.value}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="surface-sheet rounded-[30px] border border-[color:rgba(20,32,42,0.08)] px-5 py-5 shadow-[0_18px_48px_rgba(20,32,42,0.08)] dark:border-white/8 sm:px-7">
          {isLoading ? (
            <div className="flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
              <LoaderCircle className="size-4 animate-spin" />
              Drafting report.
            </div>
          ) : report ? (
            <article className="space-y-6">
              <header className="space-y-5 border-b border-[color:rgba(20,32,42,0.08)] pb-5 dark:border-white/8">
                <div className="space-y-3">
                  <div className="lab-stamp text-[0.66rem] text-[var(--muted-foreground)]">
                    Confirmed quality report
                  </div>
                  <h2 className="font-heading text-[1.45rem] leading-7 font-semibold tracking-[-0.02em] text-foreground sm:text-[1.7rem]">
                    {report.headline}
                  </h2>
                  <p className="max-w-4xl text-[13px] leading-6 text-[var(--muted-foreground)]">
                    {report.executiveSummary}
                  </p>
                </div>
                <ReportFactsTable items={reportFacts} />
              </header>

              <div className="space-y-5">
                <ReportSection label="01" title="Problem">
                  <p>{report.problemStatement}</p>
                </ReportSection>

                <ReportSection label="02" title="Mechanism">
                  <p>{report.confirmedMechanism}</p>
                </ReportSection>

                <ReportSection label="03" title="Evidence">
                  <ReportList items={report.evidenceHighlights} />
                </ReportSection>

                <ReportSection label="04" title="Severity">
                  <p>{report.severityAssessment}</p>
                </ReportSection>

                <ReportSection label="05" title="Containment">
                  <ReportList items={report.containmentActions} ordered />
                </ReportSection>

                <ReportSection label="06" title="Corrective action">
                  <ReportList items={report.correctiveActions} ordered />
                </ReportSection>

                <ReportSection label="07" title="Validation">
                  <ReportList items={report.validationPlan} ordered />
                </ReportSection>

                <ReportSection label="08" title="Watchouts">
                  <ReportList items={report.watchouts} />
                </ReportSection>

                <ReportSection label="09" title="Traceability">
                  <div className="space-y-0">
                    <ReportTraceabilityRow label="Products" items={report.scope.productIds} />
                    <ReportTraceabilityRow label="Reported parts" items={report.scope.reportedParts} />
                    <ReportTraceabilityRow label="Find numbers" items={report.scope.findNumbers} />
                    <ReportTraceabilityRow label="Supplier batches" items={report.scope.supplierBatches} />
                    <ReportTraceabilityRow label="Sections" items={report.scope.sections} />
                  </div>
                </ReportSection>

                <ReportSection label="10" title="Timeline">
                  <ReportTimeline items={report.timeline} />
                </ReportSection>
              </div>
            </article>
          ) : (
            <div className="text-sm leading-6 text-[var(--muted-foreground)]">
              The report could not be prepared from the confirmed hypothesis yet.
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card className="surface-panel rounded-[30px] px-0 py-0">
            <CardHeader className="px-6 pt-6">
              <Badge variant="outline">
                <Users className="size-3.5" />
                Suggested notification teams
              </Badge>
              <CardTitle className="section-title mt-3">Distribution</CardTitle>
              <CardDescription className="mt-2 leading-6">
                Select recipients and queue the handoff.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-5">
              {isLoading ? (
                <div className="flex items-center gap-3 rounded-[24px] bg-[color:var(--surface-low)] px-4 py-5 text-sm text-[var(--muted-foreground)]">
                  <LoaderCircle className="size-4 animate-spin" />
                  Preparing team suggestions.
                </div>
              ) : report ? (
                report.suggestedTeams.map((suggestion) => {
                  const team = teamLookup.get(suggestion.teamId);

                  if (!team) {
                    return null;
                  }

                  return (
                    <label
                      key={suggestion.teamId}
                      className="grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_74px] items-start gap-3 border-t border-white/10 py-3 first:border-t-0 first:pt-0 dark:border-white/8"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 rounded border border-white/20 accent-[var(--primary)]"
                        checked={selectedSet.has(suggestion.teamId)}
                        onChange={() => toggleTeam(suggestion.teamId)}
                      />
                      <div className="min-w-0">
                        <div className="text-[13px] leading-6 font-semibold">{team.label}</div>
                        <p className="text-[12px] leading-5 text-[var(--muted-foreground)]">
                          {suggestion.rationale}
                        </p>
                      </div>
                      <div className="pt-0.5 text-right text-[11px] leading-5 uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                        {suggestion.urgency}
                      </div>
                    </label>
                  );
                })
              ) : null}

              {record?.notifyRequestedAt ? (
                <div className="border-t border-white/10 pt-3 text-[12px] leading-5 text-[var(--muted-foreground)] dark:border-white/8">
                  <div className="grid gap-1 sm:grid-cols-[92px_minmax(0,1fr)]">
                    <div className="lab-stamp text-[0.64rem]">Last queued</div>
                    <div>
                      {formatUiDateTime(record.notifyRequestedAt)}
                      {record.notifyRequestedBy ? ` · ${record.notifyRequestedBy}` : ""}
                    </div>
                  </div>
                </div>
              ) : null}

              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={() => void queueNotifications()}
                disabled={isQueueing || isLoading || !report || !selectedTeamIds.length || !hasPostgres}
              >
                {isQueueing ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Queueing report
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    Queue selected teams
                  </>
                )}
              </Button>

              {!hasPostgres ? (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 px-4 py-4 text-sm leading-6 text-[var(--muted-foreground)]">
                  Team handoff persistence needs `DATABASE_URL`.
                </div>
              ) : null}
            </CardContent>
          </Card>

      {feedback ? (
        <div
          className={
            feedback.tone === "success"
              ? "rounded-[24px] bg-[color:rgba(45,123,98,0.12)] px-4 py-4 text-sm leading-6 text-emerald-700"
                  : "rounded-[24px] bg-[color:rgba(178,69,63,0.12)] px-4 py-4 text-sm leading-6 text-[var(--destructive)]"
              }
            >
              <div className="flex items-start gap-3">
                {feedback.tone === "success" ? (
                  <BellRing className="mt-0.5 size-4" />
                ) : (
                  <BellRing className="mt-0.5 size-4" />
                )}
                <span>{feedback.text}</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <EconomicBlastRadiusSection blastRadius={economicBlastRadius} />
    </div>
  );
}
