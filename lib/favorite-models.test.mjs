import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  MAX_FAVORITE_MODELS,
  addFavoriteModel,
  favoriteThinkingLabel,
  getFavoriteModels,
  removeFavoriteModel,
  setFavoriteModels,
} = await jiti.import("./favorite-models.ts");

function memoryStorage(initial) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
  };
}

const sonnet = { provider: "anthropic", modelId: "claude-sonnet-4-6", thinkingLevel: "high" };

test("round-trips saved pairs and drops unknown reasoning levels", () => {
  const storage = memoryStorage();
  setFavoriteModels([sonnet], storage);
  assert.deepEqual(getFavoriteModels(storage), [sonnet]);

  const corrupt = memoryStorage(JSON.stringify([{ provider: "a", modelId: "b", thinkingLevel: "turbo" }, null, 3]));
  assert.deepEqual(getFavoriteModels(corrupt), [{ provider: "a", modelId: "b", thinkingLevel: null }]);
  assert.deepEqual(getFavoriteModels(memoryStorage("not json")), []);
});

test("stops at five entries and replaces the same model instead of duplicating it", () => {
  let entries = [];
  for (let index = 0; index < MAX_FAVORITE_MODELS; index += 1) {
    entries = addFavoriteModel(entries, { provider: "p", modelId: `m${index}`, thinkingLevel: "low" });
  }
  assert.equal(entries.length, MAX_FAVORITE_MODELS);
  assert.equal(addFavoriteModel(entries, { provider: "p", modelId: "extra", thinkingLevel: null }), entries);
  // A model already saved keeps its slot and takes the new level.
  assert.deepEqual(addFavoriteModel(entries.slice(0, 2), sonnet).at(-1), sonnet);
  assert.deepEqual(
    addFavoriteModel([{ provider: "p", modelId: "m0", thinkingLevel: "low" }], { provider: "p", modelId: "m0", thinkingLevel: "max" }),
    [{ provider: "p", modelId: "m0", thinkingLevel: "max" }],
  );
});

test("removes by provider/model key and labels a pinned level through the map", () => {
  const entries = addFavoriteModel([sonnet], { provider: "openai", modelId: "gpt-5.5", thinkingLevel: null });
  assert.deepEqual(removeFavoriteModel(entries, "anthropic/claude-sonnet-4-6"), [
    { provider: "openai", modelId: "gpt-5.5", thinkingLevel: null },
  ]);
  assert.equal(favoriteThinkingLabel(null, null), "auto");
  assert.equal(favoriteThinkingLabel("high", { high: "ultra" }), "ultra");
  assert.equal(favoriteThinkingLabel("high", { high: "high" }), "high");
});
