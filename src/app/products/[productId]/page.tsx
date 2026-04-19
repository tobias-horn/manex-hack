import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Camera,
  FileWarning,
  FlaskConical,
  PackageSearch,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClusteringPipelineToggle } from "@/components/clustering-pipeline-toggle";
import { ProductActionPanel } from "@/components/product-action-panel";
import { QualitySignalImage } from "@/components/quality-signal-image";
import { ScreenState } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DEMO_DOSSIER_PRODUCTS } from "@/lib/manex-demo";
import { getProposedCasesForProduct } from "@/lib/manex-case-clustering";
import {
  buildClusteringModeHref,
  parseClusteringMode,
} from "@/lib/manex-clustering-mode";
import { getDeterministicProposedCasesForProduct } from "@/lib/manex-deterministic-case-clustering";
import { getHypothesisProposedCasesForProduct } from "@/lib/manex-hypothesis-case-clustering";
import {
  getProductDossier,
  type ProductDossierEvidenceFrame,
} from "@/lib/manex-product-dossier";
import { formatUiDate, formatUiDateTime } from "@/lib/ui-format";

export const dynamic = "force-dynamic";

type ProductDossierPageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const severityTone: Record<string, string> = {
  critical: "bg-[color:rgba(178,69,63,0.12)] text-[var(--destructive)]",
  high: "bg-[color:rgba(178,69,63,0.1)] text-[var(--destructive)]",
  medium: "bg-[color:rgba(208,141,37,0.14)] text-[var(--warning-foreground)]",
  low: "bg-[color:rgba(20,32,42,0.08)] text-foreground",
};

const statusTone: Record<string, string> = {
  FAIL: "bg-[color:rgba(178,69,63,0.12)] text-[var(--destructive)]",
  MARGINAL: "bg-[color:rgba(208,141,37,0.14)] text-[var(--warning-foreground)]",
};

function KeyMetric({
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
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{caption}</p>
    </div>
  );
}

function EvidenceFrame({ frame }: { frame: ProductDossierEvidenceFrame }) {
  return (
    <article className="space-y-3 rounded-[24px] border border-white/10 bg-black/8 p-4">
      <QualitySignalImage
        alt={`${frame.sourceType} evidence ${frame.sourceId}`}
        src={frame.imageUrl}
      />
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{frame.sourceType}</Badge>
          <Badge variant="outline">{frame.sourceId}</Badge>
        </div>
        <div className="mt-3 font-medium">{frame.title}</div>
        <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
          {frame.caption}
        </p>
      </div>
    </article>
  );
}

