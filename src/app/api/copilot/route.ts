import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";

import { capabilities, env } from "@/lib/env";
import {
  buildCopilotContext,
  getWorkspaceSnapshot,
} from "@/lib/quality-workspace";

export const runtime = "nodejs";

const promptSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
});

const systemPrompt = `
You are the Manex Forensic Lens copilot.

Write for manufacturing engineers and quality managers.
Stay evidence-led, concise, and technically calm.
Never invent facts. If certainty is limited, say so directly.

Preferred structure:
1. Likely signal cluster
2. Evidence
3. Recommended next moves
4. Draft language the team can paste into an 8D or corrective-action note
`.trim();

function buildFallbackResponse(prompt: string, context: string) {
  return [
    "Likely signal cluster",
    "The current workspace is centered on four known quality stories, with the strongest emphasis on the supplier batch incident and the thermal design claim trail.",
    "",
    "Evidence",
    context,
    "",
    "Recommended next moves",
    `Use the prompt "${prompt}" to frame a concise action memo. Start with supplier containment or design review depending on whether the evidence trail is dominated by in-factory defects or lagged field claims.`,
    "",
    "Draft note",
    "Open an 8D with a factual symptom statement, attach the relevant batch or claim-lag evidence, and assign one owner for containment plus one owner for verification.",
  ].join("\n");
}

export async function POST(request: Request) {
  const parsed = promptSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json(
      { error: "Please provide a prompt for the copilot." },
      { status: 400 },
    );
  }

  const snapshot = await getWorkspaceSnapshot();
  const context = buildCopilotContext(snapshot);

  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    return Response.json({
      mode: "demo",
      text: buildFallbackResponse(parsed.data.prompt, context),
    });
  }

  try {
    const openai = createOpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    const result = await generateText({
      model: openai(env.OPENAI_MODEL),
      system: systemPrompt,
      prompt: `Workspace snapshot:\n${context}\n\nUser request:\n${parsed.data.prompt}`,
      temperature: 0.2,
    });

    return Response.json({
      mode: "live",
      text: result.text,
    });
  } catch (error) {
    console.error("Copilot request failed:", error);

    return Response.json({
      mode: "demo",
      text: buildFallbackResponse(parsed.data.prompt, context),
    });
  }
}
