import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * A turn's written files, taken from git rather than from the tools that ran.
 * The turn begins by recording what the working tree held (a tree object built
 * from an index of its own, so the user's index and worktree are untouched);
 * afterwards the diff between that tree and the current one is the turn's own
 * changes, whatever wrote them — `write`, `edit`, `apply_patch`, a shell
 * command, a formatter, an MCP server, or a subagent sharing the tree. A
 * tool-name allowlist always missed the rest (#turn-diff).
 *
 * Only one repository is covered: the cwd's. A file written outside it, or in
 * a nested checkout, is not in the diff — the card then falls back to the
 * transcript's own list, without counts.
 */

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

const execFileAsync = promisify(execFile);

export interface TurnBaseline {
  /** The repository the tree was read from, and whose objects hold it. */
  root: string;
  /** The working tree's contents when the turn began. */
  tree: string;
  /** Where the turn's commands ran; the diff is limited to it. */
  cwd: string;
}

export interface TurnChange {
  /** Absolute path of the changed file. */
  path: string;
  additions: number;
  deletions: number;
}

async function git(cwd: string, args: string[], indexFile?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, "-c", "core.fsmonitor=false", ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, ...(indexFile ? { GIT_INDEX_FILE: indexFile } : {}), LC_ALL: "C" },
  });
  return stdout;
}

/**
 * The cwd's files as a tree object. An index of its own, so staging never
 * touches the user's: `git add -A` would otherwise fill the real one.
 *
 * shortcut: `git add -A` reads every file under the cwd, so a turn in a very
 * large checkout pays for it (tens of ms here, seconds in a monorepo); upgrade
 * to a `git status`-driven walk if that shows up.
 */
async function snapshotTree(cwd: string): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-turn-index-"));
  const indexFile = join(dir, "index");
  try {
    await git(cwd, ["add", "--all", "--", "."], indexFile);
    const tree = (await git(cwd, ["write-tree"], indexFile)).trim();
    return tree || null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The working tree as it stands now, for a turn whose baseline is already known. */
export async function captureTurnBaseline(cwd: string): Promise<TurnBaseline | null> {
  try {
    const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    if (!root) return null;
    const tree = await snapshotTree(cwd);
    return tree ? { root, tree, cwd } : null;
  } catch {
    return null;
  }
}

function baselineDir(sessionId: string, agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web-turn-baselines", sessionId);
}

function baselinePath(sessionId: string, turnId: string, agentDir?: string): string {
  const digest = createHash("sha256").update(turnId).digest("hex").slice(0, 16);
  return join(baselineDir(sessionId, agentDir), `${digest}.json`);
}

/** Keeps a turn's baseline, which the card and the viewer read back later. */
export function recordTurnBaseline(sessionId: string, turnId: string, baseline: TurnBaseline, agentDir?: string): void {
  mkdirSync(baselineDir(sessionId, agentDir), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(baselinePath(sessionId, turnId, agentDir), JSON.stringify(baseline));
}

// A turn's baseline never changes once written, and a card asks for it twice
// (counts, then the patch of a row) — remember it for the process's lifetime.
const baselineCache = new Map<string, TurnBaseline>();

function readBaseline(sessionId: string, turnId: string, agentDir?: string): TurnBaseline | null {
  const key = `${agentDir ?? ""}\n${sessionId}\n${turnId}`;
  const cached = baselineCache.get(key);
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(baselinePath(sessionId, turnId, agentDir), "utf8")) as Partial<TurnBaseline>;
    if (typeof parsed.root !== "string" || typeof parsed.tree !== "string" || typeof parsed.cwd !== "string") return null;
    const baseline = { root: parsed.root, tree: parsed.tree, cwd: parsed.cwd };
    baselineCache.set(key, baseline);
    return baseline;
  } catch {
    return null;
  }
}

function toGitPath(filePath: string): string {
  return filePath.split("\\").join("/");
}

function splitZeroSeparated(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

/**
 * The turn's changes, from its baseline tree to the working tree as it stands.
 * Null when the turn has no baseline (a plain folder, or a turn recorded before
 * baselines existed): the caller then has nothing better than the transcript.
 */
export async function listTurnChanges(sessionId: string, turnId: string, agentDir?: string): Promise<TurnChange[] | null> {
  const baseline = readBaseline(sessionId, turnId, agentDir);
  if (!baseline) return null;
  const current = await snapshotTree(baseline.cwd);
  if (!current) return null;
  try {
    const output = await git(baseline.root, [
      "diff",
      "--no-renames",
      "--numstat",
      "-z",
      baseline.tree,
      current,
    ]);
    const changes: TurnChange[] = [];
    for (const record of splitZeroSeparated(output)) {
      // `<added>\t<deleted>\t<path>`; a binary file reports `-` for both.
      const [added, deleted, ...rest] = record.split("\t");
      const relative = rest.join("\t");
      if (!relative) continue;
      changes.push({
        path: join(baseline.root, relative),
        additions: Number(added) || 0,
        deletions: Number(deleted) || 0,
      });
    }
    return changes;
  } catch {
    return null;
  }
}

/** One file's patch between the turn's baseline and now, or null when it did not change. */
export async function turnFilePatch(
  sessionId: string,
  turnId: string,
  filePath: string,
  agentDir?: string,
): Promise<string | null> {
  const baseline = readBaseline(sessionId, turnId, agentDir);
  if (!baseline) return null;
  const current = await snapshotTree(baseline.cwd);
  if (!current) return null;
  const relative = toGitPath(filePath).startsWith(toGitPath(baseline.root))
    ? toGitPath(filePath).slice(toGitPath(baseline.root).length + 1)
    : null;
  if (relative === null) return null;
  try {
    const patch = await git(baseline.root, ["diff", "--no-color", "--no-ext-diff", "--unified=3", baseline.tree, current, "--", relative]);
    return patch.includes("\n@@ ") || patch.startsWith("Binary files") ? patch : null;
  } catch {
    return null;
  }
}

/** Drops these sessions' baselines; a deleted or archived session frees the space. */
export function clearTurnBaselines(sessionIds: Iterable<string>, agentDir?: string): void {
  for (const sessionId of new Set(sessionIds)) {
    rmSync(baselineDir(sessionId, agentDir), { recursive: true, force: true });
  }
}
