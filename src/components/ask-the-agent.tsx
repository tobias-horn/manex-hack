"use client";

import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import {
  Bot,
  Check,
  Eraser,
  LoaderCircle,
  Send,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ProposalStatus = "idle" | "submitting" | "approved" | "denied" | "error";

type ProposalRecord = {
  status: ProposalStatus;
  message?: string;
};

const QUICK_PROMPTS = [
  "SOLDER_COLD spike KW 5-6/2026 — investigate.",
  "VIB_TEST failures at Montage Linie 1 in Dec 2025 — what's going on?",
  "Field claims on ART-00001 with no in-factory defect — what story?",
  "Cosmetic defects on PO-00012, PO-00018, PO-00024 — root cause?",
];

type ToolPart = {
  type: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function isToolPart(part: { type: string }): part is ToolPart {
  return part.type.startsWith("tool-");
}

function humanToolName(type: string) {
  return type.replace(/^tool-/, "").replace(/_/g, " ");
}

function isProposalOutput(output: unknown): output is {
  kind: "proposal";
  proposalType: "product_action" | "assignment" | "report";
  status: "pending_approval";
  payload: Record<string, unknown>;
} {
  if (!output || typeof output !== "object") return false;
  const o = output as Record<string, unknown>;
  return o.kind === "proposal" && typeof o.proposalType === "string";
}

export function AskTheAgent() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [proposalState, setProposalState] = useState<Record<string, ProposalRecord>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/agent" }),
    [],
  );

  const { messages, sendMessage, setMessages, status, error, stop, clearError } = useChat({
    transport,
    onFinish: () => {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
      });
    },
  });

  const isWorking = status === "streaming" || status === "submitted";

  async function submit(text: string) {
    const value = text.trim();
    if (!value) return;
    setInput("");
    clearError?.();
    await sendMessage({ text: value });
  }

  async function handleDecision(
    toolCallId: string,
    approve: boolean,
    payload: { proposalType: string; payload: Record<string, unknown> },
  ) {
    setProposalState((s) => ({ ...s, [toolCallId]: { status: "submitting" } }));

    if (!approve) {
      setProposalState((s) => ({
        ...s,
        [toolCallId]: { status: "denied", message: "Denied. No change written." },
      }));
      return;
    }

    try {
      const res = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setProposalState((s) => ({
          ...s,
          [toolCallId]: {
            status: "error",
            message: json?.error ?? "Write failed.",
          },
        }));
        return;
      }
      setProposalState((s) => ({
        ...s,
        [toolCallId]: {
          status: "approved",
          message:
            json?.result?.transport === "postgres"
              ? "Written to Postgres."
              : json?.result?.transport === "rest"
                ? "Written via REST."
                : "Approved.",
        },
      }));
    } catch (err) {
      setProposalState((s) => ({
        ...s,
        [toolCallId]: {
          status: "error",
          message: err instanceof Error ? err.message : "Network error.",
        },
      }));
    }
  }

  return (
    <>
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={cn(
            "fixed bottom-6 right-6 z-40",
            "flex items-center gap-2 rounded-full px-5 py-3",
            "bg-[var(--primary)] text-[var(--primary-foreground)]",
            "shadow-lg shadow-black/20 transition-transform hover:scale-105",
          )}
        >
          <Bot className="size-4" />
          <span className="text-sm font-medium">Ask the Agent</span>
        </button>
      ) : (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-40",
            "flex h-[min(78vh,720px)] w-[min(94vw,460px)] flex-col",
            "glass-panel ghost-border overflow-hidden rounded-[24px] shadow-2xl",
          )}
        >
          <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-full bg-[color:rgba(0,92,151,0.12)] text-[var(--primary)]">
                <Bot className="size-4" />
              </div>
              <div className="text-sm font-semibold">Manex Forensic Agent</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (isWorking) stop();
                  setMessages([]);
                  setProposalState({});
                  clearError?.();
                }}
                disabled={messages.length === 0 && !error}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="Clear chat"
                title="Clear chat"
              >
                <Eraser className="size-3.5" />
                Clear
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full p-1 hover:bg-[var(--muted)]"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                  I&apos;ll query the live Manex DB, match signals to the four known
                  stories, and propose actions you can approve or deny.
                </p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void submit(q)}
                      className="rounded-full border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-[11px] leading-4 text-[var(--secondary-foreground)] hover:bg-[var(--muted)]"
                    >
                      <Wand2 className="mr-1 inline size-3" />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "space-y-2",
                  message.role === "user" ? "flex justify-end" : "",
                )}
              >
                <div
                  className={cn(
                    "max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-6",
                    message.role === "user"
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--card)] text-[var(--card-foreground)] border border-[var(--border)]",
                  )}
                >
                  {message.parts.map((part, idx) => {
                    if (part.type === "text") {
                      const text = (part as { text: string }).text;
                      if (message.role === "user") {
                        return (
                          <p key={idx} className="whitespace-pre-wrap">
                            {text}
                          </p>
                        );
                      }
                      return <MarkdownBlock key={idx} text={text} />;
                    }
                    if (isToolPart(part as { type: string })) {
                      const tp = part as ToolPart;
                      const name = humanToolName(tp.type);
                      if (tp.state === "input-streaming" || tp.state === "input-available") {
                        return (
                          <div
                            key={idx}
                            className="mt-1 flex items-center gap-2 rounded-xl bg-[var(--muted)] px-2 py-1.5 text-[11px] text-[var(--muted-foreground)]"
                          >
                            <LoaderCircle className="size-3 animate-spin" />
                            <span>Calling {name}…</span>
                          </div>
                        );
                      }
                      if (tp.state === "output-error") {
                        return (
                          <div
                            key={idx}
                            className="mt-1 rounded-xl bg-[color:rgba(178,69,63,0.15)] px-2 py-1.5 text-[11px] text-[var(--destructive)]"
                          >
                            {name} failed: {tp.errorText}
                          </div>
                        );
                      }
                      if (tp.state === "output-available") {
                        const out = tp.output;
                        if (isProposalOutput(out)) {
                          const id = tp.toolCallId ?? `${message.id}-${idx}`;
                          const record = proposalState[id] ?? { status: "idle" };
                          return (
                            <ProposalCard
                              key={idx}
                              name={name}
                              proposalType={out.proposalType}
                              payload={out.payload}
                              record={record}
                              onApprove={() =>
                                void handleDecision(id, true, {
                                  proposalType: out.proposalType,
                                  payload: out.payload,
                                })
                              }
                              onDeny={() =>
                                void handleDecision(id, false, {
                                  proposalType: out.proposalType,
                                  payload: out.payload,
                                })
                              }
                            />
                          );
                        }
                        const summary = summarizeToolOutput(out);
                        return (
                          <details
                            key={idx}
                            className="mt-1 rounded-xl bg-[var(--muted)] px-2 py-1.5 text-[11px] text-[var(--muted-foreground)]"
                          >
                            <summary className="flex cursor-pointer items-center gap-2">
                              <Wrench className="size-3" />
                              <span>{name}</span>
                              <span className="text-[var(--muted-foreground)]">
                                {summary}
                              </span>
                            </summary>
                            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-[var(--muted-foreground)]">
                              {JSON.stringify(out, null, 2)}
                            </pre>
                          </details>
                        );
                      }
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}

            {isWorking ? (
              <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                <LoaderCircle className="size-3 animate-spin" />
                Thinking…
                <button
                  type="button"
                  onClick={() => stop()}
                  className="ml-2 underline"
                >
                  stop
                </button>
              </div>
            ) : null}

            {error ? (
              <p className="text-xs text-[var(--destructive)]">
                {error.message || "Agent request failed."}
              </p>
            ) : null}
          </div>

          <form
            className="border-t border-[var(--border)] bg-[var(--secondary)] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(input);
            }}
          >
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe the symptom or ask a question…"
                className="min-h-[44px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit(input);
                  }
                }}
              />
              <Button
                type="submit"
                size="icon-sm"
                disabled={isWorking || !input.trim()}
              >
                <Send className="size-4" />
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="agent-md text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h3 className="mt-2 mb-1 text-[15px] font-semibold" {...props} />,
          h2: (props) => <h3 className="mt-2 mb-1 text-[14px] font-semibold" {...props} />,
          h3: (props) => <h4 className="mt-2 mb-1 text-[13px] font-semibold" {...props} />,
          p: (props) => <p className="my-1 whitespace-pre-wrap" {...props} />,
          ul: (props) => <ul className="my-1 list-disc space-y-0.5 pl-5" {...props} />,
          ol: (props) => <ol className="my-1 list-decimal space-y-0.5 pl-5" {...props} />,
          li: (props) => <li className="leading-5" {...props} />,
          strong: (props) => <strong className="font-semibold" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          code: (props) => (
            <code
              className="rounded bg-[var(--muted)] px-1 py-0.5 font-mono text-[12px] text-[var(--muted-foreground)]"
              {...props}
            />
          ),
          pre: (props) => (
            <pre
              className="my-1 overflow-x-auto rounded-lg bg-[var(--muted)] p-2 font-mono text-[11px] text-[var(--muted-foreground)]"
              {...props}
            />
          ),
          a: (props) => (
            <a className="underline text-[var(--primary)]" target="_blank" rel="noreferrer" {...props} />
          ),
          hr: () => <hr className="my-2 border-[var(--border)]" />,
          blockquote: (props) => (
            <blockquote
              className="my-1 border-l-2 border-[var(--border)] pl-2 text-[var(--muted-foreground)]"
              {...props}
            />
          ),
          table: (props) => (
            <table className="my-1 w-full border-collapse text-[12px]" {...props} />
          ),
          th: (props) => <th className="border border-[var(--border)] px-2 py-1 text-left font-semibold" {...props} />,
          td: (props) => <td className="border border-[var(--border)] px-2 py-1 align-top" {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function summarizeToolOutput(out: unknown): string {
  if (!out || typeof out !== "object") return "";
  const o = out as Record<string, unknown>;
  const items = o.items;
  if (Array.isArray(items)) {
    const total = typeof o.total === "number" ? o.total : items.length;
    return `${items.length} of ${total}`;
  }
  return "";
}

function ProposalCard({
  name,
  proposalType,
  payload,
  record,
  onApprove,
  onDeny,
}: {
  name: string;
  proposalType: "product_action" | "assignment" | "report";
  payload: Record<string, unknown>;
  record: ProposalRecord;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const title =
    proposalType === "product_action"
      ? "Proposed PRODUCT_ACTION"
      : proposalType === "assignment"
        ? "Proposed assignment"
        : "Proposed 8D report";

  const locked = record.status === "approved" || record.status === "denied";

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-[var(--primary)]/40 bg-[color:color-mix(in_srgb,var(--primary)_10%,var(--card))] p-3 text-[var(--card-foreground)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge>{title}</Badge>
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {name}
          </span>
        </div>
      </div>
      <dl className="space-y-1 text-[11px] leading-5">
        {Object.entries(payload).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[110px_1fr] gap-2">
            <dt className="text-[var(--muted-foreground)]">{k}</dt>
            <dd className="break-words whitespace-pre-wrap">
              {typeof v === "string"
                ? v
                : Array.isArray(v)
                  ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n")
                  : JSON.stringify(v)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onApprove}
          disabled={locked || record.status === "submitting"}
        >
          {record.status === "submitting" ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <Check className="size-3" />
          )}
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onDeny}
          disabled={locked || record.status === "submitting"}
        >
          <X className="size-3" />
          Deny
        </Button>
        {record.message ? (
          <span
            className={cn(
              "text-[11px]",
              record.status === "approved" && "text-[var(--primary)]",
              record.status === "denied" && "text-[var(--muted-foreground)]",
              record.status === "error" && "text-[var(--destructive)]",
            )}
          >
            {record.message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
