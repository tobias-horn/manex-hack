import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CaseViewer } from "@/components/case-viewer";
import { ClusteringPipelineToggle } from "@/components/clustering-pipeline-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildCaseViewerHref,
  buildClusteringModeHref,
  parseClusteringMode,
} from "@/lib/manex-clustering-mode";
import { loadCaseViewerData } from "@/lib/manex-case-viewer";

export const dynamic = "force-dynamic";

type CaseViewerPageProps = {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CaseViewerPage({
  params,
  searchParams,
}: CaseViewerPageProps) {
  const { caseId } = await params;
  const search = await searchParams;
  const articleId = normalizeQueryValue(search.article);
  const mode = parseClusteringMode(search.pipeline);

  if (!articleId) {
    notFound();
  }

  const caseData = await loadCaseViewerData({
    articleId,
    caseId,
    mode,
  });

  if (!caseData) {
    notFound();
  }

  const toggleItems = [
    {
      mode: "current" as const,
      label: "Classic three-layer clustering",
      description: "Original dossier, article-case, and global reconciliation flow.",
      href: buildCaseViewerHref(caseId, articleId, "current"),
    },
    {
      mode: "deterministic" as const,
      label: "Deterministic issue grouping",
      description: "Small per-product issue extraction with deterministic article grouping.",
      href: buildCaseViewerHref(caseId, articleId, "deterministic"),
    },
    {
      mode: "hypothesis" as const,
      label: "Case hypothesis engine",
      description:
        "Mechanism-family analyzers rank supplier, process, design, handling, and noise investigations before AI writes the case narrative.",
      href: buildCaseViewerHref(caseId, articleId, "hypothesis"),
    },
    {
      mode: "investigate" as const,
      label: "Statistical anomaly RCA",
      description:
        "Direct SQL sweeps plus OpenAI root-cause narration without the clustered case pipeline.",
      href: buildCaseViewerHref(caseId, articleId, "investigate"),
    },
    {
      mode: "dummy" as const,
      label: "Seeded dummy run",
      description:
        "Read-only completed run populated with the four published challenge stories so UI work can continue immediately.",
      href: buildCaseViewerHref(caseId, articleId, "dummy"),
    },
  ];
  const pipelineLabel =
    mode === "deterministic"
      ? "Deterministic issue-grouping pipeline"
      : mode === "hypothesis"
        ? "Case hypothesis engine"
        : mode === "investigate"
          ? "Statistical anomaly RCA"
          : mode === "dummy"
            ? "Seeded challenge dummy mode"
            : "Classic three-layer pipeline";

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border spec-grid overflow-hidden rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <Sparkles className="size-3.5" />
                Case intelligence
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                {caseData.selectedCase.title}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                One case at a time. Pressure-test the working explanation, then open the structured evidence only when you need it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{caseData.viewModel.articleId}</Badge>
                {caseData.viewModel.articleName ? (
                  <Badge variant="outline">{caseData.viewModel.articleName}</Badge>
                ) : null}
                <Badge variant="outline">{pipelineLabel}</Badge>
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
              <Button size="lg" variant="outline" render={<Link href="/">Back to inbox</Link>} />
            </div>
          </div>
        </header>

        <ClusteringPipelineToggle currentMode={mode} items={toggleItems} />

        <CaseViewer
          mode={mode}
          viewModel={caseData.viewModel}
          selectedCaseId={caseId}
          hasPostgres={caseData.hasPostgres}
        />
      </div>
    </main>
  );
}
