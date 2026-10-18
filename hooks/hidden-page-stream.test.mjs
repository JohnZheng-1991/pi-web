import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// A page hidden for HIDDEN_PAGE_GRACE_MS lets go of the selected session's idle
// event stream (#1283): over HTTP/1.1 every open stream holds one of the
// browser's six connections per origin, shared by all tabs. A run, a subagent
// left to finish or a quick tab switch keeps it; the page's return reopens it
// and shows what the server has under way.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(shimPath);
const { useAgentSession } = await jiti.import("./useAgentSession.ts");
const { HIDDEN_PAGE_GRACE_MS } = await jiti.import("./usePageHidden.ts");
const { canReleaseHiddenEventStream, HIDDEN_RELEASE_CHECK_TIMEOUT_MS } = await jiti.import("../lib/agent-event-connection.ts");

const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
globalThis.document = page;
globalThis.window ??= new EventTarget();

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const settle = async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve)); };
const setVisibility = (state) => {
  page.visibilityState = state;
  page.dispatchEvent(new Event("visibilitychange"));
};

async function setup() {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const sources = [];
  const requests = [];
  // What GET /api/agent/s1 and the session's state read report; tests change it.
  // `answer` turns the idle check into one that never answers (it only ends when
  // aborted), a network failure or an HTTP error.
  const server = { running: true, state: { isStreaming: false, isPromptRunning: false }, subagentsActive: false, answer: "json" };
  globalThis.EventSource = class {
    readyState = 0;
    onmessage = null;
    onerror = null;
    constructor(url) { this.url = url; sources.push(this); }
    close() { this.readyState = 2; }
    emit(event) {
      this.readyState = 1;
      this.onmessage?.({ data: JSON.stringify(event) });
    }
  };
  globalThis.fetch = async (url, init = {}) => {
    requests.push(url);
    if (url.startsWith("/api/models")) return json({ models: {}, modelList: [] });
    if (url.startsWith("/api/sessions/s1?")) {
      return json({ filePath: "/s1.jsonl", leafId: null, tree: [], treeFormat: "summary", context: { messages: [], entryIds: [], oldestEntryId: null, hasMore: false } });
    }
    if (url === "/api/sessions/s1/state") return json({ running: server.running, state: server.state });
    if (url === "/api/agent/s1/lease") return json({ success: true, renewed: 1 });
    if (url === "/api/agent/s1" && init.body) return json({ success: true, data: null });
    if (url === "/api/agent/s1" && server.answer === "never") {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    if (url === "/api/agent/s1" && server.answer === "offline") throw new TypeError("Failed to fetch");
    if (url === "/api/agent/s1" && server.answer === "error") return new Response("boom", { status: 500 });
    if (url === "/api/agent/s1") return json(server);
    return json({});
  };
  const ends = [];
  const hook = renderHook(useAgentSession, {
    session: { id: "s1", cwd: "/project", path: "/s1.jsonl", name: "s1" },
    onAgentEnd: (end) => ends.push(end),
  });
  await settle();
  hook.flush();
  const open = () => sources.filter((source) => source.readyState !== 2);
  // GET /api/agent/s1 also reads usage on connect; count only the ones since hiding.
  let mark = 0;
  const hide = () => { mark = requests.length; setVisibility("hidden"); };
  const checks = () => requests.slice(mark).filter((url) => url === "/api/agent/s1").length;
  const reads = () => requests.filter((url) => url.startsWith("/api/sessions/s1?")).length;
  const tick = async (ms) => { mock.timers.tick(ms); await settle(); hook.flush(); };
  return { hook, sources, requests, server, open, checks, reads, ends, tick, hide };
}

async function teardown(state) {
  setVisibility("visible");
  state.hook.unmount();
  for (const source of state.sources) source.close();
  mock.timers.reset();
  await settle();
}

async function connectIdle(state, extra = {}) {
  state.open()[0].emit({ type: "connected", sessionId: "s1", isStreaming: false, ...extra });
  await settle();
  state.hook.flush();
}

test("a page hidden past the grace closes the idle stream and its return reopens it", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS - 1);
    assert.equal(state.open().length, 1, "the grace keeps it");
    await state.tick(1);
    assert.equal(state.open().length, 0, "the hidden page holds no agent stream");
    await state.tick(HIDDEN_PAGE_GRACE_MS * 3);
    assert.equal(state.open().length, 0, "nothing reopens it while hidden");

    const reads = state.reads();
    setVisibility("visible");
    assert.equal(state.open().length, 1, "the page's return opens the stream again");
    await settle();
    assert.equal(state.reads(), reads + 1, "and reads the session it may have missed");
    assert.equal(state.sources.length, 2);
  } finally {
    await teardown(state);
  }
});

