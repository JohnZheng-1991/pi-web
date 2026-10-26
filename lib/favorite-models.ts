/**
 * The composer's quick-pick row: a model plus the reasoning level it is used at,
 * per browser. Session choices stay session-scoped, so this is a shortcut list,
 * not a settings.json default.
 */

const STORAGE_KEY = "pi-favorite-models";
export const MAX_FAVORITE_MODELS = 5;

export const FAVORITE_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type FavoriteThinkingLevel = (typeof FAVORITE_THINKING_LEVELS)[number];

export interface FavoriteModel {
  provider: string;
  modelId: string;
  /** `null`: the entry keeps whatever reasoning level the session has. */
  thinkingLevel: FavoriteThinkingLevel | null;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function favoriteModelKey(entry: { provider: string; modelId: string }): string {
  return `${entry.provider}/${entry.modelId}`;
}

function parseEntry(raw: unknown): FavoriteModel | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.provider !== "string" || !value.provider) return null;
  if (typeof value.modelId !== "string" || !value.modelId) return null;
  const level = value.thinkingLevel;
  return {
    provider: value.provider,
    modelId: value.modelId,
    thinkingLevel: FAVORITE_THINKING_LEVELS.includes(level as FavoriteThinkingLevel)
      ? (level as FavoriteThinkingLevel)
      : null,
  };
}

export function getFavoriteModels(storage: StorageLike | null = getBrowserStorage()): FavoriteModel[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const entries: FavoriteModel[] = [];
    const seen = new Set<string>();
    for (const raw of parsed) {
      const entry = parseEntry(raw);
      if (!entry) continue;
      const key = favoriteModelKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
      if (entries.length === MAX_FAVORITE_MODELS) break;
    }
    return entries;
  } catch {
    // Browser storage is best-effort; a corrupt value reads as "no favorites".
    return [];
  }
}

export function setFavoriteModels(
  entries: FavoriteModel[],
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_FAVORITE_MODELS)));
  } catch {
    // Browser storage is best-effort.
  }
}

/** Saves the pair; the same model is updated in place, so one model holds one level. */
export function addFavoriteModel(entries: FavoriteModel[], entry: FavoriteModel): FavoriteModel[] {
  const key = favoriteModelKey(entry);
  const index = entries.findIndex((item) => favoriteModelKey(item) === key);
  if (index >= 0) {
    const next = [...entries];
    next[index] = entry;
    return next;
  }
  return entries.length >= MAX_FAVORITE_MODELS ? entries : [...entries, entry];
}

export function removeFavoriteModel(entries: FavoriteModel[], key: string): FavoriteModel[] {
  return entries.filter((item) => favoriteModelKey(item) !== key);
}

/** Re-labels a favorite when its level was pinned per model (`enabledModels` `:level`). */
export function favoriteThinkingLabel(
  level: FavoriteThinkingLevel | null,
  thinkingLevelMap: Record<string, string | null> | null | undefined,
): string {
  if (!level) return "auto";
  const mapped = thinkingLevelMap?.[level];
  return mapped && mapped !== level ? mapped : level;
}
