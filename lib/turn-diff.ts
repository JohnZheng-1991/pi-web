import type { GitFileDiffResponse } from "./git-types";

/**
 * The turn a written file's diff belongs to: the user message's entry id, which
 * the chat and the server both use to group a turn. The server lists the turn's
 * own files from its git baseline, so no file list travels with the reference.
 */
export interface TurnDiffRef {
  sessionId: string;
  turnId: string;
}

export interface TurnDiffCounts {
  supported: boolean;
  path: string;
  additions: number;
  deletions: number;
}

export interface TurnDiffResult extends GitFileDiffResponse {
  supported: boolean;
}

/** One route answers both the card's file list with its counts, and a row's patch. */
export function getTurnDiffUrl(turn: TurnDiffRef, target?: string): string {
  const params = new URLSearchParams({ turnId: turn.turnId });
  if (target) params.set("path", target);
  return `/api/sessions/${encodeURIComponent(turn.sessionId)}/turn-diff?${params}`;
}
