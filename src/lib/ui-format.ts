import { format, formatDistanceToNowStrict } from "date-fns";

const toValidDate = (value: Date | string | null | undefined) => {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const normalizeUiIdentifier = (value: string | null | undefined) => {
  const normalized = value?.replace(/\s+/g, "").trim().toUpperCase();
  return normalized ? normalized : null;
};

export function formatUiDateTime(
  value: Date | string | null | undefined,
  fallback = "Unknown",
) {
  const date = toValidDate(value);
  return date ? format(date, "dd MMM yyyy, HH:mm") : fallback;
}

export function formatUiDate(
  value: Date | string | null | undefined,
  fallback = "Unknown",
) {
  const date = toValidDate(value);
  return date ? format(date, "dd MMM yyyy") : fallback;
}

export function formatUiShortDay(
  value: Date | string | null | undefined,
  fallback = "--",
) {
  const date = toValidDate(value);
  return date ? format(date, "dd MMM") : fallback;
}

export function formatUiWeekStamp(
  value: Date | string | null | undefined,
  fallback = "KW --",
) {
  const date = toValidDate(value);
  return date ? `KW ${format(date, "II")}` : fallback;
}

export function formatUiRelative(
  value: Date | string | null | undefined,
  fallback = "Unknown",
) {
  const date = toValidDate(value);
  return date
    ? formatDistanceToNowStrict(date, { addSuffix: true })
    : fallback;
}
