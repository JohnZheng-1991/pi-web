"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { lineRangeLabel, type LineComment } from "@/lib/line-comments";
import { listenForStackedDialogEscape } from "@/lib/stacked-dialog";

/** A comment the user has staged but not sent, in the order it was made. */
export interface StagedLineComment extends LineComment {
  /** Stable identity for keys and removal; the same lines can be commented twice. */
  id: string;
}

const PANEL_WIDTH = 320;

/**
 * The comment box a right-click on a file selection opens: the selected lines
 * are quoted above a text field, and the comment joins the staged list rather
 * than the composer (so several can be collected and sent as one message).
 *
 * Escape closes it without staging (`listenForStackedDialogEscape`), so it can
 * sit above the viewer without the viewer's own Esc handling firing too.
 */
export function LineCommentBox({ draft, onStage, onCancel }: {
  draft: { relativePath: string; startLine: number; endLine: number; snippet: string; top: number; left: number };
  onStage: (comment: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
    return listenForStackedDialogEscape(document, onCancel);
  }, [onCancel]);

  const submit = useCallback(() => {
    const text = comment.trim();
    if (!text) return;
    onStage(text);
    setComment("");
  }, [comment, onStage]);

  // Kept inside the viewport; only ever rendered after a click, so on the client.
  const top = Math.min(draft.top, Math.max(8, window.innerHeight - 220));
  const left = Math.max(8, Math.min(draft.left, window.innerWidth - PANEL_WIDTH - 8));

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label={t("files.commentLines", { range: lineRangeLabel(draft.startLine, draft.endLine) })}
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 280,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: `min(${PANEL_WIDTH}px, calc(100vw - 16px))`,
        padding: 10,
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-panel)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", color: "var(--text-muted)", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
          {draft.relativePath}:{lineRangeLabel(draft.startLine, draft.endLine)}
        </span>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("i18n.close")}
          title={t("i18n.close")}
          style={{ flexShrink: 0, padding: 2, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <pre
        aria-hidden="true"
        style={{
          maxHeight: 96,
          margin: 0,
          overflow: "auto",
          padding: "6px 8px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          whiteSpace: "pre",
        }}
      >
        {draft.snippet}
      </pre>

      <textarea
        ref={textareaRef}
        value={comment}
        rows={3}
        placeholder={t("files.commentPlaceholder")}
        aria-label={t("files.commentPlaceholder")}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "6px 8px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "inherit",
          fontSize: 12,
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button type="button" onClick={onCancel} style={buttonStyle}>{t("i18n.cancel")}</button>
        <button type="button" onClick={submit} disabled={!comment.trim()} style={{ ...buttonStyle, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", opacity: comment.trim() ? 1 : 0.5 }}>
          {t("files.addComment")}
        </button>
      </div>
    </div>
  );
}

const buttonStyle = {
  padding: "4px 10px",
  color: "var(--text)",
  background: "none",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
} as const;

/**
 * The staged comments, docked above the viewer's content. They are written into
 * the composer in one go (`buildLineCommentsMessage`), which is why they are
 * collected here rather than inserted as they are made.
 */
export function StagedCommentsBar({ comments, onRemove, onClear, onInsert }: {
  comments: readonly StagedLineComment[];
  onRemove: (id: string) => void;
  onClear: () => void;
  /** Writes every staged comment into the composer; absent with no composer yet. */
  onInsert?: () => void;
}) {
  const { t } = useI18n();
  if (comments.length === 0) return null;

  return (
    <section
      aria-label={t("files.stagedComments", { count: comments.length })}
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxHeight: "40vh",
        padding: "8px 10px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, color: "var(--text)" }}>{t("files.stagedComments", { count: comments.length })}</span>
        <button type="button" onClick={onClear} style={buttonStyle}>{t("files.clearComments")}</button>
        <button
          type="button"
          onClick={onInsert}
          disabled={!onInsert}
          style={{ ...buttonStyle, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", opacity: onInsert ? 1 : 0.5 }}
        >
          {t("files.insertComments")}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" }}>
        {comments.map((comment) => (
          <div key={comment.id} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
              <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {comment.relativePath}:{lineRangeLabel(comment.startLine, comment.endLine)}
              </span>
              <span style={{ color: "var(--text)" }}> {comment.comment}</span>
            </span>
            <button
              type="button"
              onClick={() => onRemove(comment.id)}
              title={t("files.removeComment")}
              aria-label={t("files.removeComment")}
              style={{ flexShrink: 0, padding: 0, color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
