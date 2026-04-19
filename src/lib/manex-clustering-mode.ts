export type ClusteringMode = "current" | "deterministic";

export function parseClusteringMode(value: string | string[] | undefined): ClusteringMode {
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized === "deterministic" ? "deterministic" : "current";
}

export function buildClusteringModeQuery(mode: ClusteringMode) {
  return `pipeline=${mode}`;
}

export function buildClusteringModeHref(path: string, mode: ClusteringMode) {
  return `${path}${path.includes("?") ? "&" : "?"}${buildClusteringModeQuery(mode)}`;
}
