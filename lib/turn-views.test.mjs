import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getFinalAnswerViews, keepWrittenFiles } = await jiti.import("./turn-views.ts");

function finalAssistant() {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    usage: { input: 1, output: 2 },
    content: [
      { type: "thinking", thinking: "Plan" },
      { type: "toolCall", toolCallId: "t1", toolName: "write", input: { path: "a.txt" } },
      { type: "text", text: "Done." },
    ],
  };
}

test("splits a final assistant message into its process part and its answer", () => {
  const message = finalAssistant();
  const views = getFinalAnswerViews(new WeakMap(), message);

  assert.deepEqual(views.answer.content, [message.content[2]]);
  assert.deepEqual(views.answer.usage, message.usage);
  assert.deepEqual(views.process.content, message.content.slice(0, 2));
  assert.equal(views.process.usage, undefined);
  assert.notEqual(views.answer, message);
});

test("hands every render the same copies of an unchanged message, so MessageView's memo holds (#1005)", () => {
  const cache = new WeakMap();
  const message = finalAssistant();
  const first = getFinalAnswerViews(cache, message);
  const again = getFinalAnswerViews(cache, message);

  assert.equal(again, first);
  assert.equal(again.answer, first.answer);
  assert.equal(again.process, first.process);
  // A replaced message is a new object and gets its own copies.
  assert.notEqual(getFinalAnswerViews(cache, { ...message }).answer, first.answer);
});

test("keeps the written-files list while the turn wrote the same files", () => {
  const views = getFinalAnswerViews(new WeakMap(), finalAssistant());
  const first = keepWrittenFiles(views, [{ filePath: "/p/a.txt", toolCallIds: ["1"], additions: 2, deletions: 1 }]);

  assert.equal(keepWrittenFiles(views, [{ filePath: "/p/a.txt", toolCallIds: ["1"], additions: 2, deletions: 1 }]), first);
  const changed = [
    { filePath: "/p/a.txt", toolCallIds: ["1"], additions: 2, deletions: 1 },
    { filePath: "/p/b.txt", toolCallIds: ["2"] },
  ];
  assert.equal(keepWrittenFiles(views, changed), changed);
  assert.equal(keepWrittenFiles(views, []).length, 0);
});

test("a file the same turn wrote again, or whose counts landed, gets a new list", () => {
  const views = getFinalAnswerViews(new WeakMap(), finalAssistant());
  const first = keepWrittenFiles(views, [{ filePath: "/p/a.txt", toolCallIds: ["1"] }]);

  const more = [{ filePath: "/p/a.txt", toolCallIds: ["1", "2"] }];
  assert.equal(keepWrittenFiles(views, more), more);
  assert.notEqual(keepWrittenFiles(views, more), first);

  // The turn's counts arriving from their own request is the same list, decorated.
  const counted = [{ filePath: "/p/a.txt", toolCallIds: ["1", "2"], additions: 5, deletions: 1 }];
  assert.equal(keepWrittenFiles(views, counted), counted);
});
