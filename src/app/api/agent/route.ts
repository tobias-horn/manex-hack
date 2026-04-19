import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import { agentTools } from "@/lib/agent-tools";
import { capabilities, env } from "@/lib/env";
import { MANEX_AGENT_SYSTEM_PROMPT } from "@/prompts/manex-agent";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!capabilities.hasAi || !env.OPENAI_API_KEY) {
    return Response.json(
      {
        error:
          "OPENAI_API_KEY is not configured on the server. Add it to .env and restart.",
      },
      { status: 503 },
    );
  }

  let body: { messages?: UIMessage[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = body?.messages ?? [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "No messages provided." }, { status: 400 });
  }

  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: openai(env.OPENAI_MODEL),
    system: MANEX_AGENT_SYSTEM_PROMPT,
    messages: modelMessages,
    tools: agentTools,
    stopWhen: stepCountIs(8),
    temperature: 0,
  });

  return result.toUIMessageStreamResponse();
}
