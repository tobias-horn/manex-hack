"use client";

import {
  BookMarked,
  FolderGit2,
  Lightbulb,
  LoaderCircle,
  MessagesSquare,
} from "lucide-react";
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
import type {
  ManexCase,
  ManexCasePriority,
  ManexCaseSignalType,
} from "@/lib/manex-case-state";
import { formatUiRelative } from "@/lib/ui-format";

type CaseWorkbenchProps = {
  initialCases: ManexCase[];
  hasConnection: boolean;
  defaultProductId: string;
  defaultArticleId: string;
  defaultSignalId: string;
};

type CasesResponse = {
  ok?: boolean;
  mode?: "live";
  case?: ManexCase;
  cases?: ManexCase[];
  error?: string;
};

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

const priorityTone: Record<ManexCasePriority, string> = {
  low: "bg-[color:rgba(20,32,42,0.08)] text-foreground",
  medium: "bg-[color:rgba(208,141,37,0.14)] text-[var(--warning-foreground)]",
  high: "bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]",
  critical: "bg-[color:rgba(178,69,63,0.12)] text-[var(--destructive)]",
};

const signalLabel: Record<ManexCaseSignalType, string> = {
  defect: "Defect",
  field_claim: "Field claim",
  bad_test: "Bad test",
  marginal_test: "Marginal test",
  product_action: "Product action",
  rework: "Rework",
  part_install: "Part install",
  custom: "Custom",
};

function formatRelative(value: string) {
  return formatUiRelative(value);
}

function replaceCaseEntry(current: ManexCase[], nextCase: ManexCase) {
  const withoutCurrent = current.filter((entry) => entry.id !== nextCase.id);
  return [nextCase, ...withoutCurrent];
}

