"use client";

import { Network } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  EconomicBlastRadius,
  EconomicBlastRadiusCostSummary,
} from "@/lib/manex-case-clustering";

const economicCostSegments: Array<{
  key: keyof Pick<
    EconomicBlastRadiusCostSummary,
    "defectCost" | "claimCost" | "reworkCost"
  >;
  label: string;
  barClassName: string;
  dotClassName: string;
}> = [
  {
    key: "defectCost",
    label: "Defects",
    barClassName: "bg-[color:rgba(0,92,151,0.84)]",
    dotClassName: "bg-[color:rgba(0,92,151,0.84)]",
  },
  {
    key: "claimCost",
    label: "Claims",
    barClassName: "bg-[color:rgba(208,141,37,0.92)]",
    dotClassName: "bg-[color:rgba(208,141,37,0.92)]",
  },
  {
    key: "reworkCost",
    label: "Rework",
    barClassName: "bg-[color:rgba(45,123,98,0.84)]",
    dotClassName: "bg-[color:rgba(45,123,98,0.84)]",
  },
];

function formatObservedCost(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatClaimShare(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatShare(value: number) {
  return `${Math.round(value * 100)}%`;
}

function getSafeShare(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return value / total;
}
function CostMixBar({
  cost,
}: {
  cost: EconomicBlastRadiusCostSummary;
}) {
  const activeSegments = economicCostSegments.filter((segment) => cost[segment.key] > 0);

  if (!activeSegments.length) {
    return (
      <div className="rounded-full bg-black/8 px-3 py-2 text-xs text-[var(--muted-foreground)]">
        No cost breakdown was surfaced for this slice yet.
      </div>
    );
  }

  return (
    <div className="h-2 overflow-hidden rounded-full bg-black/8">
      <div className="flex h-full w-full overflow-hidden rounded-full">
        {activeSegments.map((segment) => (
          <div
            key={segment.key}
            className={segment.barClassName}
            style={{
              width: `${Math.max(
                6,
                Math.round(getSafeShare(cost[segment.key], cost.totalCost) * 100),
              )}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CostMixLegend({
  cost,
}: {
  cost: EconomicBlastRadiusCostSummary;
}) {
  const activeSegments = economicCostSegments.filter((segment) => cost[segment.key] > 0);

  if (!activeSegments.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {activeSegments.map((segment) => (
        <div
          key={segment.key}
          className="inline-flex items-center gap-2 rounded-full bg-black/6 px-2.5 py-1 text-[11px] leading-5 text-[var(--muted-foreground)]"
        >
          <span className={`size-2 rounded-full ${segment.dotClassName}`} />
          <span>
            {segment.label} {formatObservedCost(cost[segment.key])}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EconomicBlastRadiusSection({
  blastRadius,
}: {
  blastRadius: EconomicBlastRadius | null;
}) {
  if (!blastRadius) {
    return null;
  }

  return (
    <Card className="surface-panel rounded-[30px] px-0 py-0">
      <CardHeader className="px-6 pt-6">
        <Badge variant="outline">
          <Network className="size-3.5" />
          Economic blast radius
        </Badge>
        <CardTitle className="section-title mt-3">Where the case is expensive</CardTitle>
        <CardDescription className="mt-2 max-w-3xl leading-6">
          These anchors show where the selected case fans out operationally.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 px-5 pb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[24px] border border-white/10 bg-[color:var(--surface-low)] px-4 py-4">
            <div className="eyebrow">Affected products</div>
            <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
              {blastRadius.summary.affectedProductCount}
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              Products inside this case footprint.
            </p>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-[color:var(--surface-low)] px-4 py-4">
            <div className="eyebrow">Observed cost</div>
            <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
              {formatObservedCost(blastRadius.summary.totalCost)}
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              Defects, claims, and rework combined.
            </p>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-[color:var(--surface-low)] px-4 py-4">
            <div className="eyebrow">Claim share</div>
            <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
              {formatClaimShare(blastRadius.summary.claimShare)}
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              Higher values mean the pain has escaped the factory.
            </p>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-[color:var(--surface-low)] px-4 py-4">
            <div className="eyebrow">Anchors surfaced</div>
            <div className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
              {blastRadius.summary.anchorCount}
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              Grouped across trace, process, and handling lanes.
            </p>
          </div>
        </div>
        <section>
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(246,248,250,0.95))] p-5 shadow-[0_16px_34px_rgba(20,32,42,0.05)] dark:bg-[linear-gradient(180deg,rgba(38,44,48,0.92),rgba(20,24,27,0.98))]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="lab-stamp">Cost mix</div>
                <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em]">
                  How the total cost is composed
                </h3>
              </div>
              <Badge variant="outline">
                Total {formatObservedCost(blastRadius.summary.totalCost)}
              </Badge>
            </div>

            <div className="mt-4 space-y-3">
              <CostMixBar cost={blastRadius.summary} />
              <CostMixLegend cost={blastRadius.summary} />
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-4">
                <div className="eyebrow">Defect-driven</div>
                <div className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                  {formatShare(
                    getSafeShare(
                      blastRadius.summary.defectCost,
                      blastRadius.summary.totalCost,
                    ),
                  )}
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                  Quality cost still tied to internal defect findings.
                </p>
              </div>
              <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-4">
                <div className="eyebrow">Claim-driven</div>
                <div className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                  {formatClaimShare(blastRadius.summary.claimShare)}
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                  Customer-facing share of the total observed pain.
                </p>
              </div>
              <div className="rounded-[20px] bg-[color:var(--surface-low)] px-4 py-4">
                <div className="eyebrow">Rework-driven</div>
                <div className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                  {formatShare(
                    getSafeShare(
                      blastRadius.summary.reworkCost,
                      blastRadius.summary.totalCost,
                    ),
                  )}
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                  Operational drag still being absorbed internally.
                </p>
              </div>
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
