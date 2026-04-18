import { format } from "date-fns";
import {
  AlertTriangle,
  FileWarning,
  Filter,
  FlaskConical,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { QualitySignalImage } from "@/components/quality-signal-image";
import {
  getQualityInbox,
  parseQualityInboxFilters,
  type QualityInboxFilterState,
  type QualitySignal,
  type QualitySignalType,
} from "@/lib/quality-inbox";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const typeTone: Record<QualitySignalType, string> = {
  field_claim: "bg-[color:rgba(178,69,63,0.1)] text-[var(--destructive)]",
  defect: "bg-[color:rgba(0,92,151,0.1)] text-[var(--primary)]",
  bad_test: "bg-[color:rgba(178,69,63,0.12)] text-[var(--destructive)]",
  marginal_test: "bg-[color:rgba(208,141,37,0.14)] text-amber-700",
};

const severityTone: Record<string, string> = {
  critical: "bg-[color:rgba(178,69,63,0.14)] text-[var(--destructive)]",
  high: "bg-[color:rgba(178,69,63,0.1)] text-[var(--destructive)]",
  medium: "bg-[color:rgba(208,141,37,0.14)] text-amber-700",
  low: "bg-[color:rgba(20,32,42,0.08)] text-foreground",
};

const signalLabel: Record<QualitySignalType, string> = {
  field_claim: "Field claim",
  defect: "Defect",
  bad_test: "Bad test",
  marginal_test: "Marginal test",
};

const windowLabel: Record<QualityInboxFilterState["timeWindow"], string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

function formatSignalTimestamp(value: string) {
  return format(new Date(value), "dd MMM yyyy, HH:mm");
}

function renderSignalIcon(type: QualitySignalType) {
  if (type === "field_claim") {
    return <FileWarning className="size-4" />;
  }

  if (type === "defect") {
    return <AlertTriangle className="size-4" />;
  }

  return <FlaskConical className="size-4" />;
}

function ActiveFilters({ filters }: { filters: QualityInboxFilterState }) {
  const chips = [
    { label: windowLabel[filters.timeWindow] },
    filters.articleId ? { label: filters.articleId } : null,
    filters.defectCode ? { label: filters.defectCode } : null,
    filters.signalType !== "all" ? { label: signalLabel[filters.signalType] } : null,
  ].filter((value): value is { label: string } => Boolean(value));

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Badge key={chip.label} variant="outline">
          {chip.label}
        </Badge>
      ))}
    </div>
  );
}

