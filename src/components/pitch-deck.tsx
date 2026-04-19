"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  ChartNoAxesColumn,
  LoaderCircle,
  Printer,
  Target,
  Waypoints,
  Workflow,
} from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import styles from "./pitch-deck.module.css";

type SlideJump = {
  id: string;
  label: string;
};

const slideJumps: SlideJump[] = [
  { id: "hook", label: "Hook" },
  { id: "pain", label: "Problem" },
  { id: "gap", label: "Gap" },
  { id: "solution", label: "Solution" },
  { id: "clustering", label: "Trust" },
  { id: "flow", label: "User flow" },
  { id: "agent", label: "AI agent" },
  { id: "difference", label: "Why Tracis" },
  { id: "impact", label: "Impact" },
];

function SlideHeader({
  eyebrow,
  title,
  number,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  number: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="max-w-4xl">
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="mt-3 font-heading text-[clamp(2.8rem,4vw,4.5rem)] leading-[0.94] font-semibold tracking-[-0.06em] text-foreground">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--muted-foreground)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className={styles.slideNumber}>{number}</div>
    </div>
  );
}

function Punchline({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-l-[3px] border-[var(--primary)] pl-5 text-[1.15rem] leading-8 font-medium tracking-[-0.02em] text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

function StatementList({
  items,
  className,
}: {
  items: string[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)}>
      {items.map((item, index) => (
        <div key={item} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-4">
          <div className="border border-[color:rgba(20,32,42,0.12)] bg-white/72 px-3 py-2 text-center font-mono text-xs tracking-[0.18em] text-[var(--muted-foreground)]">
            {String(index + 1).padStart(2, "0")}
          </div>
          <p className="pt-1 text-[1.08rem] leading-8 text-foreground">{item}</p>
        </div>
      ))}
    </div>
  );
}

function DataPanel({
  eyebrow,
  title,
  detail,
  className,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "border border-[color:rgba(20,32,42,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(246,249,251,0.98))] p-5 shadow-[0_18px_36px_rgba(20,32,42,0.05)]",
        className,
      )}
    >
      <div className="eyebrow">{eyebrow}</div>
      <h3 className="mt-3 text-[1.35rem] leading-tight font-semibold tracking-[-0.04em] text-foreground">
        {title}
      </h3>
      <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">{detail}</p>
    </article>
  );
}

