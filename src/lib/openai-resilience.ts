import { asSchema, generateObject, generateText, type LanguageModel } from "ai";
import { type ProviderOptions } from "@ai-sdk/provider-utils";
import { z } from "zod";

import {
  parseUnicodeSafeJson,
  sanitizeUnicodeForJson,
  stringifyUnicodeSafe,
} from "@/lib/json-unicode";

const DEFAULT_OPENAI_REQUESTS_PER_MINUTE = 5000;
const DEFAULT_TEXT_REPAIR_ATTEMPTS = 2;
const MAX_REPAIR_TEXT_CHARS = 40_000;

const readPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const OPENAI_REQUESTS_PER_MINUTE = readPositiveInt(
  process.env.MANEX_OPENAI_REQUESTS_PER_MINUTE,
  DEFAULT_OPENAI_REQUESTS_PER_MINUTE,
);
const TEXT_REPAIR_ATTEMPTS = readPositiveInt(
  process.env.MANEX_STRUCTURED_TEXT_REPAIR_ATTEMPTS,
  DEFAULT_TEXT_REPAIR_ATTEMPTS,
);
const REQUEST_INTERVAL_MS = Math.max(1, Math.ceil(60_000 / OPENAI_REQUESTS_PER_MINUTE));

let nextRequestStartAt = 0;
let requestGateTail: Promise<void> = Promise.resolve();

type OpenAiResilienceOptions = {
  abortSignal?: AbortSignal;
  abortMessage?: string;
  createAbortError?: (message: string) => Error;
};

type StructuredObjectRepairInput<TSchema extends z.ZodTypeAny> = OpenAiResilienceOptions & {
  model: LanguageModel;
  schema: TSchema;
  schemaName: string;
  schemaDescription?: string;
  system: string;
  prompt: string;
  maxOutputTokens?: number | null;
  providerOptions?: ProviderOptions;
  maxAttempts: number;
  isStopError?: (error: unknown) => boolean;
};

const defaultAbortError = (message: string) => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

const createAbortErrorFromOptions = (options?: OpenAiResilienceOptions) =>
  options?.createAbortError ?? defaultAbortError;

const resolveAbortMessage = (options?: OpenAiResilienceOptions) =>
  typeof options?.abortSignal?.reason === "string" && options.abortSignal.reason
    ? options.abortSignal.reason
    : options?.abortMessage ?? "Pipeline stopped by user.";

export function extractRetryDelayMs(message: string) {
  const match = message.match(/try again in\s+([0-9.]+)\s*(ms|s|sec|secs|second|seconds)/i);

  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1] ?? "");

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return /^ms$/i.test(match[2] ?? "") ? Math.ceil(value) : Math.ceil(value * 1000);
}

function isSchemaValidationError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError;
}

function formatSchemaIssuePath(path: PropertyKey[]) {
  if (path.length === 0) {
    return "<root>";
  }

  return path
    .map((segment) =>
      typeof segment === "number"
        ? `[${segment}]`
        : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(segment))
          ? String(segment)
          : `["${String(segment)}"]`,
    )
    .join(".")
    .replace(/\.\[/g, "[");
}

function summarizeSchemaValidationError(error: z.ZodError, maxIssues = 8) {
  const issues = error.issues.slice(0, maxIssues).map((issue) => {
    const path = formatSchemaIssuePath(issue.path);
    return `${path}: ${issue.message}`;
  });

  if (error.issues.length > maxIssues) {
    issues.push(`...and ${error.issues.length - maxIssues} more schema issue(s)`);
  }

  return issues.join("; ");
}

function describeStructuredOutputError(error: unknown) {
  if (isSchemaValidationError(error)) {
    return `Schema validation failed (${summarizeSchemaValidationError(error)}).`;
  }

  return error instanceof Error ? error.message : String(error);
}

