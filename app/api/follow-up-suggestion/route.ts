import { NextResponse } from "next/server";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getModelRuntimeWithExtensions } from "@/lib/model-runtime";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  FOLLOW_UP_SUGGESTION_LANGUAGES,
  generateFollowUpSuggestion,
  type FollowUpSuggestionLanguage, type FollowUpSuggestionThinking,
} from "@/lib/follow-up-suggestion";

export const dynamic = "force-dynamic";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_TRANSCRIPT_BYTES = 64_000;
const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  if (Number(req.headers.get("content-length")) > MAX_TRANSCRIPT_BYTES) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let body: { provider?: unknown; modelId?: unknown; messages?: unknown; thinkingLevel?: unknown; language?: unknown };
  try {
    const text = await req.text();
    if (Buffer.byteLength(text) > MAX_TRANSCRIPT_BYTES) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.provider !== "string" || typeof body.modelId !== "string" || !Array.isArray(body.messages)
    || typeof body.thinkingLevel !== "string" || !THINKING_LEVELS.includes(body.thinkingLevel)
    || typeof body.language !== "string" || !FOLLOW_UP_SUGGESTION_LANGUAGES.includes(body.language as FollowUpSuggestionLanguage)) {
    return NextResponse.json({ error: "Invalid suggestion request" }, { status: 400 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  req.signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const runtime = await getModelRuntimeWithExtensions();
    const suggestion = await generateFollowUpSuggestion(runtime, {
      provider: body.provider,
      modelId: body.modelId,
      messages: body.messages as AgentMessage[],
      thinkingLevel: body.thinkingLevel as FollowUpSuggestionThinking,
      language: body.language as FollowUpSuggestionLanguage,
    }, controller.signal);
    return NextResponse.json({ suggestion });
  } catch (error) {
    if (controller.signal.aborted) return NextResponse.json({ error: "Suggestion request aborted" }, { status: 499 });
    console.error("Follow-up suggestion failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Suggestion failed" }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
