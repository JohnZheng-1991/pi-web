import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The wrapper records under the agent dir; keep that out of ~/.pi.
const agentDir = realpathSync(mkdtempSync(join(tmpdir(), "pi-web-turn-agent-")));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CEILING_DIRECTORIES = tmpdir();

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { listTurnChanges } = await jiti.import("./turn-baseline.ts");

/** A wrapper over a fake SDK session whose events the test emits itself. */
function startWrapper(cwd, entries) {
  let listener = () => {};
  const inner = {
    sessionId: "turn-baseline-session",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
    modelRuntime: { getModel: () => undefined, refresh: async () => {} },
    sessionManager: { getCwd: () => cwd, getEntries: () => entries() },
    settingsManager: { setProjectTrusted: () => {}, getDefaultTools: () => undefined },
    agent: { state: {} },
    extensionRunner: { getRegisteredCommands: () => [], setUIContext: () => {}, emit: async () => {} },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe: (next) => { listener = next; return () => { listener = () => {}; }; },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    getActiveToolNames: () => [],
    getAllTools: () => [],
    setActiveToolsByName: () => {},
    pendingMessageCount: 0,
    dispose: () => {},
    reload: async () => {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  return { wrapper, emit: (event) => listener(event) };
}

function repo() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-web-turn-repo-")));
  execFileSync("git", ["-C", cwd, "init", "-q"]);
  writeFileSync(join(cwd, "a.txt"), "one\n");
  execFileSync("git", ["-C", cwd, "-c", "user.email=a@b", "-c", "user.name=a", "add", "-A"]);
  execFileSync("git", ["-C", cwd, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "init"]);
  return cwd;
}

async function eventually(check) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test("a run's user message records the tree its turn starts from", async (t) => {
  const cwd = repo();
  const entries = [{ type: "message", id: "user-entry", message: { role: "user", content: "go" } }];
  const { wrapper, emit } = startWrapper(cwd, () => entries);
  t.after(() => wrapper.destroy());

  emit({ type: "agent_start" });
  emit({ type: "message_start", message: { role: "user" } });
  assert.deepEqual(wrapper.attachParentTurn(), { sessionId: "turn-baseline-session", turnId: "user-entry" });
  // The read is not awaited by the event, as the run must not wait on git.
  assert.ok(await eventually(() => existsSync(join(agentDir, "pi-web-turn-baselines", "turn-baseline-session"))), "baseline recorded");
  assert.equal(readdirSync(join(agentDir, "pi-web-turn-baselines", "turn-baseline-session")).length, 1);

  // What the turn did afterwards, whatever wrote it.
  writeFileSync(join(cwd, "a.txt"), "one\ntwo\n");
  assert.deepEqual(await listTurnChanges("turn-baseline-session", "user-entry"), [
    { path: join(cwd, "a.txt"), additions: 1, deletions: 0 },
  ]);
});

test("a turn outside a repository records nothing, and its card falls back", async (t) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-web-turn-plain-")));
  const { wrapper, emit } = startWrapper(cwd, () => [{ type: "message", id: "plain-entry", message: { role: "user", content: "go" } }]);
  t.after(() => wrapper.destroy());

  emit({ type: "agent_start" });
  emit({ type: "message_start", message: { role: "user" } });
  assert.equal(await listTurnChanges("turn-baseline-session", "plain-entry"), null);
});
