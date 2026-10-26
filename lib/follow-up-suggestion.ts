import { getSupportedThinkingLevels, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildTitleTranscript, resolveTitleThinkingLevel } from "./session-title";

export const FOLLOW_UP_SUGGESTION_LANGUAGES = ["auto", "en", "zh-CN", "zh-TW"] as const;
export type FollowUpSuggestionLanguage = typeof FOLLOW_UP_SUGGESTION_LANGUAGES[number];
export type FollowUpSuggestionThinking = "auto" | ThinkingLevel;

const LANGUAGE_INSTRUCTIONS: Record<Exclude<FollowUpSuggestionLanguage, "auto">, string> = {
  en: "Write the suggestion in English.",
  "zh-CN": "Write the suggestion in Simplified Chinese.",
  "zh-TW": "Write the suggestion in Traditional Chinese.",
};

export function parseFollowUpSuggestion(raw: string): string {
  let value = raw.trim();
  const fenced = value.match(/^```(?:text|markdown)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();
  value = value.replace(/^(?:suggestion|next prompt|后续提示词|後續提示詞)\s*[:：-]\s*/i, "");
  value = value.split(/\r?\n/, 1)[0] ?? "";
  value = value.replace(/^["'“「『]|["'”」』]$/g, "").replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(value)) throw new Error("The model did not return a usable follow-up suggestion");
  const characters = Array.from(value);
  return characters.length > 160 ? characters.slice(0, 160).join("").trim() : value;
}

export function resolveSuggestionThinking(model: Model<Api>, level: FollowUpSuggestionThinking): ThinkingLevel {
  if (level !== "auto") return level;
  if (!model.reasoning) return "off";
  // Title uses "off" for a supported cheap level; suggestions must omit it explicitly.
  const automatic = resolveTitleThinkingLevel(model);
  return automatic === "off" && getSupportedThinkingLevels(model).includes("minimal") ? "minimal" : automatic;
}

export async function generateFollowUpSuggestion(
  runtime: ModelRuntime,
  input: {
    provider: string;
    modelId: string;
    messages: AgentMessage[];
    thinkingLevel: FollowUpSuggestionThinking;
    language: FollowUpSuggestionLanguage;
  },
  signal: AbortSignal,
): Promise<string> {
  const model = runtime.getModel(input.provider, input.modelId);
  if (!model) throw new Error("Unknown suggestion model");
  const transcript = buildTitleTranscript(input.messages);
  if (!transcript) throw new Error("The session has no usable text");
  const language = input.language === "auto"
    ? "Match the language of the latest user message."
    : LANGUAGE_INSTRUCTIONS[input.language];
  const response: AssistantMessage = await runtime.completeSimple(model, {
    systemPrompt: "You suggest the user's next prompt from a coding chat transcript. Suggest one useful, concrete next action, not a reply to the assistant. Do not call tools.",
    messages: [{ role: "user", content: [{ type: "text", text: `${transcript}\n\nSuggest the next user prompt. ${language} Keep it on one line and return only plain text, without a label, quotes, markdown, or explanation.` }], timestamp: Date.now() }],
  }, {
    cacheRetention: "none",
    maxRetries: 0,
    maxTokens: 160,
    ...(resolveSuggestionThinking(model, input.thinkingLevel) !== "off"
      ? { reasoning: resolveSuggestionThinking(model, input.thinkingLevel) as Exclude<ThinkingLevel, "off"> } : {}),
    signal,
  });
  if (response.stopReason === "error") throw new Error(response.errorMessage || "The suggestion model request failed");
  if (response.stopReason === "aborted") throw new Error("The suggestion model request was aborted");
  return parseFollowUpSuggestion(response.content.reduce((text, block) => (
    block.type === "text" ? `${text}${block.text}\n` : text
  ), ""));
}
