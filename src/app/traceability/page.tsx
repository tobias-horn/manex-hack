import { ArrowLeft, GitBranch, Network, Search } from "lucide-react";
import Link from "next/link";

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
import { DEMO_TRACEABILITY_JUMPS } from "@/lib/manex-demo";
import {
  getTraceabilityWorkbench,
  parseTraceabilityFilters,
  type ProductTraceability,
  type TraceabilityBlastRadius,
} from "@/lib/manex-traceability";
import { formatUiDateTime } from "@/lib/ui-format";

export const dynamic = "force-dynamic";

type TraceabilityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const assemblyTones = [
  "from-[rgba(0,92,151,0.14)] via-[rgba(0,92,151,0.04)] to-transparent",
  "from-[rgba(208,141,37,0.18)] via-[rgba(208,141,37,0.05)] to-transparent",
  "from-[rgba(45,123,98,0.14)] via-[rgba(45,123,98,0.05)] to-transparent",
  "from-[rgba(83,91,201,0.12)] via-[rgba(83,91,201,0.04)] to-transparent",
];

const articleTrackTones = [
  "bg-[linear-gradient(90deg,rgba(0,92,151,0.12),rgba(0,92,151,0.02))]",
  "bg-[linear-gradient(90deg,rgba(208,141,37,0.18),rgba(208,141,37,0.03))]",
  "bg-[linear-gradient(90deg,rgba(45,123,98,0.14),rgba(45,123,98,0.03))]",
  "bg-[linear-gradient(90deg,rgba(83,91,201,0.12),rgba(83,91,201,0.03))]",
];

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
    <div className="rounded-[24px] border border-white/10 bg-[color:var(--surface-low)] px-4 py-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{value}</div>
      <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{caption}</p>
    </div>
  );
}

