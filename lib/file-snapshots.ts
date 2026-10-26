import { createHash } from "node:crypto";

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { applyPatchPreviewToFiles, getApplyPatchInputText, parseApplyPatchInput } from "./apply-patch";
import { resolveLocalFilePath } from "./file-links";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { readRegularFileText } from "./regular-file";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "./tool-names";

/**
 * The content a file had before a tool wrote it, kept so the chat can undo
 * that write. Storage is pi-web's own state, under the agent dir, never
 * in the project: it is a copy of the user's code and is dropped when the
 * session it belongs to is deleted or archived.
 *
 * One entry per file per session: the earliest `before` seen, and the newest
 * `after` a tool left behind. Undo restores `before` only while the file still
 * holds that `after`, so a later hand edit or another tool's write refuses
 * rather than overwrite the user's work.
 *
 * A turn's own diff does not come from here: a tool-name allowlist missed every
 * other way a file changes, so the card and the viewer read git against the
 * turn's baseline instead (`lib/turn-baseline.ts`).
 */

/** A file larger than this is not copied: undo is refused for it rather than filling the disk. */
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
/** Entries one session keeps; the oldest are dropped first. */
const MAX_SNAPSHOTS_PER_SESSION = 200;

interface SnapshotEntry {
  /** Absolute path of the file this entry can restore. */
  path: string;
  /** Contents before the earliest recorded write; null when the file did not exist then. */
  before: string | null;
  /** Contents the newest recorded write left; null when it deleted the file. */
  after: string | null;
  createdAt: number;
}

export interface TurnFileSnapshot { before: string | null; after: string | null }

/** Files this tool call writes, as absolute paths. Empty for other tools. */
export function snapshotTargetPaths(
  toolName: string,
  args: unknown,
  cwd: string,
): string[] {
  const isCodeTool = isWriteToolName(toolName) || isEditToolName(toolName);
  if (!isCodeTool && !isApplyPatchToolName(toolName)) return [];
  const paths: string[] = [];
  if (isCodeTool) {
    const value = (args as Record<string, unknown> | undefined)?.file_path ?? (args as Record<string, unknown> | undefined)?.path;
    if (typeof value === "string" && value.length > 0) paths.push(value);
  } else {
    const files = applyPatchPreviewToFiles((args as Record<string, unknown> | undefined)?.preview)
      ?? parseApplyPatchInput(getApplyPatchInputText(args));
    for (const file of files ?? []) {
      const target = file.newPath ?? file.oldPath;
      if (target) paths.push(target);
    }
  }
  const resolved: string[] = [];
  for (const path of paths) {
    const absolute = resolveLocalFilePath(path, cwd);
    if (absolute && !resolved.includes(absolute)) resolved.push(absolute);
  }
  return resolved;
}

