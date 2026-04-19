export type ClusteringMode = "current" | "deterministic" | "hypothesis";

export function parseClusteringMode(value: string | string[] | undefined): ClusteringMode {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized === "deterministic" || normalized === "hypothesis") {
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
