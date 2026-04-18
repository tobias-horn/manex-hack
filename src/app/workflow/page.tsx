import { ArrowLeft, CheckSquare2 } from "lucide-react";
import Link from "next/link";

import { ActionWorkbench } from "@/components/action-workbench";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getWorkspaceSnapshot } from "@/lib/quality-workspace";

export const dynamic = "force-dynamic";

export default async function WorkflowPage() {
  const snapshot = await getWorkspaceSnapshot();

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-10 lg:py-8">
        <header className="glass-panel ghost-border spec-grid rounded-[30px] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">
                <CheckSquare2 className="size-3.5" />
                Workflow foundation
              </Badge>
              <h1 className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
                Minimal write-back layer
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
                This screen is intentionally thin. It proves the app can create and later
                update a `product_action` through the allowed workflow surface, while the
                rest of the dataset stays read-only.
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

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_340px]">
          <ActionWorkbench
            initialActions={snapshot.actions}
            initialMode={snapshot.actionMode}
            defaultProductId={snapshot.defaultActionSeed.productId}
            defaultDefectId={snapshot.defaultActionSeed.defectId}
          />

          <div className="space-y-6">
            <Card className="surface-panel rounded-[30px] px-0 py-0">
              <CardHeader className="px-6 pt-6">
                <Badge>Why this matters</Badge>
                <CardTitle className="section-title mt-3">
                  Stable enough for later stages
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5">
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Allowed write targets only</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    The workflow path is restricted to `product_action` today, with the
                    existing `rework` write helper left available for later flows.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Immediate reflection</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    The UI uses the returned row from the API so new actions and status
                    changes appear instantly after persistence.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                  <div className="eyebrow">Clear failure handling</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    Validation and transport failures are surfaced directly instead of being
                    hidden behind optimistic UI.
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
