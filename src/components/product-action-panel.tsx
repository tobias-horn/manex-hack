"use client";

import { LoaderCircle, Workflow } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Initiative } from "@/lib/quality-workspace";

type ProductActionPanelProps = {
  initialActions: Initiative[];
  defaultProductId: string;
  defaultDefectId: string;
};

type ActionResponse = {
  ok?: boolean;
  action?: Initiative;
  mode?: "live" | "demo";
  error?: string;
};

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

const statusTone: Record<string, string> = {
  open: "bg-[color:rgba(20,32,42,0.08)] text-foreground",
  in_progress: "bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]",
  blocked: "bg-[color:rgba(178,69,63,0.1)] text-[var(--destructive)]",
  done: "bg-[color:rgba(45,123,98,0.12)] text-emerald-700",
};

export function ProductActionPanel({
  initialActions,
  defaultProductId,
  defaultDefectId,
}: ProductActionPanelProps) {
  const [actions, setActions] = useState(initialActions);
  const [runtimeMode, setRuntimeMode] = useState<"live" | "demo">("live");
  const [defectId, setDefectId] = useState(defaultDefectId);
  const [actionType, setActionType] = useState("supplier_containment");
  const [status, setStatus] = useState("open");
  const [comments, setComments] = useState(
    "Contain the signal, attach traceability evidence, and assign an owner for the next verification step.",
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(
    () => Boolean(actionType.trim() && status.trim() && comments.trim()),
    [actionType, comments, status],
  );

  async function submitAction() {
    setFeedback(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId: defaultProductId,
          defectId: defectId.trim() || undefined,
          actionType,
          status,
          comments,
        }),
      });

      const payload = (await response.json()) as ActionResponse;

      if (!response.ok || !payload.action) {
        setFeedback({
          tone: "error",
          text: payload.error ?? "Could not create the action.",
        });
        return;
      }

      setActions((current) => [payload.action!, ...current].slice(0, 8));
      setRuntimeMode(payload.mode ?? "live");
      setComments(
        "Action persisted. Add the owner handoff, supplier evidence packet, and verification exit criteria here.",
      );
      setFeedback({
        tone: "success",
        text:
          payload.mode === "live"
            ? `${payload.action.id} persisted for ${defaultProductId}.`
            : "Action created in demo mode.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="surface-panel rounded-[30px] px-0 py-0">
      <CardHeader className="px-6 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Closed loop</div>
            <CardTitle className="section-title mt-1">Action lane</CardTitle>
            <CardDescription className="mt-2 leading-6">
              Turn what you see in this dossier into one persisted workflow step
              without leaving the screen.
            </CardDescription>
          </div>
          <div className="flex size-12 items-center justify-center rounded-full bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]">
            <Workflow className="size-5" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{runtimeMode === "live" ? "Live workflow" : "Demo mode"}</Badge>
          <Badge variant="outline">{defaultProductId}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-5 pb-5">
        <Input value={defaultProductId} disabled />

        <Input
          value={defectId}
          onChange={(event) => setDefectId(event.target.value)}
          placeholder="DEF-00071"
        />

        <select
          className="select-field h-11 rounded-[1rem] px-3.5 text-sm text-foreground outline-none"
          value={actionType}
          onChange={(event) => setActionType(event.target.value)}
        >
          <option value="supplier_containment">supplier_containment</option>
          <option value="initiate_8d">initiate_8d</option>
          <option value="corrective">corrective</option>
          <option value="verify_fix">verify_fix</option>
        </select>

        <select
          className="select-field h-11 rounded-[1rem] px-3.5 text-sm text-foreground outline-none"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="open">open</option>
          <option value="in_progress">in_progress</option>
          <option value="blocked">blocked</option>
          <option value="done">done</option>
        </select>

        <Textarea
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          placeholder="Describe the next containment or verification move."
        />

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            size="lg"
            onClick={() => void submitAction()}
            disabled={isSubmitting || !canSubmit}
          >
            {isSubmitting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Creating action
              </>
            ) : (
              "Create action"
            )}
          </Button>
          <Button
            variant="outline"
            render={<Link href="/workflow">Open workflow board</Link>}
          />
        </div>

        {feedback ? (
          <div
            className={
              feedback.tone === "success"
                ? "rounded-[20px] bg-[color:rgba(45,123,98,0.12)] px-4 py-3 text-sm text-emerald-700"
                : "rounded-[20px] bg-[color:rgba(178,69,63,0.12)] px-4 py-3 text-sm text-[var(--destructive)]"
            }
          >
            {feedback.text}
          </div>
        ) : null}

        <div className="space-y-3">
          {actions.length ? (
            actions.map((action) => (
              <article
                key={action.id}
                className="rounded-[22px] border border-white/10 bg-black/8 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={statusTone[action.status] ?? statusTone.open}>
                    {action.status}
                  </Badge>
                  <Badge variant="outline">{action.actionType}</Badge>
                  {action.defectId ? (
                    <Badge variant="outline">{action.defectId}</Badge>
                  ) : null}
                </div>
                <div className="mt-3 text-sm leading-6">{action.comments}</div>
                <div className="mt-3 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                  {action.id} · {action.timestamp}
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-[22px] border border-white/10 bg-black/8 px-4 py-4 text-sm text-[var(--muted-foreground)]">
              No actions have been logged for this product yet.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
