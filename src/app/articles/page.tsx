import { ArrowLeft, CircuitBoard, Sparkles } from "lucide-react";
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
import { capabilities } from "@/lib/env";
import { listArticleClusteringDashboard } from "@/lib/manex-case-clustering";
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

export default async function ArticlesPage() {
  const articles = await listArticleClusteringDashboard();

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <Sparkles className="size-3.5" />
                Prompt 11 clustering spine
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                Article clustering dashboard
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                Start with one article family, build a complete article dossier, and
                then persist LLM-reviewed proposed cases on top of those product threads.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge>{capabilities.hasAi ? "GPT clustering live" : "OpenAI key missing"}</Badge>
                <Badge variant="outline">{articles.length} article families</Badge>
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

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
          <div className="space-y-4">
            {articles.map((article) => (
              <Card
                key={article.articleId}
                className="surface-sheet overflow-hidden rounded-[30px] px-0 py-0"
              >
                <CardHeader className="spec-grid px-6 pt-6">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <Badge>{article.articleId}</Badge>
                      <CardTitle className="section-title mt-3">
                        {article.articleName ?? "Unnamed article"}
                      </CardTitle>
                      <CardDescription className="mt-2 max-w-3xl leading-6">
                        Static article filtering is the intake boundary for dossier
                        building, trace summaries, and proposed case clusters.
                      </CardDescription>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {article.latestRun ? (
                        <Badge variant="outline">
                          Last run {article.latestRun.status}
                        </Badge>
                      ) : (
                        <Badge variant="outline">No clustering run yet</Badge>
                      )}
                      <Badge variant="outline">
                        {article.proposedCaseCount} proposed cases
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5 px-5 pb-5">
                  <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                    <Metric
                      label="Products"
                      value={article.productCount}
                      caption="Built units in this article family."
                    />
                    <Metric
                      label="Signals"
                      value={article.totalSignals}
                      caption="Unified inbox rows across this family."
                    />
                    <Metric
                      label="Defects"
                      value={article.defectCount}
                      caption="Factory defects in scope."
                    />
                    <Metric
                      label="Claims"
                      value={article.claimCount}
                      caption="Field claims in scope."
                    />
                    <Metric
                      label="Bad tests"
                      value={article.badTestCount}
                      caption="Failing test evidence."
                    />
                    <Metric
                      label="Marginal tests"
                      value={article.marginalTestCount}
                      caption="Near-miss test evidence."
                    />
                  </div>

                  <div className="flex flex-col gap-4 rounded-[24px] border border-white/10 bg-black/8 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                      <div className="eyebrow">Latest activity</div>
                      <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                        {article.latestSignalAt
                          ? `Most recent signal: ${formatUiDateTime(article.latestSignalAt)}`
                          : "No signal timestamp available yet."}
                      </p>
                      {article.latestRun ? (
                        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                          Latest run {article.latestRun.status} on{" "}
                          {formatUiDateTime(article.latestRun.startedAt)} with{" "}
                          {article.latestRun.candidateCount} proposed cases.
                        </p>
                      ) : null}
                    </div>

                    <Button
                      size="lg"
                      render={
                        <Link href={`/articles/${article.articleId}`}>
                          <CircuitBoard className="size-4" />
                          Open article caseboard
                        </Link>
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="space-y-6">
            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">Architecture</Badge>
                <CardTitle className="section-title mt-3">
                  What gets persisted
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Dossiers first</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    Each article run stores deterministic product and article dossiers
                    before the model proposes any cases.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Two-pass review</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    The model proposes case candidates first, then a second pass merges,
                    trims, and tightens the case boundaries.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Proposed only</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    These are stored as proposed clusters so the team can review them
                    before turning them into investigation cases.
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
