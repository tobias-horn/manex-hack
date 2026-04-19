"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ArticleHypothesisBoardStatus,
  ArticleHypothesisCardViewModel,
} from "@/lib/article-hypothesis-view";
import { fetchConfirmedCaseReport } from "@/lib/manex-confirmed-case-report-client";
import type { ClusteringMode } from "@/lib/manex-clustering-mode";
import type { ConfirmedCaseReportRecord } from "@/lib/manex-confirmed-case-report-schema";

const REPORT_REVEAL_DELAY_MS = 3000;

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function useConfirmedCaseReportFlow(input: {
  articleId: string;
  mode: ClusteringMode;
  hypotheses: ArticleHypothesisCardViewModel[];
}) {
  const contextKey = `${input.articleId}:${input.mode}`;
  const [recordsByContext, setRecordsByContext] = useState<
    Record<string, Record<string, ConfirmedCaseReportRecord>>
  >({});
  const [revealedByContext, setRevealedByContext] = useState<Record<string, string | null>>({});
  const [revealingByContext, setRevealingByContext] = useState<Record<string, string | null>>({});
  const [revealErrorByContext, setRevealErrorByContext] = useState<Record<string, string | null>>(
    {},
  );
  const recordByHypothesisId = recordsByContext[contextKey] ?? {};
  const revealedHypothesisId = revealedByContext[contextKey] ?? null;
  const revealingHypothesisId = revealingByContext[contextKey] ?? null;
  const revealError = revealErrorByContext[contextKey] ?? null;
  const recordsByContextRef = useRef(recordsByContext);
  const inflightRequestsRef = useRef<Map<string, Promise<ConfirmedCaseReportRecord>>>(new Map());
  const contextKeyRef = useRef(contextKey);

  useEffect(() => {
    recordsByContextRef.current = recordsByContext;
  }, [recordsByContext]);

  contextKeyRef.current = contextKey;

  const ensureReport = useCallback(async (hypothesis: ArticleHypothesisCardViewModel) => {
    const requestKey = `${contextKey}:${hypothesis.id}`;
    const existing = recordsByContextRef.current[contextKey]?.[hypothesis.id];

    if (existing) {
      return existing;
    }

    const inflight = inflightRequestsRef.current.get(requestKey);

    if (inflight) {
      return inflight;
    }

    const requestContextKey = contextKey;
    const request = fetchConfirmedCaseReport({
      articleId: input.articleId,
      candidateId: hypothesis.id,
      pipelineMode: input.mode,
      candidateTitle: hypothesis.title,
    })
      .then((record) => {
        if (contextKeyRef.current === requestContextKey) {
          recordsByContextRef.current = {
            ...recordsByContextRef.current,
            [requestContextKey]: {
              ...(recordsByContextRef.current[requestContextKey] ?? {}),
              [hypothesis.id]: record,
            },
          };
          setRecordsByContext((current) => ({
            ...current,
            [requestContextKey]: {
              ...(current[requestContextKey] ?? {}),
              [hypothesis.id]: record,
            },
          }));
        }

        return record;
      })
      .finally(() => {
        inflightRequestsRef.current.delete(requestKey);
    });

    inflightRequestsRef.current.set(requestKey, request);
    return request;
  }, [contextKey, input.articleId, input.mode]);

  const hypothesisSignature = input.hypotheses
    .map((hypothesis) => `${hypothesis.id}:${hypothesis.title}:${hypothesis.reviewable ? "1" : "0"}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;

    async function prewarmReports() {
      for (const hypothesis of input.hypotheses) {
        if (!hypothesis.reviewable) {
          continue;
        }

        try {
          await ensureReport(hypothesis);
        } catch {
          if (cancelled) {
            return;
          }
        }
      }
    }

    void prewarmReports();

    return () => {
      cancelled = true;
    };
  }, [contextKey, ensureReport, hypothesisSignature, input.hypotheses]);

  async function revealReport(hypothesis: ArticleHypothesisCardViewModel) {
    setRevealErrorByContext((current) => ({
      ...current,
      [contextKey]: null,
    }));
    setRevealedByContext((current) => ({
      ...current,
      [contextKey]: null,
    }));
    setRevealingByContext((current) => ({
      ...current,
      [contextKey]: hypothesis.id,
    }));

    try {
      await Promise.all([ensureReport(hypothesis), delay(REPORT_REVEAL_DELAY_MS)]);

      if (contextKeyRef.current !== contextKey) {
        return;
      }

      setRevealedByContext((current) => ({
        ...current,
        [contextKey]: hypothesis.id,
      }));
    } catch (error) {
      if (contextKeyRef.current !== contextKey) {
        return;
      }

      setRevealErrorByContext((current) => ({
        ...current,
        [contextKey]:
          error instanceof Error ? error.message : "Could not open the confirmed case report.",
      }));
      setRevealedByContext((current) => ({
        ...current,
        [contextKey]: null,
      }));
    } finally {
      if (contextKeyRef.current === contextKey) {
        setRevealingByContext((current) => ({
          ...current,
          [contextKey]: current[contextKey] === hypothesis.id ? null : current[contextKey] ?? null,
        }));
      }
    }
  }

  function hideRevealedReport(hypothesisId?: string) {
    setRevealErrorByContext((current) => ({
      ...current,
      [contextKey]: null,
    }));
    setRevealingByContext((current) => ({
      ...current,
      [contextKey]:
        !hypothesisId || current[contextKey] === hypothesisId ? null : current[contextKey] ?? null,
    }));
    setRevealedByContext((current) => ({
      ...current,
      [contextKey]:
        !hypothesisId || current[contextKey] === hypothesisId ? null : current[contextKey] ?? null,
    }));
  }

  async function handleConfirmedStatus(
    hypothesis: ArticleHypothesisCardViewModel,
    status: ArticleHypothesisBoardStatus,
    persistStatus: (status: ArticleHypothesisBoardStatus) => Promise<void>,
  ) {
    if (status !== "confirmed") {
      hideRevealedReport(hypothesis.id);
      await persistStatus(status);
      return;
    }

    if (hypothesis.currentStatus !== "confirmed") {
      await persistStatus("confirmed");
    }

    await revealReport(hypothesis);
  }

  return {
    recordByHypothesisId,
    revealedHypothesisId,
    revealingHypothesisId,
    revealError,
    revealReport,
    hideRevealedReport,
    handleConfirmedStatus,
  };
}
