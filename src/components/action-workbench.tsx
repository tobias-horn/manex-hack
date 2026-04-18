"use client";

import { useMemo, useState } from "react";
import { LoaderCircle, Workflow } from "lucide-react";

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
import type { DataMode, Initiative } from "@/lib/quality-workspace";

type ActionWorkbenchProps = {
  initialActions: Initiative[];
  initialMode: DataMode;
  defaultProductId: string;
  defaultDefectId: string;
};

type ActionResponse = {
  ok?: boolean;
  action?: Initiative;
  mode?: DataMode;
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

export function ActionWorkbench({
  initialActions,
  initialMode,
  defaultProductId,
  defaultDefectId,
}: ActionWorkbenchProps) {
  const [actions, setActions] = useState(initialActions);
  const [runtimeMode, setRuntimeMode] = useState<DataMode>(initialMode);
  const [productId, setProductId] = useState(defaultProductId);
  const [defectId, setDefectId] = useState(defaultDefectId);
  const [actionType, setActionType] = useState("supplier_containment");
  const [status, setStatus] = useState("open");
  const [comments, setComments] = useState(
    "Quarantine the suspect batch, review near-miss ESR measurements, and assign an owner for supplier follow-up.",
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [draftStatuses, setDraftStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialActions.map((action) => [action.id, action.status])),
  );

  const canSubmit = useMemo(
    () =>
      Boolean(
        productId.trim() &&
          actionType.trim() &&
          status.trim() &&
          comments.trim(),
      ),
    [actionType, comments, productId, status],
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
          productId,
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

      setActions((current) => [payload.action!, ...current].slice(0, 6));
      setDraftStatuses((current) => ({
        [payload.action!.id]: payload.action!.status,
        ...current,
      }));
      setRuntimeMode(payload.mode ?? initialMode);
      setComments(
        "Containment queued. Add supplier evidence review, owner handoff, and verification checkpoints here.",
      );
      setFeedback({
        tone: "success",
        text:
          payload.mode === "live"
            ? `Action ${payload.action.id} persisted to product_action.`
            : "Demo action added locally. Add dataset credentials to persist writes.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateActionStatus(action: Initiative) {
    const nextStatus = draftStatuses[action.id] ?? action.status;

    if (nextStatus === action.status) {
      setFeedback({
        tone: "success",
        text: `${action.id} is already ${action.status}.`,
      });
      return;
    }

    setFeedback(null);
    setPendingActionId(action.id);

    try {
      const response = await fetch("/api/actions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          actionId: action.id,
          status: nextStatus,
        }),
      });

      const payload = (await response.json()) as ActionResponse;

      if (!response.ok || !payload.action) {
        setFeedback({
          tone: "error",
          text: payload.error ?? `Could not update ${action.id}.`,
        });
        return;
      }

      setActions((current) =>
        current.map((entry) => (entry.id === payload.action!.id ? payload.action! : entry)),
      );
      setDraftStatuses((current) => ({
        ...current,
        [payload.action!.id]: payload.action!.status,
      }));
      setFeedback({
        tone: "success",
        text: `${payload.action.id} moved to ${payload.action.status}.`,
      });
    } finally {
      setPendingActionId(null);
    }
  }

  return (
    <Card id="actions" className="surface-sheet rounded-[30px] px-0 py-0">
      <CardHeader className="px-6 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Closed loop</div>
            <CardTitle className="section-title mt-1">
              Action workbench
            </CardTitle>
            <CardDescription className="mt-2 leading-6">
              Create one action, then move it through status updates without leaving the
              app. This is the thin write-back layer for later workflow stages.
            </CardDescription>
          </div>
          <div className="flex size-12 items-center justify-center rounded-full bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]">
            <Workflow className="size-5" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{runtimeMode === "live" ? "Live workflow" : "Demo mode"}</Badge>
          <Badge variant="outline">workflow log</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 px-5 pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            placeholder="PRD-00042"
          />
          <Input
            value={defectId}
            onChange={(event) => setDefectId(event.target.value)}
            placeholder="DEF-00007"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>

        <Textarea
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          placeholder="Describe the containment or verification step."
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs leading-5 text-[var(--muted-foreground)]">
            Writes stay scoped to the allowed workflow tables so later stages can build
            on this without touching protected seed data.
          </p>
          <Button
            type="button"
            size="lg"
            onClick={() => void submitAction()}
            disabled={isSubmitting || !canSubmit}
          >
            {isSubmitting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Saving
              </>
            ) : (
              "Create action"
            )}
          </Button>
        </div>

        {feedback ? (
          <div
            className={
              feedback.tone === "success"
                ? "rounded-[20px] bg-[color:rgba(45,123,98,0.12)] px-4 py-3 text-sm text-emerald-800"
                : "rounded-[20px] bg-[color:rgba(178,69,63,0.12)] px-4 py-3 text-sm text-[var(--destructive)]"
            }
          >
            {feedback.text}
          </div>
        ) : null}

        <div className="space-y-3">
          {actions.map((action) => (
            <article
              key={action.id}
              className="rounded-[24px] bg-[color:var(--surface-low)] px-4 py-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-[var(--muted-foreground)]">
                      {action.id}
                    </span>
                    <Badge variant="outline">{action.actionType}</Badge>
                    <Badge
                      className={statusTone[action.status] ?? statusTone.open}
                    >
                      {action.status}
                    </Badge>
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    {action.productId}
                    {action.defectId ? ` · ${action.defectId}` : ""}
                  </div>
                  <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                    {action.comments}
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="rounded-[18px] bg-[color:var(--surface-lowest)] px-3 py-3 text-right">
                    <div className="lab-stamp">Captured</div>
                    <div className="mt-2 font-mono text-xs text-foreground">
                      {action.timestamp}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:min-w-[180px]">
                    <select
                      className="select-field h-10 rounded-[0.95rem] px-3 text-sm text-foreground outline-none"
                      value={draftStatuses[action.id] ?? action.status}
                      onChange={(event) =>
                        setDraftStatuses((current) => ({
                          ...current,
                          [action.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="open">open</option>
                      <option value="in_progress">in_progress</option>
                      <option value="blocked">blocked</option>
                      <option value="done">done</option>
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void updateActionStatus(action)}
                      disabled={
                        pendingActionId === action.id ||
                        (draftStatuses[action.id] ?? action.status) === action.status
                      }
                    >
                      {pendingActionId === action.id ? (
                        <>
                          <LoaderCircle className="size-4 animate-spin" />
                          Updating
                        </>
                      ) : (
                        "Update status"
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
