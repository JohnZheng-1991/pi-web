import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-files-meta-")));
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");
allowFileRoot(root);

async function meta(name, content) {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, content);
  const segments = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const response = await GET(new NextRequest("http://localhost/api/files/x?type=meta"), { params: Promise.resolve({ path: segments }) });
  assert.equal(response.status, 200);
  return (await response.json()).mime;
}

test("meta reports binary content for download but leaves unfamiliar text previewable", async () => {
  assert.equal(await meta("archive.zip", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0])), "application/octet-stream");
  assert.equal(await meta("notes.custom", "plain text\n"), "text/plain");
  assert.equal(await meta("photo.jpg", Buffer.from([0xff, 0xd8, 0xff])), "image/jpeg");
});
