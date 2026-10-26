import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  filterSidebarProviders,
  collectModelRenames,
  deleteProviderEntry,
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
  providerMatchesSearch,
  renameProviderEntry,
  sidebarFilterEscapeClears,
  savedModelIds,
  serializeHeaderRows,
  setCompatBool,
  setCompatFlag,
  trackAddedModels,
  updateHeaderRow,
} = await jiti.import("./models-config-helpers.ts");
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ProviderFilterInput } = await jiti.import("./ModelsConfig.tsx");

test("disabling the developer role writes an explicit false override", () => {
  assert.deepEqual(
    setCompatBool({ compat: { supportsStore: true } }, "supportsDeveloperRole", false),
    { compat: { supportsStore: true, supportsDeveloperRole: false } },
  );
});

test("switching adaptive thinking off removes the override instead of writing false", () => {
  const on = setCompatFlag({ id: "claude-opus-5-5" }, "forceAdaptiveThinking", true);
  assert.deepEqual(on, { id: "claude-opus-5-5", compat: { forceAdaptiveThinking: true } });
  assert.deepEqual(setCompatFlag(on, "forceAdaptiveThinking", false), { id: "claude-opus-5-5", compat: undefined });
  assert.deepEqual(
    setCompatFlag({ compat: { supportsStore: true, forceAdaptiveThinking: true } }, "forceAdaptiveThinking", false),
    { compat: { supportsStore: true } },
  );
});

test("a model switches off adaptive thinking its provider turns on with an explicit false", () => {
  assert.deepEqual(
    setCompatFlag({ id: "claude-haiku-4-5" }, "forceAdaptiveThinking", false, true),
    { id: "claude-haiku-4-5", compat: { forceAdaptiveThinking: false } },
  );
  const entry = { id: "claude-opus-5-5", compat: { forceAdaptiveThinking: false } };
  assert.deepEqual(setCompatFlag(entry, "forceAdaptiveThinking", true, true), { id: "claude-opus-5-5", compat: undefined });
  const plain = { id: "claude-opus-5-5" };
  assert.equal(setCompatFlag(plain, "forceAdaptiveThinking", false), plain);
});

test("editing a header preserves row order and stable identities", () => {
  const rows = [
    { id: 10, name: "X-First", value: "one" },
    { id: 11, name: "X-Second", value: "two" },
  ];
  const updated = updateHeaderRow(rows, 10, { name: "X-First-Edited" });

  assert.deepEqual(updated.map(({ id, name }) => ({ id, name })), [
    { id: 10, name: "X-First-Edited" },
    { id: 11, name: "X-Second" },
  ]);
  assert.deepEqual(serializeHeaderRows(updated), {
    "X-First-Edited": "one",
    "X-Second": "two",
  });
});

test("blank header drafts are omitted until they have a name", () => {
  const rows = [
    { id: 1, name: "X-Existing", value: "kept" },
    { id: 2, name: "", value: "draft value" },
  ];

  assert.deepEqual(serializeHeaderRows(rows), { "X-Existing": "kept" });
  assert.deepEqual(
    serializeHeaderRows(updateHeaderRow(rows, 2, { name: "X-Draft" })),
    { "X-Existing": "kept", "X-Draft": "draft value" },
  );
});

test("model cost drafts default blank prices to zero unless all are blank", () => {
  const complete = {
    input: "1.25",
    output: "10",
    cacheRead: "0.125",
    cacheWrite: "0",
  };
  assert.deepEqual(parseCompleteModelCost(complete), {
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ ...complete, input: "", cacheWrite: "" }), {
    input: 0,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ input: "1.25", output: "", cacheRead: "", cacheWrite: "" }), {
    input: 1.25,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  assert.equal(parseCompleteModelCost(modelCostToDraft()), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "not-a-price" }), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "-1" }), undefined);
  assert.equal(hasModelCostDraftValue(modelCostToDraft()), false);
  assert.equal(hasModelCostDraftValue({ ...complete, cacheWrite: "" }), true);
});

const draft = (models) => ({ providers: { stepfun: { models: models.map((id) => ({ id })) } } });

test("a model renamed in place is reported with its saved reference", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  assert.deepEqual(
    collectModelRenames(draft(["aaa", "ddd1"]), slots, new Map()),
    [{ from: "stepfun/ddd", to: "stepfun/ddd1" }],
  );
});

test("a model rename keeps the provider id the settings file still spells", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  // The panel renamed the provider too, so the slots moved with it.
  const moved = new Map([["house", slots.get("stepfun")]]);
  assert.deepEqual(
    collectModelRenames(
      { providers: { house: { models: [{ id: "aaa" }, { id: "ddd1" }] } } },
      moved,
      new Map([["stepfun", "house"]]),
    ),
    [{ from: "stepfun/ddd", to: "house/ddd1" }],
  );
});