test("a quick tab switch keeps the stream and reads nothing", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    const reads = state.reads();
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS / 2);
    setVisibility("visible");
    await state.tick(HIDDEN_PAGE_GRACE_MS * 2);
    assert.equal(state.sources.length, 1);
    assert.equal(state.open().length, 1);
    assert.equal(state.reads(), reads);
    assert.equal(state.checks(), 0, "no idle check either");
  } finally {
    await teardown(state);
  }
});

test("a subagent left to finish keeps the stream, checked again each grace", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.server.subagentsActive = true;
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.checks(), 1);
    assert.equal(state.open().length, 1, "its end starts a turn here");
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.checks(), 2);
    assert.equal(state.open().length, 1);
    state.server.subagentsActive = false;
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0);
  } finally {
    await teardown(state);
  }
});

test("a check that never answers (queued behind a full pool) releases once it times out", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.server.answer = "never";
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.checks(), 1);
    assert.equal(state.open().length, 1, "still waiting for the answer");
    await state.tick(HIDDEN_RELEASE_CHECK_TIMEOUT_MS);
    assert.equal(state.open().length, 0, "no answer in time reads as a starved pool");
    assert.equal(state.checks(), 1);
  } finally {
    await teardown(state);
  }
});

test("no network releases; an error reply keeps the stream and checks again", async () => {
  const offline = await setup();
  try {
    await connectIdle(offline);
    offline.server.answer = "offline";
    offline.hide();
    await offline.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(offline.open().length, 0);
  } finally {
    await teardown(offline);
  }
  const failing = await setup();
  try {
    await connectIdle(failing);
    failing.server.answer = "error";
    failing.hide();
    await failing.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(failing.open().length, 1);
    failing.server.answer = "json";
    await failing.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(failing.checks(), 2);
    assert.equal(failing.open().length, 0);
  } finally {
    await teardown(failing);
  }
});

test("a running session keeps its stream while hidden and lets go a grace after it settles", async () => {
  const state = await setup();
  try {
    const source = state.open()[0];
    source.emit({ type: "connected", sessionId: "s1", isStreaming: true });
    await settle();
    state.hook.flush();
    assert.equal(state.hook.result.agentRunning, true);

    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS * 2);
    assert.deepEqual(state.open(), [source], "the run's events still arrive");

    source.emit({ type: "agent_settled" });
    assert.equal(state.ends.length, 1, "the completion reaches the page through the stream");
    await settle();
    state.hook.flush();
    assert.equal(state.hook.result.agentRunning, false);
    assert.deepEqual(state.open(), [source], "a follow-up right after it still arrives");
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0, "the settled session's stream is let go");
  } finally {
    await teardown(state);
  }
});

test("the server's own run at the end of the grace keeps the stream", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    // A session opened in a background tab whose run the page has not seen yet.
    state.server.state = { isStreaming: false, isPromptRunning: true };
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.checks(), 1);
    assert.equal(state.open().length, 1);
  } finally {
    await teardown(state);
  }
});

test("the return shows a command, a ! command and a compaction the server has under way", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0);

    state.server.state = { isStreaming: false, isPromptRunning: true, isBashRunning: true, isCompacting: true };
    setVisibility("visible");
    await settle();
    state.hook.flush();
    assert.equal(state.hook.result.agentRunning, true);
    assert.equal(state.hook.result.agentPhase?.kind, "running_command");
    assert.equal(state.hook.result.bashRunning, true);
    assert.equal(state.hook.result.isCompacting, true);
  } finally {
    await teardown(state);
  }
});

test("a pending extension dialog keeps the stream of a hidden page", async () => {
  const state = await setup();
  try {
    await connectIdle(state, { pendingExtensionUiIds: [] });
    const source = state.open()[0];
    source.emit({ type: "extension_ui_request", id: "ui-1", method: "confirm", title: "Proceed?", message: "" });
    await settle();
    state.hook.flush();
    assert.equal(state.hook.result.extensionDialog?.id, "ui-1");

    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS * 2);
    assert.deepEqual(state.open(), [source]);
    assert.equal(state.checks(), 0);
  } finally {
    await teardown(state);
  }
});

test("only a reply with nothing under way and no subagent left releases", () => {
  assert.equal(canReleaseHiddenEventStream({ running: false }), true);
  assert.equal(canReleaseHiddenEventStream({ running: true, state: {} }), true);
  assert.equal(canReleaseHiddenEventStream({ running: false, subagentsActive: true }), false);
  for (const busy of ["isStreaming", "isPromptRunning", "isBashRunning", "isCompacting"]) {
    assert.equal(canReleaseHiddenEventStream({ running: true, state: { [busy]: true } }), false, busy);
  }
  assert.equal(canReleaseHiddenEventStream(null), false, "an error reply keeps the stream");
  assert.equal(canReleaseHiddenEventStream("unanswered"), true, "no answer in time (a starved pool) or no network releases");
});
