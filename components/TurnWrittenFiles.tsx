"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTurnFileCounts } from "@/hooks/useTurnFileCounts";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import type { TurnDiffRef } from "@/lib/turn-diff";
import type { WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";

const DEFAULT_VISIBLE_FILES = 3;

function LineCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flexShrink: 0, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
      <span style={{ color: "#4ade80" }}>+{additions}</span>
      <span style={{ color: "#f87171" }}>-{deletions}</span>
    </span>
  );
}

/** What undoing one row left: a message, and whether the row can be tried again. */
export interface UndoOutcome { message: string; retryable?: boolean }

/**
 * A turn's written files, in a card below its answer. The list and each row's
 * counts are the turn's own net change against its baseline (`lib/turn-baseline.ts`)
 * — the same patch a row opens, and every file the turn changed whatever wrote
 * it, a shell command or a subagent included, not just the write tools.
 * Three rows show by default; the rest are one disclosure away.
 *
 * With `onUndoFile` a row can undo that write. The server refuses when it kept
 * no copy of the file or the file changed since (`lib/file-snapshots.ts`); the
 * row then says why and drops its button, since a retry cannot change that.
 *
 * shortcut: the button is offered for every turn, and a turn recorded before
 * snapshots existed (or one whose snapshot was archived away) answers
 * "no snapshot" on the first click. Gating on the session's snapshot list would
 * cost a request and a refetch per turn; upgrade if that click proves common.
 */
export function TurnWrittenFiles({ files, turn, cwd, onOpenFileDiff, onUndoFile }: {
  files: WrittenFile[];
  /** The turn these files belong to: its baseline diff supplies the list and counts. */
  turn?: TurnDiffRef;
  cwd?: string;
  /** Given means a row opens that file's turn diff in the preview pane. */
  onOpenFileDiff?: (filePath: string, turn?: TurnDiffRef) => void;
  /** Given means a row offers to undo its write. */
  onUndoFile?: (filePath: string) => Promise<UndoOutcome>;
}) {
  const { t } = useI18n();
  // The server's list for this turn (a shell command's or a subagent's writes
  // included); the transcript's own list when the turn has no baseline.
  const countedFiles = useTurnFileCounts(files, turn) ?? files;
  const [expanded, setExpanded] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, UndoOutcome & { undone?: boolean }>>({});
  if (countedFiles.length === 0) return null;

  const undo = async (filePath: string) => {
    if (!onUndoFile || undoing) return;
    setUndoing(filePath);
    try {
      const outcome = await onUndoFile(filePath);
      if (outcome.retryable) setOutcomes((previous) => ({ ...previous, [filePath]: outcome }));
      else setOutcomes((previous) => ({ ...previous, [filePath]: { ...outcome, undone: true } }));
    } catch (error) {
      setOutcomes((previous) => ({ ...previous, [filePath]: { message: error instanceof Error ? error.message : String(error), retryable: true } }));
    } finally {
      setUndoing(null);
    }
  };

  const additions = countedFiles.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = countedFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const hiddenCount = Math.max(0, countedFiles.length - DEFAULT_VISIBLE_FILES);
  const visibleFiles = expanded ? countedFiles : countedFiles.slice(0, DEFAULT_VISIBLE_FILES);

  return (
    <section
      aria-label={t("chat.filesWritten")}
      style={{
        marginTop: 10,
        overflow: "hidden",
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-panel)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--text)", fontSize: 13 }}>{t("chat.editedFiles", { count: countedFiles.length })}</div>
          {(additions > 0 || deletions > 0) && (
            <div style={{ marginTop: 2, fontSize: 12 }}><LineCounts additions={additions} deletions={deletions} /></div>
          )}
        </div>
        <span style={{ flexShrink: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("chat.viewChangesHint")}</span>
      </div>

      <div>
        {visibleFiles.map((file, index) => {
          const name = getFileName(file.filePath);
          const relativePath = getRelativeFilePath(file.filePath, cwd);
          const directory = relativePath.endsWith(name)
            ? relativePath.slice(0, relativePath.length - name.length)
            : relativePath;
          const counted = file.additions !== undefined || file.deletions !== undefined;
          const outcome = outcomes[file.filePath];
          const canRetry = outcome && !outcome.undone;
          return (
            <div
              key={file.filePath}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                borderTop: index === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <button
                type="button"
                title={file.filePath}
                aria-label={t("chat.viewWrittenFileDiff", { name })}
                disabled={!onOpenFileDiff}
                onClick={() => onOpenFileDiff?.(file.filePath, turn)}
                style={{
                  display: "flex",
                  flex: 1,
                  minWidth: 0,
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  color: "var(--text)",
                  background: "none",
                  border: "none",
                  textAlign: "left",
                  opacity: outcome?.undone ? 0.5 : 1,
                  cursor: onOpenFileDiff ? "pointer" : "default",
                }}
              >
                {getFileIcon(name, 14)}
                <span style={{ display: "flex", flex: 1, minWidth: 0, alignItems: "baseline", fontSize: 12 }}>
                  <span style={{ overflow: "hidden", color: "var(--text-muted)", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", unicodeBidi: "plaintext" }}>{directory}</span>
                  <span style={{ flexShrink: 0 }}>{name}</span>
                </span>
                {counted && <LineCounts additions={file.additions ?? 0} deletions={file.deletions ?? 0} />}
              </button>
              {outcome && !canRetry ? (
                <span style={{ flexShrink: 0, padding: "0 12px", color: "var(--text-muted)", fontSize: 12 }}>{outcome.message}</span>
              ) : onUndoFile ? (
                <button
                  type="button"
                  title={canRetry ? outcome.message : t("chat.undoWrittenFile", { name })}
                  aria-label={t("chat.undoWrittenFile", { name })}
                  disabled={undoing !== null}
                  onClick={() => void undo(file.filePath)}
                  style={{
                    flexShrink: 0,
                    maxWidth: "50%",
                    marginRight: 6,
                    padding: "4px 8px",
                    overflow: "hidden",
                    color: canRetry ? "#d97706" : "var(--text-muted)",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 12,
                    cursor: undoing ? "default" : "pointer",
                    opacity: undoing === file.filePath ? 0.5 : 1,
                  }}
                >
                  {canRetry ? outcome.message : t("chat.undo")}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          style={{
            display: "block",
            width: "100%",
            padding: "8px 12px",
            color: "var(--text-muted)",
            background: "none",
            border: "none",
            borderTop: "1px solid var(--border)",
            textAlign: "left",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {expanded ? t("chat.showFewerFiles") : t("chat.showMoreFiles", { count: hiddenCount })}
        </button>
      )}
    </section>
  );
}