test("added and removed models never look like a rename", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  trackAddedModels(slots, "stepfun", 1);
  assert.deepEqual(collectModelRenames(draft(["aaa", "ddd", "new"]), slots, new Map()), []);

  const spliced = savedModelIds(draft(["aaa", "ddd"]));
  spliced.get("stepfun").splice(0, 1);
  assert.deepEqual(collectModelRenames(draft(["ddd"]), spliced, new Map()), []);
});

test("a blank id in a half-typed row is not a rename yet", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  assert.deepEqual(collectModelRenames(draft(["aaa", ""]), slots, new Map()), []);
});

test("a provider added since the last save has no saved slots to compare", () => {
  assert.deepEqual(collectModelRenames(draft(["aaa"]), new Map(), new Map()), []);
});

const tracking = (config) => ({
  savedProviders: new Set(Object.keys(config.providers)),
  renames: new Map(),
  slots: savedModelIds(config),
});

test("renaming a provider keeps its place and moves its rename tracking", () => {
  const config = {
    providers: {
      first: { models: [{ id: "a" }] },
      stepfun: { baseUrl: "https://x", models: [{ id: "aaa" }, { id: "ddd" }] },
      last: {},
    },
  };
  const state = tracking(config);
  const renamed = renameProviderEntry(config, state, "stepfun", "house");

  assert.deepEqual(Object.keys(renamed.providers), ["first", "house", "last"]);
  assert.equal(renamed.providers.house, config.providers.stepfun);
  assert.deepEqual([...state.renames], [["stepfun", "house"]]);
  assert.deepEqual(state.slots.get("house"), ["aaa", "ddd"]);
  assert.equal(state.slots.has("stepfun"), false);
  // Renaming it back cancels the move instead of recording stepfun -> stepfun.
  renameProviderEntry(renamed, state, "house", "stepfun");
  assert.deepEqual([...state.renames], []);
});

test("renaming a provider onto another provider's id changes nothing", () => {
  const config = { providers: { one: { models: [{ id: "a" }] }, two: { models: [{ id: "b" }] } } };
  const state = tracking(config);
  assert.equal(renameProviderEntry(config, state, "one", "two"), null);
  assert.equal(renameProviderEntry(config, state, "gone", "three"), null);
  assert.deepEqual([...state.renames], []);
  assert.deepEqual([...state.slots.keys()], ["one", "two"]);
});

test("a provider added since the last save is renamed without a settings rewrite", () => {
  const config = { providers: { "new-provider": {} } };
  const state = { savedProviders: new Set(), renames: new Map(), slots: new Map() };
  const renamed = renameProviderEntry(config, state, "new-provider", "house");
  assert.deepEqual(Object.keys(renamed.providers), ["house"]);
  assert.deepEqual([...state.renames], []);
});

test("deleting a renamed or saved provider forgets its rename tracking", () => {
  const config = {
    providers: {
      stepfun: { models: [{ id: "aaa" }] },
      other: { models: [{ id: "bbb" }] },
    },
  };
  const state = tracking(config);
  const renamed = renameProviderEntry(config, state, "stepfun", "house");
  const afterDelete = deleteProviderEntry(renamed, state, "house");

  assert.deepEqual(Object.keys(afterDelete.providers), ["other"]);
  assert.deepEqual([...state.renames], []);
  assert.deepEqual([...state.savedProviders], ["other"]);
  assert.equal(state.slots.has("house"), false);

  // Another saved provider can now take the deleted id and move on cleanly.
  const movedOther = renameProviderEntry(afterDelete, state, "other", "house");
  const movedAgain = renameProviderEntry(movedOther, state, "house", "final");
  assert.deepEqual(Object.keys(movedAgain.providers), ["final"]);
  assert.deepEqual([...state.renames], [["other", "final"]]);
});

test("a new provider taking a renamed or deleted provider's old id stays untracked", () => {
  const config = { providers: { stepfun: { models: [{ id: "aaa" }] } } };
  const state = tracking(config);
  const moved = renameProviderEntry(config, state, "stepfun", "house");
  const withNew = { providers: { ...moved.providers, "new-provider": {} } };
  const tookOldId = renameProviderEntry(withNew, state, "new-provider", "stepfun");
  const renamedAgain = renameProviderEntry(tookOldId, state, "stepfun", "fresh");

  assert.deepEqual([...state.renames], [["stepfun", "house"]]);
  const afterDeletingNew = deleteProviderEntry(renamedAgain, state, "fresh");
  assert.deepEqual([...state.renames], [["stepfun", "house"]]);

  const afterDeletingSaved = deleteProviderEntry(afterDeletingNew, state, "house");
  const readded = { providers: { ...afterDeletingSaved.providers, stepfun: {} } };
  renameProviderEntry(readded, state, "stepfun", "later");
  assert.deepEqual([...state.renames], []);
});