function MockHeroScene({ className }: { className?: string }) {
  return (
    <div className={cn(styles.mockFrame, "grid gap-4 p-5", className)}>
      <div className="flex items-center justify-between border-b border-[color:rgba(20,32,42,0.08)] pb-3">
        <div>
          <div className="lab-stamp">Global intelligence</div>
          <div className="mt-1 text-base font-semibold tracking-[-0.03em] text-foreground">
            Ranked cases
          </div>
        </div>
        <div className="border border-[color:rgba(0,92,151,0.14)] bg-[color:rgba(0,92,151,0.08)] px-3 py-2 text-[var(--primary)]">
          <ChartNoAxesColumn className="size-4" />
        </div>
      </div>

      <div className="grid gap-4">
        <div className="border border-[color:rgba(20,32,42,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(249,251,252,0.98))] p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="max-w-[18rem]">
              <div className="lab-stamp">Top ranked case</div>
              <div className="mt-3 text-[1.45rem] leading-[1.08] font-semibold tracking-[-0.04em] text-foreground">
                Thermal drift on controller boards
              </div>
              <div className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                ART-00001 · 15 products · strongest live signal
              </div>
            </div>

            <div className="min-w-[104px] border-l border-[color:rgba(20,32,42,0.08)] pl-4">
              <div className="lab-stamp">Confidence</div>
              <div className="mt-3 text-[2rem] leading-none font-semibold tracking-[-0.05em] text-foreground">
                87%
              </div>
              <div className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                field-led failure
              </div>
            </div>
          </div>

          <div className="mt-5 border-t border-[color:rgba(20,32,42,0.08)] pt-4">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["Support", "claim-only thread"],
                ["Anchor", "BOM position R33"],
                ["Impact", "field-heavy blast radius"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="border border-[color:rgba(20,32,42,0.08)] bg-white/82 px-3 py-3"
                >
                  <div className="lab-stamp">{label}</div>
                  <div className="mt-2 text-sm leading-6 text-foreground">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_148px]">
          <div className="border border-[color:rgba(20,32,42,0.08)] bg-white/82 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="lab-stamp">Tracis Copilot</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  Recommended next step
                </div>
              </div>
              <Bot className="size-4 text-[var(--primary)]" />
            </div>
            <p className="mt-3 max-w-[22rem] text-xs leading-6 text-[var(--muted-foreground)]">
              Compare the repeated R33 pattern, request one decisive endurance
              test, then draft containment for approval.
            </p>
          </div>

          <div className="border border-[color:rgba(0,92,151,0.14)] bg-[linear-gradient(180deg,rgba(242,248,252,0.98),rgba(255,255,255,0.98))] p-4">
            <div className="lab-stamp">Queue</div>
            <div className="mt-3 space-y-2 text-xs leading-5 text-foreground">
              <div>1. Thermal drift</div>
              <div>2. Cold solder batch</div>
              <div>3. Handling cluster</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SplitLabelColumn({
  leftLabel,
  rightLabel,
  leftItems,
  rightItems,
}: {
  leftLabel: string;
  rightLabel: string;
  leftItems: string[];
  rightItems: string[];
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="border border-[color:rgba(20,32,42,0.08)] bg-white/78 p-6">
        <div className="lab-stamp">{leftLabel}</div>
        <div className="mt-5 space-y-4">
          {leftItems.map((item) => (
            <p key={item} className="text-[1.02rem] leading-7 text-foreground">
              {item}
            </p>
          ))}
        </div>
      </div>
      <div className="border border-[color:rgba(0,92,151,0.14)] bg-[linear-gradient(180deg,rgba(242,248,252,0.96),rgba(255,255,255,0.98))] p-6">
        <div className="lab-stamp">{rightLabel}</div>
        <div className="mt-5 space-y-4">
          {rightItems.map((item) => (
            <p key={item} className="text-[1.02rem] leading-7 text-foreground">
              {item}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function BeforeAfterPanel({
  title,
  beforeItems,
  afterItems,
}: {
  title: string;
  beforeItems: string[];
  afterItems: string[];
}) {
  return (
    <article className="border border-[color:rgba(20,32,42,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,248,250,0.98))] p-5">
      <div className="eyebrow">{title}</div>
      <div className="mt-5 grid gap-4">
        <div className="border border-[color:rgba(20,32,42,0.08)] bg-white/80 p-4">
          <div className="lab-stamp">Before</div>
          <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
            {beforeItems.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        </div>
        <div className="border border-[color:rgba(0,92,151,0.14)] bg-[linear-gradient(180deg,rgba(242,248,252,0.96),rgba(255,255,255,0.98))] p-4">
          <div className="lab-stamp">After</div>
          <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
            {afterItems.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function ProductStep({
  step,
  title,
  detail,
  icon: Icon,
}: {
  step: string;
  title: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <article className="relative border border-[color:rgba(20,32,42,0.08)] bg-white/78 p-6 shadow-[0_20px_38px_rgba(20,32,42,0.05)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="lab-stamp">{step}</div>
          <h3 className="mt-3 text-[1.4rem] leading-tight font-semibold tracking-[-0.04em] text-foreground">
            {title}
          </h3>
        </div>
        <div className="border border-[color:rgba(0,92,151,0.16)] bg-[color:rgba(0,92,151,0.08)] p-3 text-[var(--primary)]">
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-6 text-[1.02rem] leading-7 text-[var(--muted-foreground)]">{detail}</p>
    </article>
  );
}

function StageCard({
  stage,
  title,
  detail,
  output,
}: {
  stage: string;
  title: string;
  detail: string;
  output: string;
}) {
  return (
    <article className="relative border border-[color:rgba(20,32,42,0.08)] bg-white/78 p-6 shadow-[0_20px_38px_rgba(20,32,42,0.05)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="lab-stamp">{stage}</div>
          <h3 className="mt-3 text-[1.4rem] leading-tight font-semibold tracking-[-0.04em] text-foreground">
            {title}
          </h3>
        </div>
        <div className="border border-[color:rgba(20,32,42,0.1)] bg-white/72 px-3 py-2 font-mono text-xs tracking-[0.16em] text-[var(--muted-foreground)]">
          {stage}
        </div>
      </div>
      <p className="mt-5 text-sm leading-7 text-[var(--muted-foreground)]">{detail}</p>
      <div className="mt-6 border-t border-[color:rgba(20,32,42,0.08)] pt-4">
        <div className="eyebrow">Output</div>
        <p className="mt-2 text-sm leading-7 text-foreground">{output}</p>
      </div>
    </article>
  );
}

function DifferenceCard({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <article className="border border-[color:rgba(20,32,42,0.08)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,248,250,0.98))] p-5">
      <h3 className="text-[1.2rem] leading-tight font-semibold tracking-[-0.04em] text-foreground">
        {title}
      </h3>
      <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">{detail}</p>
    </article>
  );
}

function ImpactMetric({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <div className="border border-[color:rgba(20,32,42,0.08)] bg-white/76 px-5 py-6">
      <div className="text-[1.6rem] leading-none font-semibold tracking-[-0.05em] text-foreground">
        {value}
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">{label}</p>
    </div>
  );
}

export function PitchDeck() {
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  useEffect(() => {
    document.body.dataset.pitchMode = "true";
    const fixedElements = Array.from(document.querySelectorAll<HTMLElement>(".fixed"));
    const previousDisplays = fixedElements.map((element) => element.style.display);

    fixedElements.forEach((element) => {
      element.style.display = "none";
    });

    return () => {
      fixedElements.forEach((element, index) => {
        element.style.display = previousDisplays[index] ?? "";
      });
      delete document.body.dataset.pitchMode;
    };
  }, []);

  async function handleExportPdf() {
    try {
      setIsExportingPdf(true);

      if ("fonts" in document) {
        await document.fonts.ready;
      }

      const [{ toPng }, { jsPDF }] = await Promise.all([
        import("html-to-image"),
        import("jspdf"),
      ]);

      const slideNodes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-pitch-slide]"),
      );

      if (!slideNodes.length) {
        throw new Error("No slides found to export.");
      }

      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "px",
        format: [1600, 900],
        compress: true,
      });

      for (const [index, node] of slideNodes.entries()) {
        const imageData = await toPng(node, {
          cacheBust: true,
          pixelRatio: 2,
          backgroundColor: "#f8f9fa",
          canvasWidth: 1600,
          canvasHeight: 900,
        });

        if (index > 0) {
          pdf.addPage([1600, 900], "landscape");
        }

        pdf.addImage(imageData, "PNG", 0, 0, 1600, 900, undefined, "FAST");
      }

      pdf.save("tracis-pitch-deck.pdf");
    } catch (error) {
      console.error("Failed to export pitch deck PDF.", error);
      window.alert("PDF export failed. Please retry, or use Browser print as a fallback.");
    } finally {
      setIsExportingPdf(false);
    }
  }

  return (
    <main data-pitch-page className={styles.page}>
      <div className={styles.toolbar}>
        <div className="mx-auto flex max-w-[1560px] flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="lab-stamp">Tracis pitch deck</div>
            <p className={styles.screenNote}>
              Use <strong>Download PDF</strong> for a clean zero-margin export with one slide per page.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {slideJumps.map((jump) => (
              <a
                key={jump.id}
                href={`#${jump.id}`}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "border border-[color:rgba(20,32,42,0.08)] px-3 normal-case tracking-normal text-foreground",
                )}
              >
                {jump.label}
              </a>
            ))}
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={isExportingPdf}
              className={buttonVariants({ size: "sm" })}
            >
              {isExportingPdf ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Printer className="size-4" />
              )}
              {isExportingPdf ? "Exporting PDF" : "Download PDF"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Browser print
            </button>
            <Link
              href="/articles"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open product
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>

      <div className={styles.deck}>
        <section id="hook" data-pitch-slide className={cn(styles.slide, styles.heroSlide)}>
          <div className={styles.slideContent}>
            <div className="grid h-full content-start gap-8 xl:grid-cols-[minmax(0,1.06fr)_420px]">
              <div className="flex flex-col gap-8">
                <div>
                  <div className="eyebrow">Tracis</div>
                  <div className="mt-8 text-[clamp(4.5rem,8vw,8rem)] leading-[0.85] font-semibold tracking-[-0.08em] text-foreground">
                    Tracis
                  </div>
                  <h1 className="mt-6 max-w-5xl font-heading text-[clamp(2.7rem,4.8vw,5.2rem)] leading-[0.92] font-semibold tracking-[-0.07em] text-foreground">
                    From Excel Graveyard
                    <br />
                    to Quality Copilot
                  </h1>
                  <p className="mt-8 max-w-4xl text-[1.25rem] leading-9 text-[var(--muted-foreground)]">
                    When a defect hits, the truth is scattered across claims,
                    tests, parts, and spreadsheets. Tracis turns that chaos into
                    one investigation workflow.
                  </p>
                </div>

                <Punchline className="max-w-3xl">
                  Factories don&apos;t have a reporting problem. They have a
                  signal-to-action problem.
                </Punchline>
              </div>

              <div className="grid content-start gap-4">
                <MockHeroScene className="min-h-[18rem]" />
                <DataPanel
                  eyebrow="Core differentiator"
                  title="Ranked cases to controlled action"
                  detail="Tracis structures raw manufacturing evidence into ranked cases before AI ever drafts the next step."
                />
              </div>
            </div>
          </div>
        </section>

        <section id="pain" data-pitch-slide className={cn(styles.slide, "spec-grid")}>
          <div className={styles.slideContent}>
            <SlideHeader
              eyebrow="The pain"
              title="Quality teams have a method. They still lack the workflow."
              number="02"
            />

            <div className="mt-10 grid gap-8 xl:grid-cols-2">
              <div className="flex flex-col gap-5">
                <div className="border border-[color:rgba(0,92,151,0.1)] bg-[linear-gradient(160deg,rgba(240,247,251,0.96),rgba(255,255,255,0.98))] px-8 py-10">
                  <div className="lab-stamp">Core tension</div>
                  <div className="mt-6 max-w-2xl text-[2.2rem] leading-[1.02] font-semibold tracking-[-0.05em] text-foreground">
                    8D gives teams a method.
                    <br />
                    The evidence still lives in disconnected systems.
                  </div>
                </div>

                <div className="border border-[color:rgba(20,32,42,0.08)] bg-white/80 px-8 py-7">
                  <div className="lab-stamp">What breaks</div>
                  <p className="mt-4 max-w-2xl text-[1.02rem] leading-7 text-[var(--muted-foreground)]">
                    Claims, tests, parts, workflow notes, and spreadsheets each
                    hold part of the answer, so teams rebuild the same context
                    again and again before they can act.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-5">
                <div className="border border-[color:rgba(20,32,42,0.08)] bg-white/78 px-8 py-8">
                  <div className="lab-stamp">What this means in practice</div>
                  <StatementList
                    className="mt-6"
                    items={[
                      "8D gives teams a method.",
                      "But the evidence lives across disconnected systems.",
                      "So root-cause work becomes slow, manual, and repetitive.",
                    ]}
                  />
                </div>

                <div className="border border-[color:rgba(0,92,151,0.12)] bg-[linear-gradient(180deg,rgba(242,248,252,0.96),rgba(255,255,255,0.98))] px-8 py-7">
                  <div className="lab-stamp">Bottom line</div>
                  <Punchline className="mt-4 max-w-none">
                    The method exists. The workflow doesn&apos;t.
                  </Punchline>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="gap" data-pitch-slide className={cn(styles.slide, "spec-grid")}>
          <div className={styles.slideContent}>
            <SlideHeader
              eyebrow="The gap"
              title="Dashboards show symptoms. Documents track actions. Nobody closes the loop."
              number="03"
            />

            <div className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1.18fr)_320px]">
              <div className="flex flex-col gap-8">
                <SplitLabelColumn
                  leftLabel="Today"
                  rightLabel="Missing"
                  leftItems={[
                    "Dashboards show defects",
                    "CAPA tools track tasks",
                    "AI tools generate text",
                  ]}
                  rightItems={[
                    "Ranked cases",
                    "Competing explanations",
                    "Business impact",
                    "Controlled next actions",
                  ]}
                />

                <Punchline className="max-w-3xl">
                  The gap isn&apos;t another chatbot. It&apos;s an investigation
                  workflow.
                </Punchline>
              </div>

              <BeforeAfterPanel
                title="Before vs after"
                beforeItems={[
                  "Defects, claims, tests, BOMs, reports, spreadsheets",
                  "Teams reconstruct the story by hand",
                ]}
                afterItems={[
                  "Ranked case",
                  "Evidence review",
                  "Confirmed action",
                ]}
              />
            </div>
          </div>
        </section>

        <section id="solution" data-pitch-slide className={cn(styles.slide, "spec-grid")}>
          <div className={styles.slideContent}>
            <SlideHeader
              eyebrow="The solution"
              title="Tracis creates ranked investigations, not just reports"
              number="04"
            />

            <div className="mt-10 flex flex-col gap-6">
              <div className="border border-[color:rgba(20,32,42,0.08)] bg-white/78 px-8 py-10">
                <div className="lab-stamp">Starting point</div>
                <div className="mt-5 max-w-3xl text-[2.2rem] leading-[1.02] font-semibold tracking-[-0.05em] text-foreground">
                  Tracis starts with ranked cases, not raw tables.
                </div>
                <div className="mt-10">
                  <StatementList
                    items={[
                      "See the strongest issue first.",
                      "Compare explanations with evidence.",
                      "Turn the best explanation into action.",
                    ]}
                  />
                </div>
                <div className="mt-10 border-t border-[color:rgba(20,32,42,0.08)] pt-6">
                  <div className="lab-stamp">Human control</div>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--muted-foreground)]">
                    AI helps throughout the flow. Humans approve before anything
                    is written back.
                  </p>
                </div>
              </div>

              <div className="border border-[color:rgba(0,92,151,0.12)] bg-[linear-gradient(180deg,rgba(242,248,252,0.96),rgba(255,255,255,0.98))] px-8 py-7">
                <div className="lab-stamp">Decision rule</div>
                <Punchline className="mt-4 max-w-none">
                  AI can recommend. Humans decide.
                </Punchline>
              </div>
            </div>
          </div>
        </section>

        <section id="clustering" data-pitch-slide className={cn(styles.slide, "spec-grid")}>
          <div className={styles.slideContent}>
            <SlideHeader
              eyebrow="Why it works"
              title="Why the workflow is trustworthy"
              number="05"
              subtitle="AI works on shaped evidence, not raw noise."
            />

            <div className="mt-10 flex flex-col gap-8">
              <div className="grid gap-5 xl:grid-cols-3">
                <StageCard
                  stage="01"
                  title="Structure product evidence"
                  detail="We connect defects, claims, tests, rework, and installed parts into structured product threads."
                  output="A structured evidence base."
                />
                <StageCard
                  stage="02"
                  title="Group likely cases"
                  detail="We turn those threads into likely investigations so operators start from patterns, not from raw rows."
                  output="Ranked cases with clear anchors."
                />
                <StageCard
                  stage="03"
                  title="Escalate recurring patterns"
                  detail="We compare cases across the system so recurring issues surface and local noise stays local."
                  output="Explainable escalation."
                />
              </div>

              <Punchline className="max-w-4xl">
                We structure raw manufacturing evidence into ranked cases before
                AI ever drafts action.
              </Punchline>
            </div>
          </div>
        </section>

        <section id="flow" data-pitch-slide className={cn(styles.slide, "spec-grid")}>
          <div className={styles.slideContent}>
            <SlideHeader
              eyebrow="Operator flow"
              title="What the user actually does"
              number="06"
              subtitle="Defect comes in. Tracis ranks likely cases. The operator confirms one. The report and handoff are ready."
            />

            <div className="mt-10 flex flex-col gap-8">
              <div className="grid gap-5 xl:grid-cols-3">
                <ProductStep
                  step="1. Global Intelligence"
                  title="Open the strongest case first"
                  detail="A live queue ranks likely investigations instead of dumping the team into raw tables."
                  icon={Target}
                />
                <ProductStep
                  step="2. Case Viewer"
                  title="Compare evidence and choose the best explanation"
                  detail="Support, counterevidence, tests, traceability, and cost are visible in one place."
                  icon={Waypoints}
                />
                <ProductStep
                  step="3. Confirmed Workspace"
                  title="Generate the report and team handoff"
                  detail="The confirmed case becomes the report draft, owner suggestion, and next-action queue."
                  icon={Workflow}
                />
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <DataPanel
                  eyebrow="Tracis Copilot"
                  title="AI helps inside the workflow"
                  detail="It can summarize evidence, suggest decisive tests, and draft the next step. Humans still decide what gets confirmed or written back."
                />
                <Punchline className="self-center">
                  AI can recommend. Humans decide.
                </Punchline>
              </div>
            </div>
          </div>
        </section>

        <section id="agent" data-pitch-slide className={cn(styles.slide, "spec-grid")}>
          <div className={styles.slideContent}>
            <SlideHeader
              eyebrow="AI agent"
              title="One agent, inside the investigation workflow"
              number="07"
              subtitle="Not a freeform chatbot bolted on top. Tracis Copilot works from the ranked case, the evidence, and the confirmed explanation."
            />

            <div className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1.02fr)_360px]">
              <div className="border border-[color:rgba(20,32,42,0.08)] bg-white/78 px-8 py-10">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="lab-stamp">What the agent actually does</div>
                    <div className="mt-5 max-w-3xl text-[2.15rem] leading-[1.02] font-semibold tracking-[-0.05em] text-foreground">
                      It reads the case, proposes the next move, and drafts the handoff.
                    </div>
                  </div>
                  <div className="border border-[color:rgba(0,92,151,0.14)] bg-[color:rgba(0,92,151,0.08)] p-3 text-[var(--primary)]">
                    <Bot className="size-5" />
                  </div>
                </div>

                <StatementList
                  className="mt-8"
                  items={[
                    "Pulls live evidence from the ranked case instead of starting from a blank prompt.",
                    "Suggests decisive tests, likely next steps, and the strongest explanation to pressure-test.",
                    "Drafts the report, team handoff, and action proposal once the operator confirms the case.",
                  ]}
                />
              </div>

              <div className="grid content-start gap-5">
                <DataPanel
                  eyebrow="Why this matters"
                  title="Useful without taking over"
                  detail="The agent removes blank-page work and speeds up investigation, but it stays inside the workflow the team already trusts."
                />
                <DataPanel
                  eyebrow="Safety"
                  title="Recommendation only"
                  detail="It can recommend and draft. Humans still decide what gets confirmed, written back, or handed off."
                />
                <Punchline>
                  The agent is useful because it starts from the case, not from raw noise.
                </Punchline>
              </div>
            </div>
          </div>
        </section>

        <section id="difference" data-pitch-slide className={cn(styles.slide, "spec-grid")}>
          <div className={styles.slideContent}>
            <SlideHeader
              eyebrow="Why Tracis"
              title="Why Tracis is different"
              number="08"
            />

            <div className="mt-10 grid flex-1 gap-5 xl:grid-cols-3">
              <DifferenceCard
                title="Starts with cases, not raw data"
                detail="Most tools begin with tables, filters, or symptom dashboards. Tracis begins with ranked investigations."
              />
              <DifferenceCard
                title="Shows evidence before action"
                detail="Operators can compare explanations, anchors, tests, and impact before committing to a fix."
              />
              <DifferenceCard
                title="Keeps AI useful by keeping humans in control"
                detail="AI recommends inside the workflow, but confirmation and write-back stay with the team."
              />
            </div>

            <div className="mt-8 border border-[color:rgba(0,92,151,0.12)] bg-[linear-gradient(180deg,rgba(242,248,252,0.96),rgba(255,255,255,0.98))] px-8 py-8">
              <div className="lab-stamp">Category point</div>
              <div className="mt-4 max-w-4xl font-heading text-[2.4rem] leading-[0.98] font-semibold tracking-[-0.05em] text-foreground">
                Not a dashboard. Not a chatbot. A live investigation workflow.
              </div>
            </div>
          </div>
        </section>

        <section id="impact" data-pitch-slide className={cn(styles.slide, "spec-grid")}>
          <div className={styles.slideContent}>
            <SlideHeader
              eyebrow="Impact"
              title="What changes with Tracis"
              number="09"
            />

            <div className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1.18fr)_320px]">
              <div className="flex flex-col gap-8">
                <div className="grid gap-5 md:grid-cols-2">
                  <ImpactMetric
                    value="Less blank-page reporting"
                    label="The workflow assembles the case narrative from evidence instead of making engineers start from scratch."
                  />
                  <ImpactMetric
                    value="Faster path to root-cause discussion"
                    label="Ranked cases and competing explanations shorten the time from signal to a serious investigation."
                  />
                  <ImpactMetric
                    value="Better prioritization"
                    label="Cost and traceability show where risk concentrates so teams know what to act on first."
                  />
                  <ImpactMetric
                    value="Decisions stay in the workflow"
                    label="Evidence, decisions, and next actions stay visible instead of disappearing into static files."
                  />
                </div>

                <div className="border border-[color:rgba(20,32,42,0.08)] bg-white/78 px-8 py-8">
                  <div className="lab-stamp">Closing line</div>
                  <div className="mt-4 max-w-4xl font-heading text-[2.5rem] leading-[1] font-semibold tracking-[-0.05em] text-foreground">
                    Tracis replaces static quality reports with a live quality operating system.
                  </div>
                  <p className="mt-5 text-[1.12rem] leading-8 text-[var(--muted-foreground)]">
                    Find the signal. Prove the cause. Ship the fix.
                  </p>
                </div>
              </div>

              <div className="grid content-start gap-5">
                <DataPanel
                  eyebrow="One-sentence story"
                  title="The sharp hackathon narrative"
                  detail="Tracis turns scattered manufacturing evidence into ranked investigations, confirmed explanations, and controlled next actions."
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
