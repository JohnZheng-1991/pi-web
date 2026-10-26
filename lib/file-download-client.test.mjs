import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { downloadBinaryFile } = await createJiti(import.meta.url).import("./file-download-client.ts");

function metaRequest(mime) {
  globalThis.fetch = async (url) => {
    assert.match(url, /\/project\/report\.(zip|custom)\?type=meta$/);
    return { ok: true, json: async () => ({ mime }) };
  };
}

test("binary file links download through the existing API", async (t) => {
  t.after(() => { delete globalThis.fetch; delete globalThis.document; });
  metaRequest("application/octet-stream");
  const link = { click: () => { link.clicked = true; } };
  globalThis.document = { createElement: (tag) => { assert.equal(tag, "a"); return link; } };

  assert.equal(await downloadBinaryFile("/project/report.zip"), true);
  assert.equal(link.href, "/api/files/project/report.zip?type=download");
  assert.equal(link.clicked, true);
});

test("unknown textual files still open for preview", async (t) => {
  t.after(() => { delete globalThis.fetch; delete globalThis.document; });
  metaRequest("text/plain");
  globalThis.document = { createElement: () => assert.fail("must not download text") };

  assert.equal(await downloadBinaryFile("/project/report.custom"), false);
});

test("a failed metadata request preserves the existing preview error path", async (t) => {
  t.after(() => { delete globalThis.fetch; delete globalThis.document; });
  globalThis.fetch = async () => ({ ok: false });
  globalThis.document = { createElement: () => assert.fail("must not download") };
  assert.equal(await downloadBinaryFile("/project/report.zip"), false);
});
