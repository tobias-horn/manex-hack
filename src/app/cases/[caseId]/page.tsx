import { notFound } from "next/navigation";

import { CaseViewer } from "@/components/case-viewer";
import { parseClusteringMode } from "@/lib/manex-clustering-mode";
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

  const caseData = await loadCaseViewerData({
    articleId,
    caseId,
    mode,
  });

  if (!caseData) {
    notFound();
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <CaseViewer
          mode={mode}
          viewModel={caseData.viewModel}
          selectedCaseId={caseId}
          economicBlastRadius={caseData.economicBlastRadius}
          hasPostgres={caseData.hasPostgres}
        />
      </div>
    </main>
  );
}
