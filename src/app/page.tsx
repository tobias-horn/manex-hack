import { CheckCircle2, Database, ExternalLink, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getManexDatasetSmokeTest } from "@/lib/manex-dataset";

export const dynamic = "force-dynamic";

const statusTone = {
  live: "bg-emerald-500/12 text-emerald-200 border-emerald-400/25",
  missing: "bg-amber-500/12 text-amber-100 border-amber-400/20",
  error: "bg-rose-500/12 text-rose-100 border-rose-400/25",
} as const;

const statusLabel = {
  live: "Live",
  missing: "Missing config",
  error: "Connection failed",
} as const;

export default async function Home() {
  const smokeTest = await getManexDatasetSmokeTest();

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border rounded-[28px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="eyebrow">Manex // Dataset Connection</div>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                Hackathon smoke test
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                <code className="mx-1 rounded bg-black/20 px-1.5 py-0.5 text-xs">
                  npm run dev
                </code>
                now brings up a live dataset proof surface. The screen below
                checks both direct Postgres and the REST API against
                <code className="mx-1 rounded bg-black/20 px-1.5 py-0.5 text-xs">
                  v_defect_detail
                </code>
                and shows the latest sample rows it can read.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Badge
                className={
                  smokeTest.ok
                    ? "border-emerald-400/25 bg-emerald-500/12 text-emerald-100"
                    : "border-amber-400/20 bg-amber-500/12 text-amber-100"
                }
              >
                {smokeTest.ok ? "Dataset reachable" : "Waiting for credentials"}
              </Badge>
              <Badge variant="outline">
                /api/data-connection
              </Badge>
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
          <Card className="surface-panel rounded-[30px] px-0 py-0">
            <CardHeader className="px-6 pt-6">
              <Badge variant="outline">Visible proof</Badge>
              <CardTitle className="section-title mt-3">
                Dataset check summary
              </CardTitle>
              <CardDescription className="mt-2 max-w-2xl leading-6">
                The app requests a row count and the newest sample rows from the
                hackathon view. This is the same connection layer later product
                features can build on.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-5 sm:px-5">
              <div className="surface-sheet spec-grid rounded-[26px] p-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Status</div>
                    <div className="mt-3 flex items-center gap-2 text-lg font-semibold">
                      {smokeTest.ok ? (
                        <CheckCircle2 className="size-5 text-emerald-300" />
                      ) : (
                        <ShieldAlert className="size-5 text-amber-200" />
                      )}
                      {smokeTest.ok ? "Connected" : "Not connected yet"}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      Preferred path: {smokeTest.preferredPath ?? "none"}
                    </p>
                  </div>

                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Row count</div>
                    <div className="mt-3 text-3xl font-semibold">
                      {smokeTest.rowCount?.toLocaleString() ?? "n/a"}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      Count requested from <code>v_defect_detail</code>.
                    </p>
                  </div>

                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Checked</div>
                    <div className="mt-3 text-lg font-semibold">
                      {new Date(smokeTest.checkedAt).toLocaleString("de-DE")}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                      Route is uncached so refreshes hit the latest dataset state.
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-3">
                  {smokeTest.sampleRows.length ? (
                    smokeTest.sampleRows.map((row) => (
                      <div
                        key={row.defectId}
                        className="rounded-[24px] border border-white/8 bg-black/10 p-4"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge>{row.defectCode}</Badge>
                              <Badge variant="outline">{row.severity}</Badge>
                              <span className="text-sm text-[var(--muted-foreground)]">
                                {row.defectId} on {row.productId}
                              </span>
                            </div>
                            <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                              {row.articleName} · {row.detectedSection} · {row.partLabel}
                            </p>
                            <p className="max-w-3xl text-sm leading-6">
                              {row.notes}
                            </p>
                          </div>

                          <div className="text-sm text-[var(--muted-foreground)]">
                            {new Date(row.defectTimestamp).toLocaleString("de-DE")}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-white/10 bg-black/10 p-6">
                      <div className="eyebrow">No live rows yet</div>
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
                        Add the handout values to <code>.env.local</code> and refresh.
                        The screen will then show the latest defects coming from
                        the real hackathon dataset.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="surface-sheet rounded-[30px] px-0 py-0">
            <CardHeader className="px-6 pt-6">
              <Badge>Access paths</Badge>
              <CardTitle className="section-title mt-3">
                Connection diagnostics
              </CardTitle>
              <CardDescription className="mt-2 leading-6">
                Each card corresponds to a real hackathon access pattern.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-5 sm:px-5">
              <div className="grid gap-3">
                {smokeTest.connections.map((connection) => (
                  <div
                    key={connection.path}
                    className="rounded-[24px] bg-[color:var(--surface-low)] px-4 py-5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{connection.label}</div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs ${statusTone[connection.mode]}`}
                      >
                        {statusLabel[connection.mode]}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                      {connection.detail}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                      {connection.elapsedMs !== null
                        ? `Response time: ${connection.elapsedMs} ms`
                        : "No request sent yet."}
                    </p>
                    {connection.debug ? (
                      <p className="mt-2 rounded-2xl bg-black/15 px-3 py-2 font-mono text-xs leading-5 text-rose-100">
                        {connection.debug}
                      </p>
                    ) : null}
                  </div>
                ))}

                <div className="rounded-[24px] bg-[color:var(--surface-low)] px-4 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">SQL editor</div>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs">
                      {smokeTest.studio.configured ? "Configured" : "Optional"}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                    Keep the Studio URL from the handout around for ad-hoc SQL
                    debugging when REST query shapes get awkward.
                  </p>
                  {smokeTest.studio.url ? (
                    <a
                      href={smokeTest.studio.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--accent)]"
                    >
                      <ExternalLink className="size-4" />
                      Open Studio
                    </a>
                  ) : null}
                </div>

                <div className="rounded-[24px] bg-[color:var(--surface-low)] px-4 py-5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Database className="size-4" />
                    Next steps
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                    This same shared connection layer can now power deeper charts,
                    traces, and write-back workflows without manual query editing.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
