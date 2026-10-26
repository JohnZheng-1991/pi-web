export interface FollowUpSuggestionSettings {
  enabled: boolean;
  model: { provider: string; modelId: string } | null;
  thinkingLevel: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  language: "auto" | "en" | "zh-CN" | "zh-TW";
}

export const DEFAULT_FOLLOW_UP_SUGGESTION_SETTINGS: FollowUpSuggestionSettings = {
  enabled: true,
  model: null,
  thinkingLevel: "auto",
  language: "auto",
};

const STORAGE_KEY = "pi-web-follow-up-suggestion";
const LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"];
const LANGUAGES = ["auto", "en", "zh-CN", "zh-TW"];

export function loadFollowUpSuggestionSettings(): FollowUpSuggestionSettings {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<FollowUpSuggestionSettings> | null;
    if (!value) return DEFAULT_FOLLOW_UP_SUGGESTION_SETTINGS;
    return {
      enabled: value.enabled !== false,
      model: typeof value.model?.provider === "string" && typeof value.model.modelId === "string" ? value.model : null,
      thinkingLevel: typeof value.thinkingLevel === "string" && LEVELS.includes(value.thinkingLevel) ? value.thinkingLevel : "auto",
      language: typeof value.language === "string" && LANGUAGES.includes(value.language) ? value.language : "auto",
    };
  } catch {
    return DEFAULT_FOLLOW_UP_SUGGESTION_SETTINGS;
  }
}

export function saveFollowUpSuggestionSettings(settings: FollowUpSuggestionSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The in-memory setting still works when browser storage is unavailable.
  }
}
