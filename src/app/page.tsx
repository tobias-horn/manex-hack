import { redirect } from "next/navigation";

import { buildClusteringModeHref, parseClusteringMode } from "@/lib/manex-clustering-mode";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const mode = parseClusteringMode(params.pipeline);

  redirect(buildClusteringModeHref("/articles", mode));
}