function FlowNode({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="min-w-[118px]">
      <div className="lab-stamp">{label}</div>
      <div className="mt-3 flex items-center gap-3">
        <div className={`size-3 rounded-full ${accent}`} />
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

function GraphReadiness({
  nodeCount,
  edgeCount,
  transport,
}: {
  nodeCount: number;
  edgeCount: number;
  transport: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(135deg,rgba(0,92,151,0.08),rgba(255,255,255,0))] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Graph-ready shape</div>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">
            The helper already emits a reusable node-edge chain, so later RCA views can
            become more visual without rebuilding the deterministic trace logic.
          </p>
        </div>
        <Badge variant="outline">{transport}</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-4">
          <div className="lab-stamp">Nodes</div>
          <div className="mt-2 text-2xl font-semibold">{nodeCount}</div>
        </div>
        <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-4">
          <div className="lab-stamp">Edges</div>
          <div className="mt-2 text-2xl font-semibold">{edgeCount}</div>
        </div>
      </div>
    </div>
  );
}

function QueryJumpCard({
  label,
  description,
  href,
}: {
  label: string;
  description: string;
  href: string;
}) {
  return (
    <article className="rounded-[24px] border border-white/10 bg-black/8 p-4">
      <div className="text-sm font-semibold">{label}</div>
      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
        {description}
      </p>
      <div className="mt-4">
        <Button variant="outline" size="sm" render={<Link href={href}>Open path</Link>} />
      </div>
    </article>
  );
}

function PartInstallCard({
  tone,
  item,
}: {
  tone: string;
  item: ProductTraceability["assemblies"][number]["items"][number];
}) {
  return (
    <article className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[color:var(--raised-overlay-surface)] p-4 shadow-[0_14px_36px_rgba(25,28,29,0.05)]">
      <div className={`absolute inset-x-0 top-0 h-20 bg-gradient-to-r ${tone}`} />
      <div className="relative space-y-4">
        <div className="flex items-start justify-between gap-3">
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
          <div className="rounded-[18px] bg-black/6 px-3 py-2 text-right">
            <div className="lab-stamp">Supplier</div>
            <div className="mt-1 text-sm font-medium">
              {item.supplierName ?? "Unknown supplier"}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-3">
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
          <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-3">
            <div className="lab-stamp">Build context</div>
            <div className="mt-2 font-medium">
              {item.manufacturerName ?? "Manufacturer n/a"}
            </div>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {item.articleName ?? item.articleId ?? "Article unavailable"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {item.commodity ? <Badge variant="secondary">{item.commodity}</Badge> : null}
          {item.drawingNumber ? (
            <Badge variant="secondary">{item.drawingNumber}</Badge>
          ) : null}
          {item.batchReceivedDate ? (
            <Badge variant="secondary">
              Received {formatUiDateTime(item.batchReceivedDate)}
            </Badge>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ProductTraceCard({
  trace,
}: {
  trace: ProductTraceability | null;
}) {
  if (!trace?.product) {
    return (
      <Card className="surface-sheet rounded-[32px] px-0 py-0">
        <CardHeader className="px-6 pt-6">
          <Badge>Product trace</Badge>
          <CardTitle className="section-title mt-3">Installed parts</CardTitle>
          <CardDescription className="mt-2 leading-6">
            Enter a product ID or open one of the demo paths to render the full
            product-to-batch chain.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="surface-sheet overflow-hidden rounded-[32px] px-0 py-0">
      <CardHeader className="spec-grid px-6 pt-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_420px]">
          <div>
            <Badge>Product trace</Badge>
            <CardTitle className="section-title mt-3">
              {trace.product.productId}
            </CardTitle>
            <CardDescription className="mt-3 max-w-2xl leading-6">
              Deterministic installed-part facts for{" "}
              {trace.product.articleName ?? trace.product.articleId ?? "Unknown article"}.
              The layout now follows the actual chain from build identity through installed
              components into supplier and batch context.
            </CardDescription>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(0,92,151,0.12),rgba(255,255,255,0.02))] p-5">
            <div className="eyebrow">Live chain</div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <FlowNode
                label="Article"
                value={trace.product.articleName ?? trace.product.articleId ?? "Unknown"}
                accent="bg-[var(--primary)]"
              />
              <div className="hidden h-px flex-1 min-w-[44px] bg-[color:rgba(20,32,42,0.12)] sm:block" />
              <FlowNode
                label="Product"
                value={trace.product.productId}
                accent="bg-[color:rgba(208,141,37,0.9)]"
              />
              <div className="hidden h-px flex-1 min-w-[44px] bg-[color:rgba(20,32,42,0.12)] sm:block" />
              <FlowNode
                label="Batches"
                value={`${trace.product.uniqueBatchCount} active`}
                accent="bg-[color:rgba(45,123,98,0.9)]"
              />
              <div className="hidden h-px flex-1 min-w-[44px] bg-[color:rgba(20,32,42,0.12)] sm:block" />
              <FlowNode
                label="Suppliers"
                value={`${trace.product.uniqueSupplierCount} linked`}
                accent="bg-[color:rgba(83,91,201,0.9)]"
              />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {trace.product.orderId ? (
                <Badge variant="outline">{trace.product.orderId}</Badge>
              ) : null}
              <Badge variant="outline">
                Built {formatUiDateTime(trace.product.buildTs)}
              </Badge>
              <Badge variant="outline">{trace.transport}</Badge>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 px-5 pb-5 pt-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KeyMetric
            label="Installed parts"
            value={trace.product.installedPartCount}
            caption="Rows in the installed-part view."
          />
          <KeyMetric
            label="Assemblies"
            value={trace.assemblies.length}
            caption="Distinct parent tracks in this build."
          />
          <KeyMetric
            label="Unique batches"
            value={trace.product.uniqueBatchCount}
            caption="Supplier batches touching this product."
          />
          <KeyMetric
            label="Suppliers"
            value={trace.product.uniqueSupplierCount}
            caption="Distinct supplier footprints."
          />
          <KeyMetric
            label="Part masters"
            value={trace.product.uniquePartCount}
            caption="Unique part numbers installed."
          />
        </div>

        <GraphReadiness
          edgeCount={trace.graph.edges.length}
          nodeCount={trace.graph.nodes.length}
          transport={trace.transport}
        />

        <div className="space-y-5">
          {trace.assemblies.map((assembly, index) => {
            const tone = assemblyTones[index % assemblyTones.length];
            const uniqueBatchCount = new Set(
              assembly.items.map((item) => item.batchId ?? item.batchNumber).filter(Boolean),
            ).size;
            const uniqueSupplierCount = new Set(
              assembly.items.map((item) => item.supplierName).filter(Boolean),
            ).size;

            return (
              <section
                key={assembly.assemblyLabel}
                className="overflow-hidden rounded-[30px] border border-white/10 bg-[color:var(--raised-overlay-surface)]"
              >
                <div className={`bg-gradient-to-r ${tone} px-5 py-5`}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className="lab-stamp">Assembly track</div>
                      <h3 className="mt-2 text-xl font-semibold">
                        {assembly.assemblyLabel}
                      </h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{assembly.partCount} installs</Badge>
                      <Badge variant="outline">{uniqueBatchCount} batches</Badge>
                      <Badge variant="outline">{uniqueSupplierCount} suppliers</Badge>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 p-4 xl:grid-cols-2">
                  {assembly.items.map((item) => (
                    <PartInstallCard key={item.installId} item={item} tone={tone} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function BlastRadiusCard({
  blastRadius,
}: {
  blastRadius: TraceabilityBlastRadius | null;
}) {
  if (!blastRadius) {
    return (
      <Card className="surface-panel rounded-[32px] px-0 py-0">
        <CardHeader className="px-6 pt-6">
          <Badge variant="outline">Blast radius</Badge>
          <CardTitle className="section-title mt-3">Affected products</CardTitle>
          <CardDescription className="mt-2 leading-6">
            Enter a suspect batch or part number to light up the related-product field.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const largestTrack = Math.max(
    ...blastRadius.articleTracks.map((track) => track.productCount),
    1,
  );

  return (
    <Card className="surface-panel overflow-hidden rounded-[32px] px-0 py-0">
      <CardHeader className="spec-grid px-6 pt-6">
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge variant="outline">Blast radius</Badge>
              <CardTitle className="section-title mt-3">
                {blastRadius.suspect.batchId ??
                  blastRadius.suspect.batchNumber ??
                  blastRadius.suspect.partNumber ??
                  "Suspect component"}
              </CardTitle>
              <CardDescription className="mt-2 max-w-2xl leading-6">
                Follow one suspect component outward into the products it touches. This
                is the blast-radius half of the same deterministic trace chain.
              </CardDescription>
            </div>
            <Badge variant="outline">{blastRadius.transport}</Badge>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(20,32,42,0.08),rgba(255,255,255,0.02))] p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="eyebrow">Affected products</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                  {blastRadius.suspect.affectedProductCount}
                </div>
              </div>
              <div>
                <div className="eyebrow">Matched installs</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                  {blastRadius.suspect.matchedInstallCount}
                </div>
              </div>
              <div>
                <div className="eyebrow">Supplier footprint</div>
                <div className="mt-2 text-sm font-medium leading-6">
                  {blastRadius.suspect.supplierNames.join(", ") ||
                    "Supplier not attached to the result."}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 px-5 pb-5 pt-5">
        <GraphReadiness
          edgeCount={blastRadius.graph.edges.length}
          nodeCount={blastRadius.graph.nodes.length}
          transport={blastRadius.transport}
        />

        <section className="space-y-3">
          <div>
            <div className="lab-stamp">Article tracks</div>
            <h3 className="mt-1 text-lg font-semibold">Spread across articles</h3>
          </div>
          <div className="space-y-3">
            {blastRadius.articleTracks.map((track, index) => {
              const width = `${Math.max(
                18,
                Math.round((track.productCount / largestTrack) * 100),
              )}%`;

              return (
                <article
                  key={track.articleId ?? track.articleName}
                  className={`overflow-hidden rounded-[24px] ${articleTrackTones[index % articleTrackTones.length]}`}
                >
                  <div className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="lab-stamp">Article</div>
                        <div className="mt-1 text-base font-semibold">
                          {track.articleName}
                        </div>
                      </div>
                      <Badge variant="outline">{track.productCount} products</Badge>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/8">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,var(--primary),rgba(0,92,151,0.35))]"
                        style={{ width }}
                      />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {track.productIds.map((productId) => (
                        <Badge key={productId} variant="secondary">
                          {productId}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <div className="lab-stamp">Related products</div>
            <h3 className="mt-1 text-lg font-semibold">Reusable blast-radius rows</h3>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {blastRadius.relatedProducts.map((product, index) => (
              <article
                key={product.productId}
                className={`overflow-hidden rounded-[24px] border border-white/10 bg-[color:var(--raised-overlay-surface)] shadow-[0_14px_36px_rgba(25,28,29,0.05)]`}
              >
                <div
                  className={`h-18 bg-gradient-to-r ${assemblyTones[index % assemblyTones.length]} px-4 py-4`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="lab-stamp">Product</div>
                      <div className="mt-1 text-lg font-semibold">{product.productId}</div>
                    </div>
                    <Badge variant="outline">{product.matchedParts.length} installs</Badge>
                  </div>
                </div>
                <div className="space-y-4 p-4">
                  <div>
                    <div className="text-sm font-semibold">
                      {product.articleName ?? product.articleId ?? "Unknown article"}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      Built {formatUiDateTime(product.buildTs)} · order{" "}
                      {product.orderId ?? "n/a"} · positions{" "}
                      {product.sharedPositions.join(", ") ||
                        product.sharedFindNumbers.join(", ") ||
                        "n/a"}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {product.sharedBatchIds.map((batchId) => (
                      <Badge key={batchId} variant="outline">
                        {batchId}
                      </Badge>
                    ))}
                    {product.sharedPartNumbers.map((partNumber) => (
                      <Badge key={partNumber} variant="outline">
                        {partNumber}
                      </Badge>
                    ))}
                  </div>

                  <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-3">
                    <div className="lab-stamp">Supplier trail</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      {product.sharedSuppliers.join(", ") || "Supplier unknown"}
                    </p>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href={`/products/${product.productId}`}>Open dossier</Link>}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

export default async function TraceabilityPage({
  searchParams,
}: TraceabilityPageProps) {
  const params = await searchParams;
  const filters = parseTraceabilityFilters(params);
  let workbench;

  try {
    workbench = await getTraceabilityWorkbench(filters);
  } catch {
    return (
      <ScreenState
        eyebrow="Trace unavailable"
        title="The traceability explorer could not be loaded"
        description="The deterministic product-to-batch helper chain hit a temporary read error. Use one of the seeded live queries to retry with a known-good path."
        tone="error"
        actions={
          <>
            {DEMO_TRACEABILITY_JUMPS.slice(0, 2).map((jump) => (
              <Button
                key={jump.id}
                size="lg"
                variant="outline"
                render={<Link href={jump.href}>{jump.label}</Link>}
              />
            ))}
            <Button size="lg" render={<Link href="/">Back to inbox</Link>} />
          </>
        }
      />
    );
  }

  const formDefaults = {
    product: filters.productId ?? workbench.defaults.productId ?? "",
    batch: filters.batchRef ?? workbench.defaults.batchRef ?? "",
    part: filters.partNumber ?? workbench.defaults.partNumber ?? "",
  };

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border spec-grid overflow-hidden rounded-[34px] px-5 py-5 sm:px-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
            <div className="space-y-4">
              <Badge variant="outline">
                <GitBranch className="size-3.5" />
                Traceability
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.04em] sm:text-5xl">
                Product-to-batch trace explorer
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                The screen now behaves like an investigation canvas: one side follows the
                build inward through installed components, the other side fans the suspect
                path outward into related products.
              </p>
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
                  render={<Link href="/products/PRD-00023">Open dossier seed</Link>}
                />
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(0,92,151,0.14),rgba(20,32,42,0.03))] p-5">
              <div className="eyebrow">Visual structure</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[22px] bg-white/60 px-4 py-4">
                  <div className="lab-stamp">Left lane</div>
                  <div className="mt-2 text-lg font-semibold">Build to install</div>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                    Product identity, assembly tracks, and part installs.
                  </p>
                </div>
                <div className="rounded-[22px] bg-white/60 px-4 py-4">
                  <div className="lab-stamp">Right lane</div>
                  <div className="mt-2 text-lg font-semibold">Suspect to spread</div>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                    Batch radius, article spread, and related products.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="size-3 rounded-full bg-[var(--primary)]" />
                <div className="h-px flex-1 bg-[color:rgba(20,32,42,0.14)]" />
                <div className="size-3 rounded-full bg-[color:rgba(208,141,37,0.92)]" />
                <div className="h-px flex-1 bg-[color:rgba(20,32,42,0.14)]" />
                <div className="size-3 rounded-full bg-[color:rgba(45,123,98,0.92)]" />
                <div className="h-px flex-1 bg-[color:rgba(20,32,42,0.14)]" />
                <div className="size-3 rounded-full bg-[color:rgba(83,91,201,0.92)]" />
              </div>
            </div>
          </div>
        </header>

        <Card className="surface-sheet overflow-hidden rounded-[32px] px-0 py-0">
          <CardHeader className="px-6 pt-6">
            <Badge>
              <Search className="size-3.5" />
              Query helpers
            </Badge>
            <CardTitle className="section-title mt-3">
              Trace one product or one suspect component
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl leading-6">
              The defaults open on a live shared component path so the screen is useful
              immediately. Override the product, batch, or part number whenever you want
              to pivot the investigation.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-5 px-5 pb-5 xl:grid-cols-[minmax(0,1.1fr)_420px]">
            <form action="/traceability" className="space-y-4 rounded-[28px] border border-white/10 bg-[color:var(--surface-low)] p-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="lab-stamp" htmlFor="product">
                    Product
                  </label>
                  <input
                    id="product"
                    name="product"
                    defaultValue={formDefaults.product}
                    placeholder="PRD-00159"
                    className="h-12 w-full rounded-[1rem] border border-transparent bg-white px-3.5 text-sm text-foreground outline-none shadow-[inset_0_0_0_1px_rgba(20,32,42,0.06)]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="lab-stamp" htmlFor="batch">
                    Batch
                  </label>
                  <input
                    id="batch"
                    name="batch"
                    defaultValue={formDefaults.batch}
                    placeholder="SB-00008 or B00008"
                    className="h-12 w-full rounded-[1rem] border border-transparent bg-white px-3.5 text-sm text-foreground outline-none shadow-[inset_0_0_0_1px_rgba(20,32,42,0.06)]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="lab-stamp" htmlFor="part">
                    Part master
                  </label>
                  <input
                    id="part"
                    name="part"
                    defaultValue={formDefaults.part}
                    placeholder="PM-00008"
                    className="h-12 w-full rounded-[1rem] border border-transparent bg-white px-3.5 text-sm text-foreground outline-none shadow-[inset_0_0_0_1px_rgba(20,32,42,0.06)]"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" size="lg">
                  Load trace
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  render={<Link href="/traceability">Reset</Link>}
                />
              </div>
            </form>

            <div className="rounded-[28px] border border-white/10 bg-black/8 p-4">
              <div className="eyebrow">Demo paths</div>
              <div className="mt-4 space-y-3">
                {DEMO_TRACEABILITY_JUMPS.map((jump) => (
                  <QueryJumpCard
                    key={jump.id}
                    label={jump.label}
                    description={jump.description}
                    href={jump.href}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(420px,0.82fr)]">
          <div className="space-y-6">
            <ProductTraceCard trace={workbench.productTrace} />
          </div>

          <div className="space-y-6">
            <BlastRadiusCard blastRadius={workbench.blastRadius} />

            <Card className="surface-sheet rounded-[32px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <Network className="size-3.5" />
                  Deterministic chain
                </Badge>
                <CardTitle className="section-title mt-3">
                  What the helper spine already answers
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 px-5 pb-5 md:grid-cols-2">
                <div className="rounded-[24px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Product to installed parts</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    Every installed row carries position, supplier, batch, serial, and
                    article context for later tables and graphs.
                  </p>
                </div>
                <div className="rounded-[24px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Part or batch to products</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    Related products are grouped and deduplicated so blast-radius review
                    is usable before any AI reasoning gets layered on top.
                  </p>
                </div>
                <div className="rounded-[24px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Table-ready and graph-ready</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    The current page is more visual, but the underlying helper outputs stay
                    deterministic and reusable for Stage 2.
                  </p>
                </div>
                <div className="rounded-[24px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Easy drill-down</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    Related products now link directly into the dossier so the trace view
                    feels like part of a coherent product surface instead of a dead end.
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
