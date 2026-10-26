import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseFollowUpSuggestion, resolveSuggestionThinking } = await jiti.import("./follow-up-suggestion.ts");

test("cleans a generated follow-up suggestion and bounds its length", () => {
  assert.equal(parseFollowUpSuggestion("后续提示词：继续修复重连问题"), "继续修复重连问题");
  assert.equal(parseFollowUpSuggestion('```text\n"Run the focused tests"\n```'), "Run the focused tests");
  assert.equal(parseFollowUpSuggestion("first line\nsecond line"), "first line");
  assert.equal(Array.from(parseFollowUpSuggestion("测".repeat(200))).length, 160);
  assert.throws(() => parseFollowUpSuggestion("---"), /usable follow-up suggestion/);
});

test("uses the selected reasoning level or a cheap supported automatic level", () => {
  assert.equal(resolveSuggestionThinking({ reasoning: false }, "auto"), "off");
  assert.equal(resolveSuggestionThinking({ reasoning: true, id: "model" }, "high"), "high");
  assert.equal(resolveSuggestionThinking({ reasoning: true, id: "model" }, "auto"), "minimal");
  assert.equal(resolveSuggestionThinking({ reasoning: true, id: "model", thinkingLevelMap: { off: null, minimal: null } }, "auto"), "low");
});
