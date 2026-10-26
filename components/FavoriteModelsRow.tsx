"use client";

import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ModelSelectorOption } from "./ModelSelector";
import { favoriteModelKey, favoriteThinkingLabel, type FavoriteModel } from "@/lib/favorite-models";

interface FavoriteModelsRowProps {
  entries: FavoriteModel[];
  current: { provider: string; modelId: string } | null;
  currentThinkingLevel: FavoriteModel["thinkingLevel"];
  thinkingLevelMap?: Record<string, string | null> | null;
  options: ModelSelectorOption[];
  /** `undefined` hides the row's controls (no live session to switch). */
  onApply?: (provider: string, modelId: string, thinkingLevel: FavoriteModel["thinkingLevel"]) => void;
  onAdd?: (entry: FavoriteModel) => void;
  onRemove?: (key: string) => void;
  canAdd: boolean;
  disabled?: boolean;
}

const chipStyle = (active: boolean, dimmed: boolean, dashed = false): CSSProperties => ({
  display: "flex", alignItems: "center", gap: 4,
  height: 26, padding: "0 8px", maxWidth: 220,
  background: active ? "var(--bg-selected)" : "none",
  border: `1px ${dashed ? "dashed" : "solid"} color-mix(in srgb, var(--border) 72%, transparent)`,
  borderRadius: 8, color: dimmed ? "var(--text-dim)" : active ? "var(--text)" : "var(--text-muted)",
  cursor: dimmed ? "not-allowed" : "pointer", fontSize: 11,
  overflow: "hidden", whiteSpace: "nowrap",
});

/** The composer's saved model + reasoning pairs, one click each, stored per browser. */
export function FavoriteModelsRow({
  entries, current, currentThinkingLevel, thinkingLevelMap, options, onApply, onAdd, onRemove, canAdd, disabled = false,
}: FavoriteModelsRowProps) {
  const { t } = useI18n();
  if (!onApply || !onAdd || !onRemove) return null;
  if (entries.length === 0 && !canAdd) return null;

  return (
    <div className="chat-favorite-models" style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, flexWrap: "wrap", opacity: disabled ? 0.5 : 1 }}>
      {entries.map((entry) => {
        const key = favoriteModelKey(entry);
        const option = options.find((item) => item.provider === entry.provider && item.modelId === entry.modelId);
        const active = current !== null && favoriteModelKey(current) === key
          && (entry.thinkingLevel === null || entry.thinkingLevel === currentThinkingLevel);
        const level = favoriteThinkingLabel(entry.thinkingLevel, thinkingLevelMap);
        return (
          <span key={key} style={chipStyle(active, !option)}>
            <button
              type="button"
              disabled={disabled || !option}
              title={option ? `${option.provider}/${option.modelId} · ${level}` : t("chat.favoriteModelUnavailable", { model: key })}
              onClick={() => option && onApply(entry.provider, entry.modelId, entry.thinkingLevel)}
              style={{ background: "none", border: "none", padding: 0, color: "inherit", font: "inherit", cursor: "inherit", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {option?.name ?? entry.modelId}
              <span style={{ color: "var(--text-dim)", marginLeft: 4 }}>{level}</span>
            </button>
            <button
              type="button"
              title={t("chat.favoriteModelRemove")}
              aria-label={t("chat.favoriteModelRemove")}
              onClick={() => onRemove(key)}
              style={{ background: "none", border: "none", padding: 0, width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", cursor: "pointer" }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12" /><path d="m18 6-12 12" />
              </svg>
            </button>
          </span>
        );
      })}
      {canAdd && current && (
        <button
          type="button"
          disabled={disabled}
          title={t("chat.favoriteModelAdd")}
          aria-label={t("chat.favoriteModelAdd")}
          onClick={() => onAdd({ ...current, thinkingLevel: currentThinkingLevel })}
          style={{ ...chipStyle(false, false, true), padding: "0 7px" }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  );
}