export default async function ProductDossierPage({
  params,
  searchParams,
}: ProductDossierPageProps) {
  const { productId } = await params;
  const search = await searchParams;
  const mode = parseClusteringMode(search.pipeline);
  let dossier;
  let proposedCases = [];

  try {
    [dossier, proposedCases] = await Promise.all([
      getProductDossier(productId),
      mode === "deterministic"
        ? getDeterministicProposedCasesForProduct(productId)
        : mode === "hypothesis"
          ? getHypothesisProposedCasesForProduct(productId)
        : getProposedCasesForProduct(productId),
    ]);
  } catch {
    return (
      <ScreenState
        eyebrow="Dossier unavailable"
        title="The single-product dossier could not be assembled"
        description="One of the integrated read paths failed while composing the product view. The dataset is still available, and you can jump to one of the seeded demo products below."
        tone="error"
        actions={
          <>
            {DEMO_DOSSIER_PRODUCTS.slice(0, 2).map((productJump) => (
              <Button
                key={productJump.id}
                size="lg"
                variant="outline"
                render={<Link href={productJump.href}>{productJump.label}</Link>}
              />
            ))}
            <Button size="lg" render={<Link href="/">Back to inbox</Link>} />
          </>
        }
      />
    );
  }

  if (!dossier) {
    notFound();
  }

  const product = dossier.product;
  const toggleItems = [
    {
      mode: "current" as const,
      label: "Classic three-layer clustering",
      description: "Original dossier, article-case, and global reconciliation flow.",
      href: buildClusteringModeHref(`/products/${dossier.requestedProductId}`, "current"),
    },
    {
      mode: "deterministic" as const,
      label: "Deterministic issue grouping",
      description: "Small per-product issue extraction with deterministic article grouping.",
      href: buildClusteringModeHref(`/products/${dossier.requestedProductId}`, "deterministic"),
    },
    {
      mode: "hypothesis" as const,
      label: "Case hypothesis engine",
      description:
        "Mechanism-family analyzers rank supplier, process, design, handling, and noise investigations before AI writes the case narrative.",
      href: buildClusteringModeHref(`/products/${dossier.requestedProductId}`, "hypothesis"),
    },
  ];
  const pipelineLabel =
    mode === "deterministic"
      ? "Deterministic issue-grouping pipeline"
      : mode === "hypothesis"
        ? "Case hypothesis engine"
      : "Classic three-layer pipeline";

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border spec-grid rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <PackageSearch className="size-3.5" />
                Integrated dossier
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                {dossier.requestedProductId}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                One investigation surface that ties together product facts, symptom
                signals, traceability context, evidence images, summary history, and
                the first write-back action.
              </p>
              <div className="flex flex-wrap gap-2">
                {product?.articleId ? (
                  <Badge variant="outline">{product.articleId}</Badge>
                ) : null}
                <Badge variant="outline">{pipelineLabel}</Badge>
                {product?.articleName ? (
                  <Badge variant="outline">{product.articleName}</Badge>
                ) : null}
                {product?.orderId ? (
                  <Badge variant="outline">{product.orderId}</Badge>
                ) : null}
                <Badge variant="outline">
                  Built {formatUiDateTime(product?.buildTs ?? null)}
                </Badge>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
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
              <Button
                size="lg"
                variant="outline"
                render={
                  <Link href={`/traceability?product=${dossier.requestedProductId}`}>
                    Open traceability
                  </Link>
                }
              />
              {product?.articleId ? (
                <Button
                  size="lg"
                  variant="outline"
                  render={
                    <Link href={buildClusteringModeHref(`/articles/${product.articleId}`, mode)}>
                      Open article caseboard
                    </Link>
                  }
                />
              ) : null}
              <Button
                size="lg"
                variant="outline"
                render={<Link href="/cases">Open case state</Link>}
              />
            </div>
          </div>
        </header>

        <ClusteringPipelineToggle currentMode={mode} items={toggleItems} />

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.42fr)_390px]">
          <div className="space-y-6">
            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">Snapshot</Badge>
                <CardTitle className="section-title mt-3">
                  Structured product facts
                </CardTitle>
                <CardDescription className="mt-2 max-w-2xl leading-6">
                  This is still a data product, not a conclusion engine. Every block
                  stays close to the underlying evidence.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                  <KeyMetric
                    label="Defects"
                    value={dossier.metrics.defectCount}
                    caption="Observed on this product."
                  />
                  <KeyMetric
                    label="Claims"
                    value={dossier.metrics.claimCount}
                    caption="Field symptoms tied to this serial."
                  />
                  <KeyMetric
                    label="Installed parts"
                    value={dossier.metrics.installedPartCount}
                    caption="BOM-position installs."
                  />
                  <KeyMetric
                    label="Batches"
                    value={dossier.metrics.uniqueBatchCount}
                    caption="Unique supplier batches."
                  />
                  <KeyMetric
                    label="Suppliers"
                    value={dossier.metrics.uniqueSupplierCount}
                    caption="Supplier footprint."
                  />
                  <KeyMetric
                    label="Open actions"
                    value={dossier.metrics.openActionCount}
                    caption="Workflow still in flight."
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>
                  <AlertTriangle className="size-3.5" />
                  Defects
                </Badge>
                <CardTitle className="section-title mt-3">
                  Factory symptom trail
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {dossier.defects.length ? (
                  dossier.defects.map((defect) => (
                    <article
                      key={defect.id}
                      className="rounded-[26px] border border-white/10 bg-black/8 p-5"
                    >
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_220px_170px]">
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            <Badge
                              className={
                                severityTone[defect.severity] ?? severityTone.low
                              }
                            >
                              {defect.severity}
                            </Badge>
                            <Badge variant="outline">{defect.code}</Badge>
                            {defect.reportedPartNumber ? (
                              <Badge variant="outline">
                                {defect.reportedPartNumber}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-base font-semibold">
                            {defect.reportedPartTitle ?? "Factory defect"} · {defect.id}
                          </div>
                          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                            {defect.notes || "No operator notes attached."}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {defect.detectedSectionName ? (
                              <Badge variant="outline">
                                {defect.detectedSectionName}
                              </Badge>
                            ) : null}
                            {defect.detectedTestName ? (
                              <Badge variant="outline">
                                {defect.detectedTestName}
                              </Badge>
                            ) : null}
                          </div>
                        </div>

                        <QualitySignalImage
                          alt={`Defect evidence ${defect.id}`}
                          src={defect.imageUrl}
                        />

                        <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-4">
                          <div className="eyebrow">Occurred</div>
                          <div className="mt-2 text-sm font-medium">
                            {formatUiDateTime(defect.occurredAt)}
                          </div>
                          <div className="mt-4 eyebrow">Transport</div>
                          <div className="mt-2 text-sm font-medium">
                            {dossier.transports.defects ?? "unknown"}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-white/10 bg-black/8 px-4 py-4 text-sm text-[var(--muted-foreground)]">
                    No defects are attached to this product.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>
                  <FileWarning className="size-3.5" />
                  Field claims
                </Badge>
                <CardTitle className="section-title mt-3">
                  Customer-side symptom trail
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {dossier.claims.length ? (
                  dossier.claims.map((claim) => (
                    <article
                      key={claim.id}
                      className="rounded-[26px] border border-white/10 bg-black/8 p-5"
                    >
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_220px_170px]">
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {claim.mappedDefectSeverity ? (
                              <Badge
                                className={
                                  severityTone[claim.mappedDefectSeverity] ??
                                  severityTone.low
                                }
                              >
                                {claim.mappedDefectSeverity}
                              </Badge>
                            ) : null}
                            <Badge variant="outline">
                              {claim.mappedDefectCode ?? "Unmapped claim"}
                            </Badge>
                            {claim.market ? (
                              <Badge variant="outline">{claim.market}</Badge>
                            ) : null}
                          </div>
                          <div className="text-base font-semibold">
                            {claim.id} ·{" "}
                            {claim.reportedPartTitle ??
                              claim.reportedPartNumber ??
                              "Field claim"}
                          </div>
                          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                            {claim.complaintText || claim.notes || "No complaint text attached."}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {claim.daysFromBuild !== null ? (
                              <Badge variant="outline">
                                {claim.daysFromBuild} days from build
                              </Badge>
                            ) : null}
                            {claim.detectedSectionName ? (
                              <Badge variant="outline">
                                {claim.detectedSectionName}
                              </Badge>
                            ) : null}
                          </div>
                        </div>

                        <QualitySignalImage
                          alt={`Field claim evidence ${claim.id}`}
                          src={claim.imageUrl}
                        />

                        <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-4">
                          <div className="eyebrow">Claimed</div>
                          <div className="mt-2 text-sm font-medium">
                            {formatUiDateTime(claim.claimedAt)}
                          </div>
                          <div className="mt-4 eyebrow">Transport</div>
                          <div className="mt-2 text-sm font-medium">
                            {dossier.transports.claims ?? "unknown"}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-white/10 bg-black/8 px-4 py-4 text-sm text-[var(--muted-foreground)]">
                    No field claims are attached to this product.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>
                  <Boxes className="size-3.5" />
                  Installed parts
                </Badge>
                <CardTitle className="section-title mt-3">
                  Batch and supplier context
                </CardTitle>
                <CardDescription className="mt-2 leading-6">
                  Deterministic installed-part facts from the BOM-position traceability
                  view, ready for later blast-radius and RCA work.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 px-5 pb-5">
                {dossier.traceability?.assemblies.length ? (
                  dossier.traceability.assemblies.map((assembly) => (
                    <section key={assembly.assemblyLabel} className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="lab-stamp">Assembly track</div>
                          <h3 className="mt-1 text-lg font-semibold">
                            {assembly.assemblyLabel}
                          </h3>
                        </div>
                        <Badge variant="outline">{assembly.partCount} installs</Badge>
                      </div>
                      <div className="space-y-2">
                        {assembly.items.map((item) => (
                          <article
                            key={item.installId}
                            className="rounded-[24px] border border-white/10 bg-[color:var(--raised-overlay-surface)] p-4"
                          >
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_180px_180px_170px]">
                              <div className="space-y-2">
                                <div className="flex flex-wrap gap-2">
                                  <Badge variant="outline">
                                    {item.positionCode ?? item.findNumber ?? item.bomNodeId}
                                  </Badge>
                                  <Badge variant="outline">{item.partNumber}</Badge>
                                  {item.qualityStatus ? (
                                    <Badge variant="outline">{item.qualityStatus}</Badge>
                                  ) : null}
                                </div>
                                <div className="text-base font-semibold">
                                  {item.partTitle ?? "Unnamed component"}
                                </div>
                                <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                                  Serial {item.serialNumber ?? "n/a"} · installed{" "}
                                  {formatUiDateTime(item.installedAt)}
                                </p>
                              </div>

                              <div>
                                <div className="lab-stamp">Batch</div>
                                <div className="mt-2 font-medium">
                                  {item.batchId ?? item.batchNumber ?? "Unbatched"}
                                </div>
                                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                                  {item.batchNumber && item.batchId
                                    ? `Label ${item.batchNumber}`
                                    : "No batch label"}
                                </p>
                              </div>

                              <div>
                                <div className="lab-stamp">Supplier</div>
                                <div className="mt-2 font-medium">
                                  {item.supplierName ?? "Unknown supplier"}
                                </div>
                                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                                  Received {formatUiDateTime(item.batchReceivedDate)}
                                </p>
                              </div>

                              <div>
                                <div className="lab-stamp">Context</div>
                                <div className="mt-2 font-medium">
                                  {item.manufacturerName ?? "Manufacturer n/a"}
                                </div>
                                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                                  {item.articleName ?? item.articleId ?? "Article unavailable"}
                                </p>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-white/10 bg-black/8 px-4 py-4 text-sm text-[var(--muted-foreground)]">
                    No installed-part trace was returned for this product.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>
                  <Sparkles className="size-3.5" />
                  Proposed clusters
                </Badge>
                <CardTitle className="section-title mt-3">
                  Article-level case suggestions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {proposedCases.length ? (
                  proposedCases.map((candidate) => (
                    <article
                      key={candidate.id}
                      className="rounded-[22px] border border-white/10 bg-black/8 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{candidate.title}</div>
                          <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                            {candidate.summary}
                          </p>
                        </div>
                        <Badge variant="outline">
                          {candidate.confidence !== null
                            ? `${Math.round(candidate.confidence * 100)}%`
                            : "n/a"}
                        </Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline">{candidate.caseKind}</Badge>
                        <Badge variant="outline">{candidate.priority}</Badge>
                      </div>

                      <div className="mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          render={
                            <Link href={buildClusteringModeHref(`/articles/${candidate.articleId}`, mode)}>
                              Open article caseboard
                            </Link>
                          }
                        />
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-white/10 bg-black/8 px-4 py-4 text-sm text-[var(--muted-foreground)]">
                    No proposed case candidates include this product yet. Run the
                    article clustering pass to generate them.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">Demo products</Badge>
                <CardTitle className="section-title mt-3">
                  Quick switch
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {DEMO_DOSSIER_PRODUCTS.map((productJump) => (
                  <article
                    key={productJump.id}
                    className="rounded-[22px] bg-[color:var(--surface-low)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{productJump.label}</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                          {productJump.description}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        render={<Link href={buildClusteringModeHref(productJump.href, mode)}>Open</Link>}
                      />
                    </div>
                  </article>
                ))}
              </CardContent>
            </Card>

            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>
                  <Camera className="size-3.5" />
                  Evidence images
                </Badge>
                <CardTitle className="section-title mt-3">
                  Relevant frames
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {dossier.evidenceFrames.length ? (
                  dossier.evidenceFrames.map((frame) => (
                    <EvidenceFrame key={frame.id} frame={frame} />
                  ))
                ) : (
                  <div className="rounded-[24px] border border-white/10 bg-black/8 px-4 py-4 text-sm text-[var(--muted-foreground)]">
                    No evidence images are attached to this product yet.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>
                  <FlaskConical className="size-3.5" />
                  Quality context
                </Badge>
                <CardTitle className="section-title mt-3">
                  Weekly summary snippets
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {dossier.weeklySummaries.length ? (
                  dossier.weeklySummaries.map((summary) => (
                    <article
                      key={summary.weekStart}
                      className="rounded-[24px] border border-white/10 bg-black/8 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="lab-stamp">
                            {formatUiDate(summary.weekStart)}
                          </div>
                          <div className="mt-1 text-lg font-semibold">
                            {summary.articleName ?? summary.articleId}
                          </div>
                        </div>
                        <Badge variant="outline">
                          {summary.topDefectCode ?? "No dominant code"}
                        </Badge>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[18px] bg-[color:var(--surface-low)] px-3 py-3">
                          <div className="eyebrow">Defects</div>
                          <div className="mt-2 text-xl font-semibold">
                            {summary.defectCount}
                          </div>
                        </div>
                        <div className="rounded-[18px] bg-[color:var(--surface-low)] px-3 py-3">
                          <div className="eyebrow">Claims</div>
                          <div className="mt-2 text-xl font-semibold">
                            {summary.claimCount}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-white/10 bg-black/8 px-4 py-4 text-sm text-[var(--muted-foreground)]">
                    No weekly summary rows were available for this article.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">Test echoes</Badge>
                <CardTitle className="section-title mt-3">
                  Non-pass test context
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                {dossier.testSignals.length ? (
                  dossier.testSignals.map((signal) => (
                    <article
                      key={signal.id}
                      className="rounded-[22px] border border-white/10 bg-black/8 p-4"
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          className={statusTone[signal.overallResult] ?? statusTone.MARGINAL}
                        >
                          {signal.overallResult}
                        </Badge>
                        <Badge variant="outline">{signal.testKey}</Badge>
                        {signal.sectionName ? (
                          <Badge variant="outline">{signal.sectionName}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                        {signal.testValue
                          ? `${signal.testValue}${signal.unit ? ` ${signal.unit}` : ""}`
                          : "No measurement value attached"}{" "}
                        · {formatUiDateTime(signal.occurredAt)}
                      </p>
                    </article>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-white/10 bg-black/8 px-4 py-4 text-sm text-[var(--muted-foreground)]">
                    No failing or marginal tests were returned for this product.
                  </div>
                )}
              </CardContent>
            </Card>

            <ProductActionPanel
              initialActions={dossier.actionFeed}
              defaultProductId={dossier.actionSeed.productId}
              defaultDefectId={dossier.actionSeed.defectId}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