/** A file's text, or undefined when it is missing, unreadable, binary or too large to copy. */
function readText(path: string): string | null | undefined {
  try {
    if (!existsSync(path)) return null;
    const text = readRegularFileText(path, MAX_SNAPSHOT_BYTES);
    // Undefined means something is there that `readRegularFileText` refused, and a NUL byte means binary.
    if (text === undefined || text.includes("\u0000")) return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function sessionDir(sessionId: string, agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web-file-snapshots", sessionId);
}

function entryPath(sessionId: string, entry: SnapshotEntry, agentDir?: string): string {
  const digest = createHash("sha256").update(entry.path).digest("hex").slice(0, 16);
  return join(sessionDir(sessionId, agentDir), `${digest}-${entry.createdAt}.json`);
}

function readEntries(sessionId: string, agentDir?: string): Array<SnapshotEntry & { file: string }> {
  const dir = sessionDir(sessionId, agentDir);
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const entries: Array<SnapshotEntry & { file: string }> = [];
  for (const name of names) {
    const file = join(dir, name);
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as SnapshotEntry;
      if (typeof parsed?.path !== "string") continue;
      entries.push({
        path: parsed.path,
        before: typeof parsed.before === "string" ? parsed.before : null,
        after: typeof parsed.after === "string" ? parsed.after : null,
        createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
        file,
      });
    } catch {
      // A half-written or hand-edited entry is dropped on the next write; it can restore nothing.
    }
  }
  return entries;
}

function writeEntry(sessionId: string, entry: SnapshotEntry, agentDir?: string): void {
  const dir = sessionDir(sessionId, agentDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(entryPath(sessionId, entry, agentDir), JSON.stringify(entry));
}

/** The file's text before this tool call runs, for `commitWriteSnapshot` to pair with what it leaves. */
export function captureBefore(path: string): string | null | undefined {
  return readText(path);
}

/**
 * Records what a successful `write`/`edit`/`apply_patch` did to one of its
 * files, so it can be undone. A write that changed nothing is not recorded, and
 * a file it could not read (binary, too large) gets no entry.
 */
export function commitWriteSnapshot(
  sessionId: string,
  path: string,
  before: string | null | undefined,
  agentDir?: string,
): void {
  if (before === undefined) return;
  const after = readText(path);
  if (after === undefined || (before === after)) return;
  const entries = readEntries(sessionId, agentDir);
  const existing = entries.find((candidate) => candidate.path === path);
  writeEntry(sessionId, {
    path,
    before: existing?.before ?? before,
    after,
    createdAt: existing?.createdAt ?? Date.now(),
  }, agentDir);
  pruneSession(sessionId, agentDir);
}

function pruneSession(sessionId: string, agentDir?: string): void {
  const entries = readEntries(sessionId, agentDir).sort((a, b) => a.createdAt - b.createdAt);
  for (const entry of entries.slice(0, Math.max(0, entries.length - MAX_SNAPSHOTS_PER_SESSION))) {
    try { unlinkSync(entry.file); } catch { /* already gone */ }
  }
}

/** Paths of the files this session can still undo. */
export function listUndoableFiles(sessionId: string, agentDir?: string): string[] {
  return readEntries(sessionId, agentDir).map((entry) => entry.path);
}

export type UndoRefusal = "no_snapshot" | "conflict" | "forbidden" | "failed";

export interface UndoResult {
  ok: boolean;
  reason?: UndoRefusal;
  /** Whether undoing removed the file instead of restoring text. */
  deleted?: boolean;
}

/**
 * Restores one file to its pre-write contents, or deletes it when the write
 * created it. Refuses when the file no longer holds what that write left: the
 * user or another tool changed it since, and that change is theirs.
 */
export async function undoFileWrite(sessionId: string, filePath: string, agentDir?: string): Promise<UndoResult> {
  // The session-long copy: one per file, the earliest before and the newest after.
  const entry = readEntries(sessionId, agentDir).find((candidate) => candidate.path === filePath);
  if (!entry) return { ok: false, reason: "no_snapshot" };
  // A write to the user's project: authorize the path exactly as a file read does.
  if (!isExistingFilePathAllowed(filePath, await getAllowedFileRoots())) return { ok: false, reason: "forbidden" };

  const current = readText(filePath);
  if (current === undefined || current !== entry.after) return { ok: false, reason: "conflict" };

  try {
    if (entry.before === null) {
      rmSync(filePath, { force: true });
    } else {
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, entry.before, "utf8");
    }
  } catch {
    return { ok: false, reason: "failed" };
  }
  try { unlinkSync(entry.file); } catch { /* already gone */ }
  return { ok: true, deleted: entry.before === null };
}


/** Drops every snapshot of these sessions; deleting or archiving a session frees the space. */
export function clearSessionSnapshots(sessionIds: Iterable<string>, agentDir?: string): number {
  let cleared = 0;
  for (const sessionId of new Set(sessionIds)) {
    const dir = sessionDir(sessionId, agentDir);
    try {
      const count = readdirSync(dir).length;
      rmSync(dir, { recursive: true, force: true });
      cleared += count;
    } catch {
      // Never there: nothing to free.
    }
  }
  return cleared;
}
