"use client";

import { LoaderCircle, NotebookText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ConfirmedCaseReportLoadingState() {
  return (
    <Card className="glass-panel ghost-border spec-grid overflow-hidden rounded-[34px] px-0 py-0">
      <CardHeader className="space-y-4 px-6 pt-6 sm:px-7">
        <Badge variant="outline" className="w-fit">
          <NotebookText className="size-3.5" />
          Confirmed report
        </Badge>
        <CardTitle className="font-heading text-3xl leading-none font-semibold tracking-[-0.03em] sm:text-4xl">
          Opening confirmed report
        </CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6 sm:px-7">
        <div className="flex items-center gap-3 rounded-[24px] border border-[color:rgba(20,32,42,0.08)] bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(243,247,250,0.92))] px-5 py-5 text-sm leading-6 text-[var(--muted-foreground)] dark:border-white/8 dark:bg-[linear-gradient(180deg,rgba(27,34,40,0.96),rgba(22,29,35,0.94))]">
          <LoaderCircle className="size-4 animate-spin" />
          Finalizing the confirmed report view.
        </div>
      </CardContent>
    </Card>
  );
}
