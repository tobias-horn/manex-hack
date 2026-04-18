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

const articleTrackTones = [
  "bg-[color:rgba(0,92,151,0.08)]",
  "bg-[color:rgba(208,141,37,0.12)]",
  "bg-[color:rgba(45,123,98,0.1)]",
  "bg-[color:rgba(83,91,201,0.08)]",
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
    <div className="rounded-[22px] bg-[color:var(--surface-low)] px-4 py-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{caption}</p>
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
    <div className="rounded-[22px] border border-white/10 bg-black/8 p-4">
      <div className="eyebrow">Graph-ready shape</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline">{nodeCount} nodes</Badge>
        <Badge variant="outline">{edgeCount} edges</Badge>
        <Badge variant="outline">{transport}</Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
        The helpers already emit deterministic nodes and edges, so later RCA work can
        move from tables to graph views without rebuilding the traceability chain.
      </p>
    </div>
  );
}

function ProductTraceCard({
  trace,
}: {
  trace: ProductTraceability | null;
}) {
  if (!trace?.product) {
    return (
      <Card className="surface-sheet rounded-[30px] px-0 py-0">
        <CardHeader className="px-6 pt-6">
          <Badge>Product trace</Badge>
          <CardTitle className="section-title mt-3">Installed parts</CardTitle>
          <CardDescription className="mt-2 leading-6">
            Enter a product ID to load the deterministic installed-parts trail.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="surface-sheet overflow-hidden rounded-[30px] px-0 py-0">
      <CardHeader className="spec-grid px-6 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge>Product trace</Badge>
            <CardTitle className="section-title mt-3">
              {trace.product.productId}
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl leading-6">
              {trace.product.articleName ?? trace.product.articleId ?? "Unknown article"} ·{" "}
              {trace.product.orderId ?? "Order unavailable"} · built{" "}
              {formatUiDateTime(trace.product.buildTs)}
            </CardDescription>
          </div>
          <Badge variant="outline">{trace.transport}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 px-5 pb-5 pt-5">
        <div className="grid gap-4 md:grid-cols-4">
          <KeyMetric
            label="Installed parts"
            value={trace.product.installedPartCount}
            caption="Physical installs found in the BOM-position view."
          />
          <KeyMetric
            label="Unique batches"
            value={trace.product.uniqueBatchCount}
            caption="Distinct supplier batches across this product."
          />
          <KeyMetric
            label="Suppliers"
            value={trace.product.uniqueSupplierCount}
            caption="Supplier footprints in this build."
          />
          <KeyMetric
            label="Part masters"
            value={trace.product.uniquePartCount}
            caption="Distinct part numbers across installed components."
          />
        </div>

        <GraphReadiness
          edgeCount={trace.graph.edges.length}
          nodeCount={trace.graph.nodes.length}
          transport={trace.transport}
        />

        <div className="space-y-4">
          {trace.assemblies.map((assembly) => (
            <section key={assembly.assemblyLabel} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="lab-stamp">Assembly track</div>
                  <h3 className="mt-1 text-lg font-semibold">{assembly.assemblyLabel}</h3>
                </div>
                <Badge variant="outline">{assembly.partCount} installs</Badge>
              </div>
              <div className="space-y-2">
                {assembly.items.map((item) => (
                  <article
                    key={item.installId}
                    className="spec-grid rounded-[24px] border border-white/10 bg-[color:rgba(255,255,255,0.72)] p-4"
                  >
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_170px_180px_170px]">
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
                          Received {item.batchReceivedDate ?? "unknown"}
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
          ))}
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
      <Card className="surface-panel rounded-[30px] px-0 py-0">
        <CardHeader className="px-6 pt-6">
          <Badge variant="outline">Blast radius</Badge>
          <CardTitle className="section-title mt-3">Affected products</CardTitle>
          <CardDescription className="mt-2 leading-6">
            Enter a suspect batch or part number to trace back to related products.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="surface-panel overflow-hidden rounded-[30px] px-0 py-0">
      <CardHeader className="spec-grid px-6 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Badge variant="outline">Blast radius</Badge>
            <div>
              <CardTitle className="section-title">
                {blastRadius.suspect.batchId ??
                  blastRadius.suspect.batchNumber ??
                  blastRadius.suspect.partNumber ??
                  "Suspect component"}
              </CardTitle>
              <CardDescription className="mt-2 max-w-2xl leading-6">
                {blastRadius.suspect.partNumber
                  ? `${blastRadius.suspect.partNumber} linked through ${blastRadius.suspect.affectedProductCount} products.`
                  : "Batch-only blast radius loaded."}
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline">{blastRadius.transport}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 px-5 pb-5 pt-5">
        <div className="grid gap-4 md:grid-cols-3">
          <KeyMetric
            label="Affected products"
            value={blastRadius.suspect.affectedProductCount}
            caption="Products sharing the suspect component path."
          />
          <KeyMetric
            label="Matched installs"
            value={blastRadius.suspect.matchedInstallCount}
            caption="Installed-part rows in the blast radius."
          />
          <KeyMetric
            label="Suppliers"
            value={blastRadius.suspect.supplierNames.length}
            caption={
              blastRadius.suspect.supplierNames[0] ?? "Supplier not attached to the result."
            }
          />
        </div>

        <GraphReadiness
          edgeCount={blastRadius.graph.edges.length}
          nodeCount={blastRadius.graph.nodes.length}
          transport={blastRadius.transport}
        />

        <section className="space-y-3">
          <div>
            <div className="lab-stamp">Article tracks</div>
            <h3 className="mt-1 text-lg font-semibold">Products grouped by article</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {blastRadius.articleTracks.map((track, index) => (
              <article
                key={track.articleId ?? track.articleName}
                className={`rounded-[24px] p-4 ${articleTrackTones[index % articleTrackTones.length]}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="lab-stamp">Article</div>
                    <div className="mt-1 text-base font-semibold">
                      {track.articleName}
                    </div>
                  </div>
                  <Badge variant="outline">{track.productCount} products</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {track.productIds.map((productId) => (
                    <Badge key={productId} variant="secondary">
                      {productId}
                    </Badge>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <div className="lab-stamp">Related products</div>
            <h3 className="mt-1 text-lg font-semibold">Reusable blast-radius rows</h3>
          </div>
          <div className="space-y-2">
            {blastRadius.relatedProducts.map((product) => (
              <article
                key={product.productId}
                className="rounded-[24px] border border-white/10 bg-[color:rgba(255,255,255,0.72)] p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{product.productId}</Badge>
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
                    <div className="text-base font-semibold">
                      {product.articleName ?? product.articleId ?? "Unknown article"}
                    </div>
                    <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                      Built {formatUiDateTime(product.buildTs)} · order{" "}
                      {product.orderId ?? "n/a"} · positions{" "}
                      {product.sharedPositions.join(", ") || product.sharedFindNumbers.join(", ") || "n/a"}
                    </p>
                  </div>

                  <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-3 text-right">
                    <div className="lab-stamp">Matched installs</div>
                    <div className="mt-2 text-lg font-semibold">
                      {product.matchedParts.length}
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {product.sharedSuppliers.join(", ") || "Supplier unknown"}
                    </p>
                    <div className="mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        render={<Link href={`/products/${product.productId}`}>Open dossier</Link>}
                      />
                    </div>
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
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border spec-grid rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <GitBranch className="size-3.5" />
                Traceability
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                Product-to-batch trace explorer
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                This view stays deterministic: product to installed parts, installed parts to
                supplier batch, and suspect part or batch back to related products. It is built
                on the full BOM-position traceability view so later RCA and blast-radius flows
                can reuse the same chain.
              </p>
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

        <Card className="surface-sheet rounded-[30px] px-0 py-0">
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
              immediately. You can override the product, batch, or part number at any time.
            </CardDescription>
            <div className="mt-4 flex flex-wrap gap-2">
              {DEMO_TRACEABILITY_JUMPS.map((jump) => (
                <Button
                  key={jump.id}
                  variant="outline"
                  size="sm"
                  render={<Link href={jump.href}>{jump.label}</Link>}
                />
              ))}
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <form action="/traceability" className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto]">
              <div className="space-y-2">
                <label className="lab-stamp" htmlFor="product">
                  Product
                </label>
                <input
                  id="product"
                  name="product"
                  defaultValue={formDefaults.product}
                  placeholder="PRD-00159"
                  className="h-11 w-full rounded-[1rem] border border-border bg-[color:var(--surface-lowest)] px-3.5 text-sm text-foreground outline-none"
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
                  className="h-11 w-full rounded-[1rem] border border-border bg-[color:var(--surface-lowest)] px-3.5 text-sm text-foreground outline-none"
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
                  className="h-11 w-full rounded-[1rem] border border-border bg-[color:var(--surface-lowest)] px-3.5 text-sm text-foreground outline-none"
                />
              </div>
              <div className="flex items-end gap-3">
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
          </CardContent>
        </Card>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <ProductTraceCard trace={workbench.productTrace} />
          </div>

          <div className="space-y-6">
            <BlastRadiusCard blastRadius={workbench.blastRadius} />

            <Card className="surface-sheet rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge variant="outline">
                  <Network className="size-3.5" />
                  Deterministic chain
                </Badge>
                <CardTitle className="section-title mt-3">
                  What the helpers answer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Product → installed parts</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    Every installed part row carries BOM position, supplier, batch, serial,
                    and article context for table and graph use.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Part or batch → related products</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    The reverse helper groups affected products and article tracks without
                    leaking raw transport logic into the UI.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Ready for RCA later</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    These helpers stop at deterministic lineage today, which makes future
                    blast-radius and root-cause features easier to layer on safely.
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