function SignalCard({ item }: { item: QualitySignal }) {
  const showsImagePreview =
    item.type === "defect" || item.type === "field_claim";

  return (
    <article className="rounded-[26px] border border-white/8 bg-black/8 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={typeTone[item.type]}>
              {renderSignalIcon(item.type)}
              {signalLabel[item.type]}
            </Badge>
            {item.severity ? (
              <Badge
                className={severityTone[item.severity] ?? severityTone.low}
                variant="secondary"
              >
                {item.severity}
              </Badge>
            ) : null}
            {item.defectCode ? <Badge variant="outline">{item.defectCode}</Badge> : null}
          </div>

          <div>
            <div className="text-base font-semibold">{item.preview}</div>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              {item.context}
            </p>
          </div>
        </div>

        {showsImagePreview ? (
          <div className="w-full lg:w-[220px] lg:flex-none">
            <QualitySignalImage
              alt={`${signalLabel[item.type]} preview for ${item.sourceId}`}
              src={item.imageUrl}
            />
          </div>
        ) : null}

        <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-3 text-right">
          <div className="lab-stamp">{item.sourceLabel}</div>
          <div className="mt-2 text-sm font-medium">{formatSignalTimestamp(item.occurredAt)}</div>
        </div>
      </div>
    </article>
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const filters = parseQualityInboxFilters(params);
  const inbox = await getQualityInbox(filters);

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="eyebrow">Manex // Quality Inbox</div>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                Incoming quality signals
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                This is the intake surface for future caseboards. It merges field
                claims, factory defects, and outlier test results into one browsable
                feed without jumping into SQL or root-cause analysis yet.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  render={<Link href="/traceability">Open traceability explorer</Link>}
                />
              </div>
              <ActiveFilters filters={inbox.filters} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[420px] lg:grid-cols-2">
              <div className="rounded-[24px] bg-[color:var(--surface-low)] px-4 py-4">
                <div className="eyebrow">Signals</div>
                <div className="mt-2 text-3xl font-semibold">{inbox.totalSignals}</div>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Current inbox rows after filters.
                </p>
              </div>
              <div className="rounded-[24px] bg-[color:var(--surface-low)] px-4 py-4">
                <div className="eyebrow">Scope</div>
                <div className="mt-2 text-lg font-semibold">
                  {windowLabel[inbox.filters.timeWindow]}
                </div>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Tuned for triage, not conclusions.
                </p>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.42fr)_380px]">
          <div className="space-y-6">
            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">First read model</Badge>
                <CardTitle className="section-title mt-3">
                  Triage-ready symptom stream
                </CardTitle>
                <CardDescription className="mt-2 max-w-2xl leading-6">
                  Every row is normalized into a common quality signal so later stages can
                  cluster these into case candidates instead of starting from raw sources.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-5 sm:px-5">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Claims</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {inbox.counts.field_claim}
                    </div>
                  </div>
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Defects</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {inbox.counts.defect}
                    </div>
                  </div>
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Bad tests</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {inbox.counts.bad_test}
                    </div>
                  </div>
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Marginal</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {inbox.counts.marginal_test}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>Inbox</Badge>
                <CardTitle className="section-title mt-3">
                  Browse incoming signals
                </CardTitle>
                <CardDescription className="mt-2 leading-6">
                  Start with the symptoms. Cases, evidence threads, and hypothesis support
                  can layer on top of this feed next.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-5 sm:px-5">
                {inbox.items.length ? (
                  inbox.items.map((item) => <SignalCard key={item.id} item={item} />)
                ) : (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-black/8 p-6">
                    <div className="eyebrow">No signals found</div>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
                      The current filters are too narrow for the available signal sources.
                      Relax the time window or clear the article and defect-code filters.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <Filter className="size-3.5" />
                  Filters
                </Badge>
                <CardTitle className="section-title mt-3">Refine the inbox</CardTitle>
                <CardDescription className="mt-2 leading-6">
                  Keep this page useful during triage. These filters narrow the intake stream
                  without changing the underlying data model.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <form className="space-y-4" action="/">
                  <div className="space-y-2">
                    <label className="lab-stamp" htmlFor="window">
                      Time window
                    </label>
                    <select
                      id="window"
                      name="window"
                      className="select-field h-11 w-full rounded-[1rem] px-3.5 text-sm text-foreground outline-none"
                      defaultValue={inbox.filters.timeWindow}
                    >
                      <option value="7d">Last 7 days</option>
                      <option value="30d">Last 30 days</option>
                      <option value="90d">Last 90 days</option>
                      <option value="all">All time</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="lab-stamp" htmlFor="article">
                      Article
                    </label>
                    <select
                      id="article"
                      name="article"
                      className="select-field h-11 w-full rounded-[1rem] px-3.5 text-sm text-foreground outline-none"
                      defaultValue={inbox.filters.articleId ?? ""}
                    >
                      <option value="">All articles</option>
                      {inbox.articleOptions.map((article) => (
                        <option key={article.id} value={article.id}>
                          {article.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="lab-stamp" htmlFor="defectCode">
                      Defect code
                    </label>
                    <select
                      id="defectCode"
                      name="defectCode"
                      className="select-field h-11 w-full rounded-[1rem] px-3.5 text-sm text-foreground outline-none"
                      defaultValue={inbox.filters.defectCode ?? ""}
                    >
                      <option value="">All codes</option>
                      {inbox.defectCodeOptions.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="lab-stamp" htmlFor="signalType">
                      Signal type
                    </label>
                    <select
                      id="signalType"
                      name="signalType"
                      className="select-field h-11 w-full rounded-[1rem] px-3.5 text-sm text-foreground outline-none"
                      defaultValue={inbox.filters.signalType}
                    >
                      <option value="all">All signals</option>
                      <option value="field_claim">Field claims</option>
                      <option value="defect">Defects</option>
                      <option value="bad_test">Bad tests</option>
                      <option value="marginal_test">Marginal tests</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-3 pt-2">
                    <Button type="submit" size="lg">
                      Apply filters
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      render={
                        <Link href="/">
                          <RefreshCcw className="size-4" />
                          Reset
                        </Link>
                      }
                    />
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>
                  <Sparkles className="size-3.5" />
                  Intake notes
                </Badge>
                <CardTitle className="section-title mt-3">Why this is useful now</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 px-5 pb-5">
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">No root cause leap</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    The inbox stays symptom-first so the team can triage what is arriving
                    before locking onto explanations too early.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Case-ready shape</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    Each signal already carries article, product, timestamp, and defect/test
                    hints so later stages can cluster them into cases.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">No SQL needed</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    This page is backed by the domain data layer, so product work can consume
                    structured quality signals instead of raw schema knowledge.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
