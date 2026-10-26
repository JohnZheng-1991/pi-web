import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { captureTurnBaseline, listTurnChanges, recordTurnBaseline, turnFilePatch, clearTurnBaselines } =
  await jiti.import("./turn-baseline.ts");

// Keep the machine's git configuration (and a repository above the temp dir)
// out of the fixture's answers, as lib/file-tree-visibility.test.mjs does.
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-turn-baseline-")));
const agentDir = path.join(tempRoot, "agent");
fs.writeFileSync(path.join(tempRoot, "gitconfig"), "");
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = path.join(tempRoot, "gitconfig");
process.env.GIT_CEILING_DIRECTORIES = tempRoot;
test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, "-c", "user.email=a@b", "-c", "user.name=a", ...args], { stdio: "ignore" });
}

let fixtureCount = 0;
/** A repository with one committed file, and the paths a turn then writes. */
function repo(files = {}) {
  const root = path.join(tempRoot, `repo-${++fixtureCount}`);
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, ".gitignore"), ".next/\n");
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\nthree\n");
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), content);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

function writeFile(root, name, content) {
  const filePath = path.join(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

test("a turn's changes cover any way a file was written, not only the write tools", async (t) => {
  const root = repo();
  const baseline = await captureTurnBaseline(root);
  assert.ok(baseline);
  recordTurnBaseline("session-1", "turn-1", baseline, agentDir);
  t.after(() => clearTurnBaselines(["session-1"], agentDir));

  // What a shell command, a code formatter or an MCP server does: no write tool.
  const edited = writeFile(root, "a.txt", "one\nfinal\nthree\n");
  const created = writeFile(root, "src/script.ts", "export const x = 1;\n");
  writeFile(root, "gone.txt", "bye\n");
  fs.rmSync(path.join(root, "gone.txt"));
  fs.mkdirSync(path.join(root, ".next"), { recursive: true });
  writeFile(root, ".next/build.js", "ignored\n");

  const changes = await listTurnChanges("session-1", "turn-1", agentDir);
  assert.deepEqual(changes, [
    { path: edited, additions: 1, deletions: 1 },
    { path: created, additions: 1, deletions: 0 },
  ]);
  const patch = await turnFilePatch("session-1", "turn-1", edited, agentDir);
  assert.match(patch ?? "", /-two\n\+final/);
  // The card's count and the patch it opens are the same diff.
  assert.equal((patch ?? "").split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length, 1);
  // An ignored file is nobody's change.
  assert.equal((await listTurnChanges("session-1", "turn-1", agentDir))?.some((change) => change.path.includes(".next")), false);
});

test("a turn that changed nothing, and one with no baseline", async (t) => {
  const root = repo();
  const baseline = await captureTurnBaseline(root);
  assert.ok(baseline);
  recordTurnBaseline("session-2", "turn-1", baseline, agentDir);
  t.after(() => clearTurnBaselines(["session-2"], agentDir));

  assert.deepEqual(await listTurnChanges("session-2", "turn-1", agentDir), []);
  assert.equal(await turnFilePatch("session-2", "turn-1", path.join(root, "a.txt"), agentDir), null);
  // No baseline: null, so the card falls back to the transcript's own list.
  assert.equal(await listTurnChanges("session-2", "turn-2", agentDir), null);

  const plain = path.join(tempRoot, `plain-${++fixtureCount}`);
  fs.mkdirSync(plain, { recursive: true });
  assert.equal(await captureTurnBaseline(plain), null);
});

test("undo copies and the turn's diff do not share storage", async (t) => {
  const root = repo();
  const baseline = await captureTurnBaseline(root);
  assert.ok(baseline);
  recordTurnBaseline("session-3", "turn-1", baseline, agentDir);
  t.after(() => clearTurnBaselines(["session-3"], agentDir));

  writeFile(root, "a.txt", "changed\n");
  assert.equal(fs.existsSync(path.join(agentDir, "pi-web-turn-baselines", "session-3")), true);
  assert.equal(fs.existsSync(path.join(agentDir, "pi-web-file-snapshots")), false);
});
