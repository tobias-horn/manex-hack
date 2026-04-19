export type ClusteringMode =
  | "current"
  | "deterministic"
  | "hypothesis"
  | "investigate"
  | "dummy";

export function parseClusteringMode(value: string | string[] | undefined): ClusteringMode {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (
    normalized === "deterministic" ||
    normalized === "hypothesis" ||
    normalized === "investigate" ||
    normalized === "dummy"
  ) {
    return normalized;
  }

  return "current";
}

export function buildClusteringModeQuery(mode: ClusteringMode) {
  return `pipeline=${mode}`;
}

export function buildClusteringModeHref(path: string, mode: ClusteringMode) {
  return `${path}${path.includes("?") ? "&" : "?"}${buildClusteringModeQuery(mode)}`;
}
