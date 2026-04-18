import { getManexDatasetSmokeTest } from "@/lib/manex-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await getManexDatasetSmokeTest();

  return Response.json(report, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
