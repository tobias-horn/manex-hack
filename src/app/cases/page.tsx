import { ArrowLeft, FolderGit2 } from "lucide-react";
import Link from "next/link";

import { CaseWorkbench } from "@/components/case-workbench";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { capabilities } from "@/lib/env";
import { listManexCases } from "@/lib/manex-case-state";

export const dynamic = "force-dynamic";

async function loadInitialCases() {
  if (!capabilities.hasPostgres) {
    return [];
  }

  try {
    return await listManexCases(12);
  } catch {
    return [];
  }
}

export default async function CasesPage() {
  const cases = await loadInitialCases();

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border spec-grid rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <FolderGit2 className="size-3.5" />
                Prompt 8 foundation
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                Case state layer
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                This is the first app-owned product layer on top of the Manex dataset.
                It keeps investigation state in custom tables so cases, notes, and
                hypotheses can evolve without abusing the protected seed model.
              </p>
            </div>

            <Button
              size="lg"
              variant="outline"
              render={
                <Link href="/">
                  <ArrowLeft className="size-4" />
                  Back to home
                </Link>
              }
            />
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_360px]">
          <CaseWorkbench
            initialCases={cases}
            hasConnection={capabilities.hasPostgres}
            defaultProductId="PRD-00159"
            defaultArticleId="ART-00001"
            defaultSignalId="DEF-00071"
          />

          <div className="space-y-6">
            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>Why this matters</Badge>
                <CardTitle className="section-title mt-3">
                  Clean boundary for later stages
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">App state only</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    Cases store only investigation scaffolding and links back to repo
                    entities. Seed data stays where it belongs.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Ready for notes and hypotheses</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    The tables already support evidence bookmarks and saved filters even
                    though the UI starts with the minimal case, note, and hypothesis path.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Postgres-backed today</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    The same tables are suitable for future PostgREST use, but direct
                    Postgres is the most reliable way to create and manage them now.
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
