import assert from "node:assert/strict";
import test from "node:test";

const {
  buildLineCommentsMessage,
  clampSnippet,
  lineRangeLabel,
} = await import("./line-comments.ts");

const labels = { intro: "请按下面的评论修改代码：", commentLabel: "评论：" };

test("a range is ordered and a single line has no dash", () => {
  assert.equal(lineRangeLabel(12, 12), "12");
  assert.equal(lineRangeLabel(12, 14), "12-14");
  assert.equal(lineRangeLabel(14, 12), "12-14");
  assert.equal(lineRangeLabel(0, 0), "1");
});

test("one comment carries its path, line range, source and comment", () => {
  const message = buildLineCommentsMessage([{
    relativePath: "src/app.ts",
    startLine: 12,
    endLine: 14,
    snippet: "const x = getUser(id)\nif (!x) return null",
    comment: "这里应该用 await",
  }], labels);

  assert.equal(message, [
    "请按下面的评论修改代码：",
    "",
    "1. @src/app.ts:12-14",
    "```",
    "const x = getUser(id)",
    "if (!x) return null",
    "```",
    "评论：这里应该用 await",
  ].join("\n"));
});

test("comments accumulate as numbered entries", () => {
  const message = buildLineCommentsMessage([
    { relativePath: "a.ts", startLine: 1, endLine: 1, snippet: "one", comment: "first" },
    { relativePath: "b.ts", startLine: 8, endLine: 8, snippet: "two", comment: "second" },
  ], labels);

  assert.match(message, /^请按下面的评论修改代码：\n\n1\. @a\.ts:1\n/);
  assert.match(message, /\n\n2\. @b\.ts:8\n```\ntwo\n```\n评论：second$/);
});

test("a path with a space is quoted like the chat's @ mention", () => {
  const message = buildLineCommentsMessage([
    { relativePath: "project files/a.md", startLine: 3, endLine: 3, snippet: "x", comment: "y" },
  ], labels);

  assert.match(message, /@\*?"project files\/a\.md":3/);
});

test("a snippet with a fence uses a longer one, so it cannot close early", () => {
  const message = buildLineCommentsMessage([
    { relativePath: "a.md", startLine: 1, endLine: 1, snippet: "```js\ncode\n```", comment: "x" },
  ], labels);

  assert.match(message, /\n````\n```js\ncode\n```\n````\n/);
});

test("a long snippet is cut and marked as partial", () => {
  const long = "a".repeat(2000) + "b".repeat(50);
  const clamped = clampSnippet(long);
  assert.ok(clamped.length < long.length);
  assert.ok(clamped.endsWith("\n…"));
});

test("no comments produces only the opening line", () => {
  assert.equal(buildLineCommentsMessage([], labels), "请按下面的评论修改代码：");
});
