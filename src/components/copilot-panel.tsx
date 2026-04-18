"use client";

import { useState, useTransition } from "react";
import { Bot, LoaderCircle, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type CopilotPanelProps = {
  aiMode: "live" | "demo";
  model: string;
  defaultPrompt: string;
};

const quickPrompts = [
  "Draft an 8D opening statement for the supplier batch incident.",
  "Summarize the strongest evidence across the four quality stories.",
  "Turn the current workspace into a containment plan for operations.",
];

export function CopilotPanel({
  aiMode,
  model,
  defaultPrompt,
}: CopilotPanelProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [answer, setAnswer] = useState(
    "Ask for a draft memo, hypothesis summary, or action plan. Responses stay grounded in the live workspace snapshot when keys are present, and otherwise use the documented Manex stories as a fallback context.",
  );
  const [runtimeMode, setRuntimeMode] = useState<"live" | "demo">(aiMode);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function runPrompt(nextPrompt: string) {
    setError(null);

    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: nextPrompt }),
      });

      const payload = (await response.json()) as {
        text?: string;
        mode?: "live" | "demo";
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Copilot request failed.");
      }

      startTransition(() => {
        setAnswer(payload.text ?? "No response was returned.");
        setRuntimeMode(payload.mode ?? aiMode);
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Copilot request failed.",
      );
    }
  }

  return (
    <Card
      id="copilot"
      className="surface-sheet glass-panel ghost-border rounded-[30px] px-0 py-0"
    >
      <CardHeader className="px-6 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Copilot layer</div>
            <CardTitle className="section-title mt-1">
              AI drafting console
            </CardTitle>
            <CardDescription className="mt-2 leading-6">
              This is the LLM surface for quick executive summaries, 8D
              openings, and containment notes.
            </CardDescription>
          </div>
          <div className="flex size-12 items-center justify-center rounded-full bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]">
            <Bot className="size-5" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{runtimeMode === "live" ? "Live model" : "Demo fallback"}</Badge>
          <Badge variant="outline">{model}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-5 pb-5">
        <div className="rounded-[24px] bg-[color:rgba(255,255,255,0.3)] p-4">
          <div className="eyebrow">Quick prompts</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {quickPrompts.map((quickPrompt) => (
              <button
                key={quickPrompt}
                type="button"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                onClick={() => {
                  setPrompt(quickPrompt);
                  void runPrompt(quickPrompt);
                }}
              >
                <Sparkles className="size-3.5" />
                {quickPrompt}
              </button>
            ))}
          </div>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void runPrompt(prompt);
          }}
        >
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask for a supplier incident brief, a root-cause memo, or a draft action list."
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs leading-5 text-[var(--muted-foreground)]">
              The response is grounded in the current workspace snapshot and
              biased toward concise, evidence-led writing.
            </p>
            <Button type="submit" size="lg" disabled={isPending || !prompt.trim()}>
              {isPending ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Drafting
                </>
              ) : (
                "Run copilot"
              )}
            </Button>
          </div>
        </form>

        <div className="rounded-[24px] bg-[color:var(--inverse-surface)] px-4 py-4 text-[var(--inverse-on-surface)]">
          <div className="flex items-center justify-between gap-3">
            <div className="eyebrow !text-[color:rgba(237,243,247,0.68)]">
              Output
            </div>
            <span className="lab-stamp !text-[color:rgba(237,243,247,0.72)]">
              {runtimeMode === "live" ? "AI live" : "AI demo"}
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
            {answer}
          </p>
        </div>

        {error ? (
          <p className="text-sm text-[var(--destructive)]">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