const oauthRow = (id, name) => ({ id, name, usesCallbackServer: false, loggedIn: true });
const customRow = (id, name, models = []) => ({ id, name, models });
const byId = (row) => row.id;
const byName = (row) => row.name;

const filterIds = (search, rows) =>
  filterSidebarProviders(search, rows, byId, byName).map((row) => row.id);

test("the sidebar filter keeps matching providers in their incoming order", () => {
  const rows = [
    oauthRow("anthropic", "Anthropic"),
    oauthRow("openai-codex", "ChatGPT Plus/Pro"),
    oauthRow("kimi-coding", "Kimi"),
  ];
  // Displayed name, mixed case and surrounding whitespace all match.
  assert.deepEqual(filterIds(" chATGPT ", rows), ["openai-codex"]);
  assert.deepEqual(filterIds("kimi", rows), ["kimi-coding"]);
  assert.deepEqual(filterIds("anthropic", rows), ["anthropic"]);
  // A blank query is no filter at all.
  assert.deepEqual(filterIds("   ", rows), ["anthropic", "openai-codex", "kimi-coding"]);
  assert.deepEqual(filterIds("missing", rows), []);
});

test("a custom provider matches by its local name as well as its id", () => {
  const rows = [
    customRow("house", "House Gateway", [{ id: "a" }, { id: "b" }]),
    customRow("other", "Other", []),
  ];
  assert.deepEqual(filterIds("house", rows), ["house"]);
  assert.deepEqual(filterIds("gateway", rows), ["house"]);
  assert.deepEqual(filterIds("other", rows), ["other"]);
  // A matching provider keeps its model children, and only its own.
  assert.deepEqual(filterSidebarProviders("gateway", rows, byId, byName)[0].models, [{ id: "a" }, { id: "b" }]);
  assert.deepEqual(filterIds("models", rows), []);
});

test("a custom provider without a local name is matched by its id", () => {
  const rows = [{ id: "bare" }, customRow("named", "Named One")];
  assert.deepEqual(filterIds("bare", rows), ["bare"]);
  assert.deepEqual(filterIds("named", rows), ["named"]);
  assert.deepEqual(filterIds("Named One", rows), ["named"]);
});

test("the sidebar filter matches a Chinese provider name", () => {
  const rows = [customRow("moonshot", "月之暗面"), customRow("other", "Other")];
  assert.deepEqual(filterIds("月之", rows), ["moonshot"]);
  assert.deepEqual(filterIds("暗面", rows), ["moonshot"]);
});

test("the sidebar filter names itself and offers a clear control only when it has a query", () => {
  const props = { value: "", onChange() {}, onClear() {}, placeholder: "Filter configured providers…", clearLabel: "Clear filter" };
  const empty = renderToStaticMarkup(React.createElement(ProviderFilterInput, props));
  assert.match(empty, /placeholder="Filter configured providers…"/);
  assert.match(empty, /aria-label="Filter configured providers…"/);
  assert.doesNotMatch(empty, /Clear filter/);

  const filled = renderToStaticMarkup(React.createElement(ProviderFilterInput, { ...props, value: "ant" }));
  assert.match(filled, /value="ant"/);
  assert.match(filled, /aria-label="Clear filter"/);
});

test("Escape clears a nonempty sidebar filter and is left to the dialog otherwise", () => {
  assert.equal(sidebarFilterEscapeClears("ant", "Escape", false), true);
  // An IME composition ends with Escape too: it must not throw the query away.
  assert.equal(sidebarFilterEscapeClears("ant", "Escape", true), false);
  // Other keys and an empty filter pass through.
  assert.equal(sidebarFilterEscapeClears("ant", "a", false), false);
  assert.equal(sidebarFilterEscapeClears("", "Escape", false), false);
});

test("Add provider's search matches a provider by id or name", () => {
  const oauth = { id: "fixture-subscription-id", name: "Fixture Subscription" };
  assert.equal(providerMatchesSearch("subscription", oauth.id, oauth.name), true);
  assert.equal(providerMatchesSearch(" FIXTURE-SUBSCRIPTION-ID ", oauth.id, oauth.name), true);
  assert.equal(providerMatchesSearch("missing", oauth.id, oauth.name), false);
  assert.equal(providerMatchesSearch("  ", oauth.id, oauth.name), true);
});