function toStructuredOutputError(error: unknown) {
  if (isSchemaValidationError(error)) {
    return new Error(
      `Structured output matched JSON syntax but not the expected schema (${summarizeSchemaValidationError(
        error,
      )}).`,
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

export function isStructuredParseError(error: unknown) {
  if (isSchemaValidationError(error)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /no object generated|could not parse the response|failed to parse|unsupported unicode escape sequence|bad control character|bad escaped character|invalid escape|invalid input|expected object|expected array|expected .* received/i.test(
    message,
  );
}

export function isRetryableOpenAiError(error: unknown) {
  if (isSchemaValidationError(error)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);

  return /rate limit|429|overloaded|temporarily unavailable|timeout|timed out|no object generated|could not parse the response|failed to parse|unsupported unicode escape sequence|bad control character|bad escaped character|invalid escape|invalid input|expected object|expected array|recoverable json value|valid json/i.test(
    message,
  );
}

export async function sleepWithAbort(ms: number, options?: OpenAiResilienceOptions) {
  await new Promise<void>((resolve, reject) => {
    if (options?.abortSignal?.aborted) {
      reject(createAbortErrorFromOptions(options)(resolveAbortMessage(options)));
      return;
    }

    const timer = setTimeout(() => {
      options?.abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      options?.abortSignal?.removeEventListener("abort", onAbort);
      reject(createAbortErrorFromOptions(options)(resolveAbortMessage(options)));
    };

    options?.abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function throttleOpenAiRequest<TValue>(
  callback: () => Promise<TValue>,
  options?: OpenAiResilienceOptions,
) {
  const reservation = requestGateTail.then(async () => {
    const now = Date.now();
    const scheduledAt = Math.max(now, nextRequestStartAt);
    nextRequestStartAt = scheduledAt + REQUEST_INTERVAL_MS;

    if (scheduledAt > now) {
      await sleepWithAbort(scheduledAt - now, options);
    }
  });

  requestGateTail = reservation.catch(() => undefined);
  await reservation;
  return callback();
}

function stripMarkdownCodeFence(value: string) {
  const trimmed = value.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/\s*```$/, "").trim();
}

function tryParseJson(candidate: string) {
  try {
    return {
      ok: true as const,
      value: parseUnicodeSafeJson(candidate) as unknown,
    };
  } catch (error) {
    return {
      ok: false as const,
      error,
    };
  }
}

function extractBalancedJsonCandidate(value: string, startIndex: number) {
  const openingChar = value[startIndex];
  const closingChar = openingChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === "\"") {
        inString = false;
      }

      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === openingChar) {
      depth += 1;
      continue;
    }

    if (character === closingChar) {
      depth -= 1;

      if (depth === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function truncateRepairText(value: string) {
  if (value.length <= MAX_REPAIR_TEXT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_REPAIR_TEXT_CHARS).trimEnd()}\n...[truncated ${
    value.length - MAX_REPAIR_TEXT_CHARS
  } chars]`;
}

export function parseJsonFromModelText<TValue = unknown>(text: string) {
  const sanitized = sanitizeUnicodeForJson(text);
  const stripped = stripMarkdownCodeFence(sanitized);
  const directParse = tryParseJson(stripped);

  if (directParse.ok) {
    return directParse.value as TValue;
  }

  let lastParseError: string | null = null;

  for (let index = 0; index < stripped.length; index += 1) {
    const character = stripped[index];

    if (character !== "{" && character !== "[") {
      continue;
    }

    const candidate = extractBalancedJsonCandidate(stripped, index);

    if (!candidate) {
      continue;
    }

    const parsedCandidate = tryParseJson(candidate);

    if (parsedCandidate.ok) {
      return parsedCandidate.value as TValue;
    }

    lastParseError =
      parsedCandidate.error instanceof Error
        ? parsedCandidate.error.message
        : String(parsedCandidate.error);
  }

  throw new Error(
    lastParseError
      ? `The model text did not contain a recoverable JSON value (${lastParseError}).`
      : "The model text did not contain a recoverable JSON value.",
  );
}

async function repairStructuredObjectViaText<TSchema extends z.ZodTypeAny>(
  input: StructuredObjectRepairInput<TSchema>,
) {
  const resolvedSchema = await asSchema(input.schema).jsonSchema;
  let invalidJsonText: string | null = null;
  let invalidJsonError: string | null = null;
  let invalidSchemaError: string | null = null;
  let lastError: unknown = null;

  for (let repairAttempt = 1; repairAttempt <= TEXT_REPAIR_ATTEMPTS; repairAttempt += 1) {
    const repairPrompt: string = invalidJsonText
      ? [
          invalidSchemaError
            ? "The previous repair attempt returned JSON that still failed schema validation."
            : "The previous repair attempt still returned invalid JSON.",
          invalidSchemaError ? `Schema validation error: ${invalidSchemaError}` : null,
          invalidJsonError ? `JSON parse error: ${invalidJsonError}` : null,
          "Repair the following content into one valid JSON value that matches the schema exactly.",
          "Return exactly one valid JSON value and nothing else.",
          "",
          truncateRepairText(invalidJsonText),
          "",
          `JSON schema for ${input.schemaName}:`,
          stringifyUnicodeSafe(resolvedSchema),
        ]
          .filter(Boolean)
          .join("\n")
      : [
          input.prompt,
          "",
          `Return one valid JSON value matching this JSON schema for ${input.schemaName}:`,
          stringifyUnicodeSafe(resolvedSchema),
        ].join("\n");

    try {
      const repairResult: Awaited<ReturnType<typeof generateText>> = await throttleOpenAiRequest(
        () =>
          generateText({
            model: input.model,
            system: [
              input.system,
              "",
              "Your previous answer could not be parsed as valid structured output.",
              "Return exactly one valid JSON value and nothing else.",
              "Do not use markdown code fences.",
              "Every required field in the JSON schema must be present.",
              "Use empty arrays instead of omitting array fields.",
              "Use null only where the schema allows null.",
            ].join("\n"),
            prompt: repairPrompt,
            maxOutputTokens: input.maxOutputTokens ?? undefined,
            abortSignal: input.abortSignal,
            providerOptions: input.providerOptions,
          }),
        input,
      );

      invalidJsonText = repairResult.text;
      const parsedJson = parseJsonFromModelText(repairResult.text);
      invalidJsonError = null;
      invalidSchemaError = null;
      return input.schema.parse(parsedJson) as z.infer<TSchema>;
    } catch (error) {
      lastError = error;

      if (input.isStopError?.(error)) {
        throw error;
      }

      if (isSchemaValidationError(error)) {
        invalidSchemaError = summarizeSchemaValidationError(error);
        invalidJsonError = null;
        continue;
      }

      invalidSchemaError = null;
      invalidJsonError = error instanceof Error ? error.message : String(error);
    }
  }

  throw toStructuredOutputError(lastError);
}

export async function generateStructuredObjectWithRepair<TSchema extends z.ZodTypeAny>(
  input: StructuredObjectRepairInput<TSchema>,
) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    if (input.abortSignal?.aborted) {
      throw createAbortErrorFromOptions(input)(resolveAbortMessage(input));
    }

    try {
      const result = await throttleOpenAiRequest(
        () =>
          generateObject({
            model: input.model,
            schema: input.schema,
            schemaName: input.schemaName,
            schemaDescription: input.schemaDescription,
            system: input.system,
            prompt: input.prompt,
            maxOutputTokens: input.maxOutputTokens ?? undefined,
            abortSignal: input.abortSignal,
            providerOptions: input.providerOptions,
          }),
        input,
      );

      return result.object as z.infer<TSchema>;
    } catch (error) {
      lastError = error;

      if (input.isStopError?.(error)) {
        throw error;
      }

      const attemptedRepair = isStructuredParseError(error);

      if (attemptedRepair) {
        try {
          return await repairStructuredObjectViaText(input);
        } catch (repairError) {
          lastError = repairError;

          if (input.isStopError?.(repairError)) {
            throw repairError;
          }
        }
      }

      const retryError = lastError ?? error;
      const shouldRetry = attemptedRepair || isRetryableOpenAiError(retryError);

      if (!shouldRetry || attempt >= input.maxAttempts) {
        throw toStructuredOutputError(retryError);
      }

      const message = describeStructuredOutputError(retryError);
      const hintedDelayMs = extractRetryDelayMs(message);
      const fallbackDelayMs = Math.min(12_000, 1_250 * 2 ** (attempt - 1));
      const jitterMs = Math.floor(Math.random() * 600);

      await sleepWithAbort((hintedDelayMs ?? fallbackDelayMs) + jitterMs, input);
    }
  }

  throw toStructuredOutputError(lastError);
}
