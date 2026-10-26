import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[id]/turn-diff/route.ts");
const { NextRequest } = await jiti.import("next/server");
const { captureTurnBaseline, recordTurnBaseline } = await jiti.import("../../../lib/turn-baseline.ts");
const { invalidateSessionListCache, invalidateSessionPathCache } = await jiti.import("../../../lib/session-reader.ts");

// Keep the machine's git configuration, and any repository above the temp dir,
// out of the fixture's answers.
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CEILING_DIRECTORIES = tmpdir();

function get(id, params) {
  return GET(new NextRequest(`http://localhost/api/sessions/${id}/turn-diff?${new URLSearchParams(params)}`, {
    headers: { host: "localhost" },
  }), {
    params: Promise.resolve({ id }),
  });
}

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, "-c", "user.email=a@b", "-c", "user.name=a", ...args], { stdio: "ignore" });
}

let fixtureCount = 0;

/** A session whose cwd is a repository, plus the tree it held when turn-1 started. */
async function scratch(t) {
  const id = `turndiff${++fixtureCount}`;
  const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-turn-diff-")));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(root, "agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
  await writeFile(process.env.GIT_CONFIG_GLOBAL, "");
  invalidateSessionListCache();
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    await rm(root, { recursive: true, force: true });
  });
  const cwd = join(root, "work");
  const sessionsDir = join(agentDir, "sessions", "--work--");
  await mkdir(cwd, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(join(sessionsDir, `${id}.jsonl`), `${JSON.stringify({
    type: "session", version: 3, id, timestamp: "2026-10-24T00:00:00.000Z", cwd,
  })}\n`);
  await writeFile(join(cwd, "a.txt"), "one\ntwo\n");
  git(cwd, "init", "-q");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", "init");
  const baseline = await captureTurnBaseline(cwd);
  assert.ok(baseline);
  recordTurnBaseline(id, "turn-1", baseline, agentDir);
  return { id, cwd };
}

test("answers a turn's counts, and the same patch a row opens", async (t) => {
  const { id, cwd } = await scratch(t);
  // A shell command's write, which no write tool ever sees.
  await writeFile(join(cwd, "a.txt"), "one\nedited\n");

  assert.deepEqual(await (await get(id, { turnId: "turn-1" })).json(), [
    { supported: true, path: join(cwd, "a.txt"), additions: 1, deletions: 1 },
  ]);
  const patch = await (await get(id, { turnId: "turn-1", path: join(cwd, "a.txt") })).json();
  assert.equal(patch.supported, true);
  assert.match(patch.patch, /-two/);
  assert.match(patch.patch, /\+edited/);
});

test("lists every file the turn touched, a subagent's included", async (t) => {
  const { id, cwd } = await scratch(t);
  await writeFile(join(cwd, "a.txt"), "one\nedited\n");
  // A subagent shares the working tree, so its writes are in the same diff.
  await writeFile(join(cwd, "child.txt"), "beta\n");

  const listed = await (await get(id, { turnId: "turn-1" })).json();
  assert.deepEqual(listed.map((entry) => entry.path).sort(), [join(cwd, "a.txt"), join(cwd, "child.txt")].sort());
  assert.equal(listed.every((entry) => entry.supported), true);
  assert.match((await (await get(id, { turnId: "turn-1", path: join(cwd, "child.txt") })).json()).patch, /\+beta/);
  assert.equal((await get(id, { turnId: "turn-1", path: join(cwd, "a.txt", "x") })).status, 400);
});

test("a turn with no baseline answers no files, so the card keeps the transcript's list", async (t) => {
  const { id, cwd } = await scratch(t);
  // `[]`, not a zero count: the card then shows the transcript's own file names.
  assert.deepEqual(await (await get(id, { turnId: "turn-2" })).json(), []);
  assert.deepEqual(await (await get(id, { turnId: "turn-2", path: join(cwd, "a.txt") })).json(), []);
});

test("refuses a malformed turn, and a session it cannot find", async (t) => {
  const { id } = await scratch(t);
  assert.equal((await get(id, { turnId: "../x" })).status, 400);
  assert.equal((await get("missing-session", { turnId: "turn-1" })).status, 404);
});
