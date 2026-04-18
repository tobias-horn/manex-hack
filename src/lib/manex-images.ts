import { env } from "@/lib/env";

const normalizeImagePath = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();

  if (!text || text === "null" || text === "undefined") {
    return null;
  }

  return text;
};

const hasAbsoluteProtocol = (value: string) =>
  /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);

const stripBasePathPrefix = (path: string, baseUrl: URL) => {
  const basePath = baseUrl.pathname.replace(/\/+$/, "");

  if (!basePath || basePath === "/") {
    return path.replace(/^\/+/, "");
  }

  const normalizedBasePath = basePath.replace(/^\/+/, "");
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;

  if (withLeadingSlash === basePath) {
    return "";
  }

  if (withLeadingSlash.startsWith(`${basePath}/`)) {
    return withLeadingSlash.slice(basePath.length + 1);
  }

  if (path === normalizedBasePath) {
    return "";
  }

  if (path.startsWith(`${normalizedBasePath}/`)) {
    return path.slice(normalizedBasePath.length + 1);
  }

  return path.replace(/^\/+/, "");
};

const normalizeDatasetImagePath = (path: string) => {
  if (path.startsWith("/defect_images/") && /\.(jpe?g)$/i.test(path)) {
    return path.replace(/\.(jpe?g)$/i, ".png");
  }

  return path;
};

export const resolveManexImageUrl = (value: string | null | undefined) => {
  const normalized = normalizeImagePath(value);

  if (!normalized) {
    return null;
  }

  const normalizedPath = normalizeDatasetImagePath(normalized);

  if (hasAbsoluteProtocol(normalizedPath)) {
    try {
      return new URL(normalizedPath).toString();
    } catch {
      return null;
    }
  }

  if (!env.MANEX_ASSET_BASE_URL) {
    return null;
  }

  try {
    const baseUrl = new URL(env.MANEX_ASSET_BASE_URL);
    const relativePath = stripBasePathPrefix(normalizedPath, baseUrl);

    if (!baseUrl.pathname.endsWith("/")) {
      baseUrl.pathname = `${baseUrl.pathname}/`;
    }

    return new URL(relativePath, baseUrl).toString();
  } catch {
    return null;
  }
};
