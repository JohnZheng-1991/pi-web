/**
 * Review comments on a file's selected lines, carried into the composer as one
 * message. Client-safe and pure so the format is testable: the composer text is
 * what the agent acts on, so the file, the line range and the selected source
 * all have to survive the trip (`lib/line-comments.test.mjs`).
 *
 * The source is quoted because the file may have changed by the time the
 * message is sent, and because the agent then knows what the comment refers to
 * without a read.
 */

/** One comment, as the comment box on the viewer's selection produces it. */
export interface LineComment {
  /** Path as the chat's @ mention writes it: relative to the session's cwd. */
  relativePath: string;
  startLine: number;
  endLine: number;
  /** The selected source, already clamped. */
  snippet: string;
  /** What the user typed. */
  comment: string;
}

/** A selection can be a whole file: past this the quote stops carrying meaning. */
export const MAX_COMMENT_SNIPPET_CHARS = 2000;

/** "12" for one line, "12-14" for a range, ordered. */
export function lineRangeLabel(startLine: number, endLine: number): string {
  const first = Math.max(1, Math.min(startLine, endLine));
  const last = Math.max(1, Math.max(startLine, endLine));
  return first === last ? String(first) : `${first}-${last}`;
}

/** The selection's text, bounded, with the cut marked so the agent knows it is partial. */
export function clampSnippet(text: string, max = MAX_COMMENT_SNIPPET_CHARS): string {
  const trimmed = text.replace(/\s+$/, "");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n…`;
}

/**
 * A fence the quoted source cannot close by accident: one backtick longer than
 * the longest run inside it, never shorter than three.
 */
function fenceFor(snippet: string): string {
  const longest = Math.max(0, ...(snippet.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * The composer text: an opening line, then one numbered entry per comment with
 * its `@path:lines` mention, the quoted source, and the user's comment. Entries
 * stay unindented — a list item's continuation lines would have to be indented
 * too, and the raw source must not be.
 */
export function buildLineCommentsMessage(
  comments: readonly LineComment[],
  labels: { intro: string; commentLabel: string },
): string {
  const entries = comments.map((lineComment, index) => {
    const mention = `${lineComment.relativePath.includes(" ") ? `@"${lineComment.relativePath}"` : `@${lineComment.relativePath}`}:${lineRangeLabel(lineComment.startLine, lineComment.endLine)}`;
    const fence = fenceFor(lineComment.snippet);
    return [
      `${index + 1}. ${mention}`,
      `${fence}`,
      lineComment.snippet,
      fence,
      `${labels.commentLabel}${lineComment.comment}`,
    ].join("\n");
  });
  return [labels.intro, ...entries].join("\n\n");
}
