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
import { formatUiDateTime } from "@/lib/ui-format";

export const dynamic = "force-dynamic";

type ArticleCaseboardPageProps = {
  params: Promise<{ articleId: string }>;
};

const signalTone = {
  defect: "bg-[color:rgba(0,92,151,0.1)] text-[var(--primary)]",
  field_claim: "bg-[color:rgba(178,69,63,0.1)] text-[var(--destructive)]",
  bad_test: "bg-[color:rgba(178,69,63,0.12)] text-[var(--destructive)]",
  marginal_test: "bg-[color:rgba(208,141,37,0.14)] text-amber-700",
};

function TopList({
  title,
  items,
}: {
  title: string;
  items: Array<{ value?: string; label?: string; count: number }>;
}) {
  return (
    <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
      <div className="eyebrow">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length ? (
          items.slice(0, 6).map((item) => (
            <div
              key={`${item.value ?? item.label}:${item.count}`}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="font-medium">
                {item.value ?? item.label ?? "Unspecified"}
              </span>
              <span className="text-[var(--muted-foreground)]">{item.count}</span>
            </div>
          ))
        ) : (
          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
            Nothing dominant yet.
          </p>
        )}
      </div>
    </div>
  );
}

export default async function ArticleCaseboardPage({
  params,
}: ArticleCaseboardPageProps) {
  const { articleId } = await params;
  const caseboard = await getArticleCaseboard(articleId);

  if (!caseboard) {
    notFound();
  }

  const dossier = caseboard.dossier;
  const proposedCases = caseboard.proposedCases;
  const memberships = new Map<string, typeof proposedCases>();
  const standaloneSignalsByProduct = new Map<string, typeof caseboard.standaloneSignals>();
  const unassignedReasonByProduct = new Map(
    caseboard.unassignedProducts.map((item) => [item.productId, item.reason]),
  );

  if (dossier) {
    for (const thread of dossier.productThreads) {
      memberships.set(
        thread.productId,
        proposedCases.filter((candidate) => candidate.includedProductIds.includes(thread.productId)),
      );
      standaloneSignalsByProduct.set(
        thread.productId,
        caseboard.standaloneSignals.filter((signal) => signal.productId === thread.productId),
      );
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <Sparkles className="size-3.5" />
                Article caseboard
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                {caseboard.articleId}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                Proposed cases are clustered inside one article family using structured
                product threads, traceability context, workflow history, and raw
                evidence appendices. They stay proposed until the team decides to
                promote them.
              </p>
              <div className="flex flex-wrap gap-2">
                {caseboard.articleName ? (
                  <Badge variant="outline">{caseboard.articleName}</Badge>
                ) : null}
                {caseboard.dashboardCard ? (
                  <Badge variant="outline">
                    {caseboard.dashboardCard.productCount} products
                  </Badge>
                ) : null}
                {caseboard.dashboardCard ? (
                  <Badge variant="outline">
                    {caseboard.dashboardCard.totalSignals} signals
                  </Badge>
                ) : null}
                <Badge variant="outline">{proposedCases.length} proposed cases</Badge>
                {caseboard.unassignedProducts.length ? (
                  <Badge variant="outline">
                    {caseboard.unassignedProducts.length} unassigned products
                  </Badge>
                ) : null}
                {caseboard.standaloneSignals.length ? (
                  <Badge variant="outline">
                    {caseboard.standaloneSignals.length} standalone faults
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                variant="outline"
                render={
                  <Link href="/articles">
                    <ArrowLeft className="size-4" />
                    Back to articles
                  </Link>
                }
              />
              <Button size="lg" variant="outline" render={<Link href="/">Back to inbox</Link>} />
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.22fr)_390px]">
          <div className="space-y-6">
            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>Proposed cases</Badge>
                <CardTitle className="section-title mt-3">
                  LLM-reviewed case candidates
                </CardTitle>
                <CardDescription className="mt-2 max-w-3xl leading-6">
                  These are grouped by likely shared mechanism, not automatically
                  accepted as root cause or final workflow cases.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 px-5 pb-5">
                {proposedCases.length ? (
                  proposedCases.map((candidate) => (
                    <article
                      key={candidate.id}
                      className="rounded-[26px] border border-white/10 bg-black/8 p-5"
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <Badge>{candidate.title}</Badge>
                            <Badge variant="outline">{candidate.caseKind}</Badge>
                            <Badge variant="outline">
                              {candidate.priority} ·{" "}
                              {candidate.confidence !== null
                                ? `${Math.round(candidate.confidence * 100)}%`
                                : "n/a"}
                            </Badge>
                          </div>
                          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                            {candidate.summary}
                          </p>
                          <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                            <div className="eyebrow">Suspected shared mechanism</div>
                            <p className="mt-2 text-sm leading-6">
                              {candidate.suspectedCommonRootCause}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[360px] xl:grid-cols-1">
                          <div className="rounded-[22px] bg-[color:var(--surface-low)] px-4 py-4">
                            <div className="eyebrow">Included products</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {candidate.includedProductIds.map((productId) => (
                                <Badge key={productId} variant="outline">
                                  {productId}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-[22px] bg-[color:var(--surface-low)] px-4 py-4">
                            <div className="eyebrow">Next trace checks</div>
                            <div className="mt-2 space-y-2 text-sm leading-6 text-[var(--muted-foreground)]">
                              {candidate.recommendedNextTraceChecks.map((item) => (
                                <p key={item}>{item}</p>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                          <div className="eyebrow">Strongest evidence</div>
                          <div className="mt-2 space-y-2 text-sm leading-6 text-[var(--muted-foreground)]">
                            {candidate.strongestEvidence.map((item) => (
                              <p key={item}>{item}</p>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                          <div className="eyebrow">Potential conflicts</div>
                          <div className="mt-2 space-y-2 text-sm leading-6 text-[var(--muted-foreground)]">
                            {candidate.conflictingEvidence.length ? (
                              candidate.conflictingEvidence.map((item) => <p key={item}>{item}</p>)
                            ) : (
                              <p>No major conflict surfaced in the reviewed proposal.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[26px] border border-dashed border-white/12 bg-black/8 p-5">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-1 size-5 text-[var(--muted-foreground)]" />
                      <div>
                        <div className="font-semibold">No proposed cases yet</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                          Run the clustering engine from the right-hand panel to build
                          product threads, persist the article dossier, and generate the
                          first proposed case groups.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {caseboard.unassignedProducts.length || caseboard.standaloneSignals.length ? (
              <Card className="surface-sheet rounded-[30px] px-0 py-0">
                <CardHeader className="px-6 pt-6">
                  <Badge variant="outline">
                    <CircleOff className="size-3.5" />
                    Not cluster-linked
                  </Badge>
                  <CardTitle className="section-title mt-3">
                    Signals and products left outside the proposed cases
                  </CardTitle>
                  <CardDescription className="mt-2 max-w-3xl leading-6">
                    The clustering engine is allowed to say “this is real, but it does
                    not belong in a shared case yet.” That keeps isolated faults from
                    being forced into noisy clusters.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 px-5 pb-5 xl:grid-cols-2">
                  <div className="rounded-[24px] bg-black/8 p-4">
                    <div className="eyebrow">Unassigned products</div>
                    <div className="mt-3 space-y-3">
                      {caseboard.unassignedProducts.length ? (
                        caseboard.unassignedProducts.map((item) => (
                          <article
                            key={item.productId}
                            className="rounded-[20px] bg-[color:var(--surface-low)] p-4"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge>{item.productId}</Badge>
                              <Badge variant="outline">No proposed cluster</Badge>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                              {item.reason}
                            </p>
                          </article>
                        ))
                      ) : (
                        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                          Every signaled product was pulled into at least one proposed
                          case in the latest run.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[24px] bg-black/8 p-4">
                    <div className="eyebrow">Standalone faults</div>
                    <div className="mt-3 space-y-3">
                      {caseboard.standaloneSignals.length ? (
                        caseboard.standaloneSignals.map((item) => (
                          <article
                            key={item.signalId}
                            className="rounded-[20px] bg-[color:var(--surface-low)] p-4"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge>{item.signalId}</Badge>
                              <Badge variant="outline">{item.productId}</Badge>
                              <Badge
                                className={
                                  signalTone[item.signalType as keyof typeof signalTone] ??
                                  "bg-[color:rgba(20,32,42,0.08)] text-foreground"
                                }
                              >
                                {item.signalType}
                              </Badge>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                              {item.reason}
                            </p>
                          </article>
                        ))
                      ) : (
                        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                          The latest run did not leave any individual faults outside the
                          proposed case set.
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {dossier ? (
              <Card className="surface-panel rounded-[30px] px-0 py-0">
                <CardHeader className="px-6 pt-6">
                  <Badge variant="outline">Product threads</Badge>
                  <CardTitle className="section-title mt-3">
                    Evidence-ready product dossiers
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 px-5 pb-5 xl:grid-cols-2">
                  {dossier.productThreads.map((thread) => {
                    const productCases = memberships.get(thread.productId) ?? [];
                    const standaloneSignals =
                      standaloneSignalsByProduct.get(thread.productId) ?? [];
                    const unassignedReason =
                      unassignedReasonByProduct.get(thread.productId) ?? null;

                    return (
                      <article
                        key={thread.productId}
                        className="rounded-[26px] border border-white/10 bg-[color:rgba(255,255,255,0.72)] p-5"
                      >
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                              <Badge>{thread.productId}</Badge>
                              {thread.orderId ? <Badge variant="outline">{thread.orderId}</Badge> : null}
                              {thread.buildTs ? (
                                <Badge variant="outline">
                                  Built {formatUiDateTime(thread.buildTs)}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                              {thread.articleName ?? thread.articleId}
                            </p>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            render={<Link href={`/products/${thread.productId}`}>Open product dossier</Link>}
                          />
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                            <div className="eyebrow">Signals</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {thread.summaryFeatures.signalTypesPresent.map((type) => (
                                <Badge
                                  key={type}
                                  className={
                                    signalTone[type as keyof typeof signalTone] ??
                                    "bg-[color:rgba(20,32,42,0.08)] text-foreground"
                                  }
                                >
                                  {type}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                            <div className="eyebrow">Trace context</div>
                            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                              {thread.traceabilitySnapshot.uniqueBatchCount} batches ·{" "}
                              {thread.traceabilitySnapshot.uniqueSupplierCount} suppliers ·{" "}
                              {thread.traceabilitySnapshot.installedPartCount} installed parts
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {thread.summaryFeatures.reportedPartNumbers
                            .slice(0, 4)
                            .map((item) => (
                              <Badge key={item} variant="secondary">
                                {item}
                              </Badge>
                            ))}
                          {thread.summaryFeatures.bomFindNumbers.slice(0, 4).map((item) => (
                            <Badge key={item} variant="secondary">
                              {item}
                            </Badge>
                          ))}
                          {thread.summaryFeatures.supplierBatches.slice(0, 4).map((item) => (
                            <Badge key={item} variant="secondary">
                              {item}
                            </Badge>
                          ))}
                        </div>

                        <div className="mt-4 rounded-[22px] bg-black/8 p-4">
                          <div className="eyebrow">Cluster membership</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {productCases.length ? (
                              productCases.map((candidate) => (
                                <Badge key={candidate.id} variant="outline">
                                  {candidate.title}
                                </Badge>
                              ))
                            ) : (
                              <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                                Not assigned to a proposed case in the latest run.
                              </p>
                            )}
                          </div>
                          {unassignedReason ? (
                            <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                              {unassignedReason}
                            </p>
                          ) : null}
                          {standaloneSignals.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {standaloneSignals.map((signal) => (
                                <Badge key={signal.signalId} variant="secondary">
                                  {signal.signalType}:{signal.signalId}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-6">
            <ArticleClusterRunner
              articleId={caseboard.articleId}
              hasAi={capabilities.hasAi}
              latestRun={caseboard.latestRun}
              proposedCaseCount={proposedCases.length}
            />

            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">Run state</Badge>
                <CardTitle className="section-title mt-3">
                  Latest persisted pass
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Status</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {caseboard.latestRun
                      ? `${caseboard.latestRun.status} · ${caseboard.latestRun.model} · ${caseboard.latestRun.strategy}`
                      : "No run has been stored for this article yet."}
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Started</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {caseboard.latestRun
                      ? formatUiDateTime(caseboard.latestRun.startedAt)
                      : "Not started"}
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Completed</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {caseboard.latestRun?.completedAt
                      ? formatUiDateTime(caseboard.latestRun.completedAt)
                      : "Not completed yet"}
                  </p>
                </div>
              </CardContent>
            </Card>

            {dossier ? (
              <Card className="surface-sheet rounded-[30px] px-0 py-0">
                <CardHeader className="px-6 pt-6">
                  <Badge variant="outline">
                    <Boxes className="size-3.5" />
                    Article dossier
                  </Badge>
                  <CardTitle className="section-title mt-3">
                    Deterministic evidence spine
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-5 pb-5">
                  {caseboard.globalObservations.length ? (
                    <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                      <div className="eyebrow">Global observations</div>
                      <div className="mt-2 space-y-2 text-sm leading-6 text-[var(--muted-foreground)]">
                        {caseboard.globalObservations.map((item) => (
                          <p key={item}>{item}</p>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {caseboard.ambiguousLinks.length ? (
                    <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                      <div className="eyebrow">Ambiguous links</div>
                      <div className="mt-2 space-y-3 text-sm leading-6 text-[var(--muted-foreground)]">
                        {caseboard.ambiguousLinks.slice(0, 6).map((item) => (
                          <article key={`${item.productId}:${item.reason}`}>
                            <div className="font-medium text-foreground">
                              {item.productId} · {Math.round(item.confidence * 100)}%
                            </div>
                            <p>{item.reason}</p>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <TopList title="Top defect codes" items={dossier.articleSummary.topDefectCodes} />
                  <TopList title="Top reported parts" items={dossier.articleSummary.topReportedParts} />
                  <TopList title="Top BOM positions" items={dossier.articleSummary.topBomPositions} />
                  <TopList title="Top supplier batches" items={dossier.articleSummary.topSupplierBatches} />
                </CardContent>
              </Card>
            ) : null}

            {dossier ? (
              <Card className="surface-sheet rounded-[30px] px-0 py-0">
                <CardHeader className="px-6 pt-6">
                  <Badge variant="outline">
                    <Link2 className="size-3.5" />
                    Cross-product links
                  </Badge>
                  <CardTitle className="section-title mt-3">
                    Shared trace dimensions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-5 pb-5">
                  <TopList
                    title="Shared batches"
                    items={dossier.crossProductSummaries.sharedSupplierBatches.map((item) => ({
                      label: item.batchRef,
                      count: item.productIds.length,
                    }))}
                  />
                  <TopList
                    title="Shared claim themes"
                    items={dossier.crossProductSummaries.similarClaimThemes.map((item) => ({
                      label: item.keyword,
                      count: item.productIds.length,
                    }))}
                  />
                  <TopList
                    title="Shared test hotspots"
                    items={dossier.crossProductSummaries.sharedTestHotspots.map((item) => ({
                      label: item.testKey,
                      count: item.productIds.length,
                    }))}
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