export function CaseWorkbench({
  initialCases,
  hasConnection,
  defaultProductId,
  defaultArticleId,
  defaultSignalId,
}: CaseWorkbenchProps) {
  const [cases, setCases] = useState(initialCases);
  const [title, setTitle] = useState("Supplier spike intake");
  const [summary, setSummary] = useState(
    "Capture the first working theory, evidence handles, and owner context for a quality spike without pushing notes into seed tables.",
  );
  const [productId, setProductId] = useState(defaultProductId);
  const [articleId, setArticleId] = useState(defaultArticleId);
  const [signalType, setSignalType] = useState<ManexCaseSignalType>("defect");
  const [signalId, setSignalId] = useState(defaultSignalId);
  const [priority, setPriority] = useState<ManexCasePriority>("high");
  const [openingHypothesis, setOpeningHypothesis] = useState(
    "Symptoms likely cluster around one supplier or calibration condition, but the evidence still needs to be assembled into a case.",
  );
  const [openingNote, setOpeningNote] = useState(
    "Start with the symptom source, then attach traceability, workflow actions, and supporting claims here.",
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [hypothesisDrafts, setHypothesisDrafts] = useState<Record<string, string>>({});

  const canCreate = useMemo(
    () => Boolean(title.trim() && productId.trim()),
    [productId, title],
  );

  async function createCase() {
    setFeedback(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          summary,
          productId,
          articleId,
          priority,
          status: "triage",
          initialSignalType: signalId.trim() ? signalType : undefined,
          initialSignalId: signalId.trim() || undefined,
          openingHypothesis,
          openingNote,
        }),
      });

      const payload = (await response.json()) as CasesResponse;

      if (!response.ok || !payload.case) {
        setFeedback({
          tone: "error",
          text: payload.error ?? "Could not create the case.",
        });
        return;
      }

      setCases((current) => [payload.case!, ...current].slice(0, 18));
      setNoteDrafts((current) => ({
        ...current,
        [payload.case!.id]: "",
      }));
      setHypothesisDrafts((current) => ({
        ...current,
        [payload.case!.id]: "",
      }));
      setTitle("Thermal claims review");
      setSummary(
        "Collect the next signal cluster here without touching protected seed data.",
      );
      setOpeningHypothesis(
        "Field symptoms could still represent a design-side weakness rather than a single factory event.",
      );
      setOpeningNote(
        "Use this space for the working narrative, open questions, and decisions.",
      );
      setFeedback({
        tone: "success",
        text: `${payload.case.id} created and persisted in the app-owned case tables.`,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function addNote(caseId: string) {
    const body = noteDrafts[caseId]?.trim();

    if (!body) {
      setFeedback({
        tone: "error",
        text: "Write a note before saving it to the case.",
      });
      return;
    }

    setPendingCaseId(caseId);
    setFeedback(null);

    try {
      const response = await fetch(`/api/cases/${caseId}/notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body,
          noteType: "note",
        }),
      });

      const payload = (await response.json()) as CasesResponse;

      if (!response.ok || !payload.case) {
        setFeedback({
          tone: "error",
          text: payload.error ?? `Could not save a note to ${caseId}.`,
        });
        return;
      }

      setCases((current) => replaceCaseEntry(current, payload.case!));
      setNoteDrafts((current) => ({
        ...current,
        [caseId]: "",
      }));
      setFeedback({
        tone: "success",
        text: `Note added to ${caseId}.`,
      });
    } finally {
      setPendingCaseId(null);
    }
  }

  async function addHypothesis(caseId: string) {
    const statement = hypothesisDrafts[caseId]?.trim();

    if (!statement) {
      setFeedback({
        tone: "error",
        text: "Write a hypothesis before saving it to the case.",
      });
      return;
    }

    setPendingCaseId(caseId);
    setFeedback(null);

    try {
      const response = await fetch(`/api/cases/${caseId}/hypotheses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          statement,
          status: "open",
        }),
      });

      const payload = (await response.json()) as CasesResponse;

      if (!response.ok || !payload.case) {
        setFeedback({
          tone: "error",
          text: payload.error ?? `Could not save a hypothesis to ${caseId}.`,
        });
        return;
      }

      setCases((current) => replaceCaseEntry(current, payload.case!));
      setHypothesisDrafts((current) => ({
        ...current,
        [caseId]: "",
      }));
      setFeedback({
        tone: "success",
        text: `Hypothesis added to ${caseId}.`,
      });
    } finally {
      setPendingCaseId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="surface-sheet rounded-[30px] px-0 py-0">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="eyebrow">App-owned state</div>
              <CardTitle className="section-title mt-1">
                Create a real investigation case
              </CardTitle>
              <CardDescription className="mt-2 max-w-3xl leading-6">
                Cases, notes, hypotheses, bookmarks, and saved views now live in
                their own schema surface instead of being forced into seed tables.
              </CardDescription>
            </div>
            <div className="flex size-12 items-center justify-center rounded-full bg-[color:rgba(0,92,151,0.08)] text-[var(--primary)]">
              <FolderGit2 className="size-5" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>{hasConnection ? "Live case state" : "Connection missing"}</Badge>
            <Badge variant="outline">cases</Badge>
            <Badge variant="outline">notes + hypotheses</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 px-5 pb-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Supplier spike intake"
            />
            <select
              className="select-field h-11 rounded-[1rem] px-3.5 text-sm text-foreground outline-none"
              value={priority}
              onChange={(event) => setPriority(event.target.value as ManexCasePriority)}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
          </div>

          <Textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="What is this case trying to hold together?"
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              placeholder="PRD-00159"
            />
            <Input
              value={articleId}
              onChange={(event) => setArticleId(event.target.value)}
              placeholder="ART-00001"
            />
            <select
              className="select-field h-11 rounded-[1rem] px-3.5 text-sm text-foreground outline-none"
              value={signalType}
              onChange={(event) => setSignalType(event.target.value as ManexCaseSignalType)}
            >
              <option value="defect">defect</option>
              <option value="field_claim">field_claim</option>
              <option value="bad_test">bad_test</option>
              <option value="marginal_test">marginal_test</option>
              <option value="product_action">product_action</option>
              <option value="rework">rework</option>
              <option value="part_install">part_install</option>
              <option value="custom">custom</option>
            </select>
            <Input
              value={signalId}
              onChange={(event) => setSignalId(event.target.value)}
              placeholder="DEF-00071"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Textarea
              value={openingHypothesis}
              onChange={(event) => setOpeningHypothesis(event.target.value)}
              placeholder="First working theory"
            />
            <Textarea
              value={openingNote}
              onChange={(event) => setOpeningNote(event.target.value)}
              placeholder="First structured note"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs leading-5 text-[var(--muted-foreground)]">
              The case keeps only product-layer state. The linked signal remains the
              bridge back to the underlying repo entities.
            </p>
            <Button
              type="button"
              size="lg"
              onClick={() => void createCase()}
              disabled={!hasConnection || isSubmitting || !canCreate}
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Creating case
                </>
              ) : (
                "Create case"
              )}
            </Button>
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
        </CardContent>
      </Card>

      <div className="space-y-4">
        {cases.length ? (
          cases.map((caseItem) => (
            <Card
              key={caseItem.id}
              className="surface-panel overflow-hidden rounded-[30px] px-0 py-0"
            >
              <CardHeader className="spec-grid px-6 pt-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge className={priorityTone[caseItem.priority]}>
                        {caseItem.priority}
                      </Badge>
                      <Badge variant="outline">{caseItem.status}</Badge>
                      {caseItem.productId ? (
                        <Badge variant="outline">{caseItem.productId}</Badge>
                      ) : null}
                      {caseItem.articleId ? (
                        <Badge variant="outline">{caseItem.articleId}</Badge>
                      ) : null}
                    </div>
                    <div>
                      <div className="lab-stamp">{caseItem.id}</div>
                      <CardTitle className="section-title mt-2">
                        {caseItem.title}
                      </CardTitle>
                      <CardDescription className="mt-2 max-w-3xl leading-6">
                        {caseItem.summary}
                      </CardDescription>
                    </div>
                  </div>

                  <div className="rounded-[22px] bg-[color:var(--surface-low)] px-4 py-4 text-right">
                    <div className="eyebrow">Last updated</div>
                    <div className="mt-2 text-sm font-medium">
                      {formatRelative(caseItem.updatedAt)}
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-5 px-5 pb-5">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Signals</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {caseItem.counts.signals}
                    </div>
                  </div>
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Hypotheses</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {caseItem.counts.hypotheses}
                    </div>
                  </div>
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Notes</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {caseItem.counts.notes}
                    </div>
                  </div>
                  <div className="rounded-[22px] bg-[color:var(--surface-low)] p-4">
                    <div className="eyebrow">Bookmarks</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {caseItem.counts.bookmarks}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-white/10 bg-black/8 p-4">
                      <div className="flex items-center gap-2">
                        <BookMarked className="size-4 text-[var(--primary)]" />
                        <div className="text-sm font-semibold">Linked evidence</div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {caseItem.signalLinks.length ? (
                          caseItem.signalLinks.map((link) => (
                            <Badge key={link.id} variant="outline">
                              {signalLabel[link.signalType]} · {link.signalId}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-[var(--muted-foreground)]">
                            No linked evidence yet.
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-black/8 p-4">
                      <div className="flex items-center gap-2">
                        <Lightbulb className="size-4 text-[var(--primary)]" />
                        <div className="text-sm font-semibold">Hypotheses</div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {caseItem.hypotheses.length ? (
                          caseItem.hypotheses.slice(0, 3).map((hypothesis) => (
                            <div
                              key={hypothesis.id}
                              className="rounded-[18px] bg-[color:var(--surface-low)] px-3 py-3"
                            >
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline">{hypothesis.status}</Badge>
                                {hypothesis.confidence !== null ? (
                                  <Badge variant="outline">
                                    {hypothesis.confidence}% confidence
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm leading-6">
                                {hypothesis.statement}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-[var(--muted-foreground)]">
                            No hypotheses attached yet.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-black/8 p-4">
                      <div className="flex items-center gap-2">
                        <MessagesSquare className="size-4 text-[var(--primary)]" />
                        <div className="text-sm font-semibold">Recent notes</div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {caseItem.notes.length ? (
                          caseItem.notes.slice(0, 3).map((note) => (
                            <div
                              key={note.id}
                              className="rounded-[18px] bg-[color:var(--surface-low)] px-3 py-3"
                            >
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline">{note.noteType}</Badge>
                                <Badge variant="outline">
                                  {formatRelative(note.updatedAt)}
                                </Badge>
                              </div>
                              <p className="mt-2 text-sm leading-6">{note.body}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-[var(--muted-foreground)]">
                            No investigation notes yet.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[24px] bg-[color:var(--surface-low)] p-4">
                      <div className="eyebrow">Append note</div>
                      <Textarea
                        className="mt-3 min-h-24"
                        value={noteDrafts[caseItem.id] ?? ""}
                        onChange={(event) =>
                          setNoteDrafts((current) => ({
                            ...current,
                            [caseItem.id]: event.target.value,
                          }))
                        }
                        placeholder="Log an observation, a decision, or a timeline event."
                      />
                      <div className="mt-3 flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void addNote(caseItem.id)}
                          disabled={pendingCaseId === caseItem.id}
                        >
                          {pendingCaseId === caseItem.id ? (
                            <>
                              <LoaderCircle className="size-4 animate-spin" />
                              Saving
                            </>
                          ) : (
                            "Save note"
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-[24px] bg-[color:var(--surface-low)] p-4">
                      <div className="eyebrow">Append hypothesis</div>
                      <Textarea
                        className="mt-3 min-h-24"
                        value={hypothesisDrafts[caseItem.id] ?? ""}
                        onChange={(event) =>
                          setHypothesisDrafts((current) => ({
                            ...current,
                            [caseItem.id]: event.target.value,
                          }))
                        }
                        placeholder="Add the next working theory or a disconfirming angle."
                      />
                      <div className="mt-3 flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void addHypothesis(caseItem.id)}
                          disabled={pendingCaseId === caseItem.id}
                        >
                          {pendingCaseId === caseItem.id ? (
                            <>
                              <LoaderCircle className="size-4 animate-spin" />
                              Saving
                            </>
                          ) : (
                            "Save hypothesis"
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="surface-panel rounded-[30px] px-0 py-0">
            <CardHeader className="px-6 pt-6">
              <Badge variant="outline">No cases yet</Badge>
              <CardTitle className="section-title mt-3">
                Create the first working case
              </CardTitle>
              <CardDescription className="mt-2 leading-6">
                The tables are ready. Create one case above and the workbench will use
                it as the anchor for notes, hypotheses, evidence bookmarks, and later
                copilot features.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
