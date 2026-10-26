import assert from "node:assert/strict";
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
const {
  captureBefore,
  clearSessionSnapshots,
  commitWriteSnapshot,
  listUndoableFiles,
  snapshotTargetPaths,
  undoFileWrite,
} = await jiti.import("./file-snapshots.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");

function createTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-snapshots-"));
  // Undo authorizes the file as a read does, so the temp root is browsable here.
  allowFileRoot(root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, name, contents) {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

test("a write/edit/apply_patch names the files it changes", () => {
  const cwd = "/project";
  assert.deepEqual(snapshotTargetPaths("write", { file_path: "a.txt" }, cwd), [path.resolve(cwd, "a.txt")]);
  assert.deepEqual(snapshotTargetPaths("edit", { path: "src/b.txt" }, cwd), [path.resolve(cwd, "src/b.txt")]);
  assert.deepEqual(
    snapshotTargetPaths("apply_patch", { input: "*** Begin Patch\n*** Update File: c.txt\n@@\n-old\n+new\n*** End Patch" }, cwd),
    [path.resolve(cwd, "c.txt")],
  );
  assert.deepEqual(snapshotTargetPaths("bash", { command: "rm x" }, cwd), []);
});

test("undo restores the text the file had before the write", async (t) => {
  const root = createTempRoot(t);
  const filePath = write(root, "a.txt", "before");

  const before = captureBefore(filePath);
  fs.writeFileSync(filePath, "after");
  commitWriteSnapshot("session-1", filePath, before, root);

  assert.deepEqual(listUndoableFiles("session-1", root), [filePath]);
  assert.deepEqual(await undoFileWrite("session-1", filePath, root), { ok: true, deleted: false });
  assert.equal(fs.readFileSync(filePath, "utf8"), "before");
  // The entry is spent: a second undo has nothing to restore.
  assert.deepEqual(await undoFileWrite("session-1", filePath, root), { ok: false, reason: "no_snapshot" });
});

test("undo deletes a file the write created", async (t) => {
  const root = createTempRoot(t);
  const filePath = path.join(root, "new.txt");

  const before = captureBefore(filePath);
  assert.equal(before, null);
  fs.writeFileSync(filePath, "created");
  commitWriteSnapshot("session-2", filePath, before, root);

  assert.deepEqual(await undoFileWrite("session-2", filePath, root), { ok: true, deleted: true });
  assert.equal(fs.existsSync(filePath), false);
});

test("a file changed after the write is refused, not overwritten", async (t) => {
  const root = createTempRoot(t);
  const filePath = write(root, "a.txt", "before");

  const before = captureBefore(filePath);
  fs.writeFileSync(filePath, "after");
  commitWriteSnapshot("session-3", filePath, before, root);
  fs.writeFileSync(filePath, "the user's own edit");

  assert.deepEqual(await undoFileWrite("session-3", filePath, root), { ok: false, reason: "conflict" });
  assert.equal(fs.readFileSync(filePath, "utf8"), "the user's own edit");
});

test("a second write to the same file keeps the first before and the last after", async (t) => {
  const root = createTempRoot(t);
  const filePath = write(root, "a.txt", "one");

  const first = captureBefore(filePath);
  fs.writeFileSync(filePath, "two");
  commitWriteSnapshot("session-4", filePath, first, root);
  const second = captureBefore(filePath);
  fs.writeFileSync(filePath, "three");
  commitWriteSnapshot("session-4", filePath, second, root);

  assert.deepEqual(listUndoableFiles("session-4", root), [filePath]);
  assert.deepEqual(await undoFileWrite("session-4", filePath, root), { ok: true, deleted: false });
  assert.equal(fs.readFileSync(filePath, "utf8"), "one");
});

test("a write that changed nothing keeps no snapshot", (t) => {
  const root = createTempRoot(t);
  const filePath = write(root, "a.txt", "same");

  commitWriteSnapshot("session-5", filePath, captureBefore(filePath), root);

  assert.deepEqual(listUndoableFiles("session-5", root), []);
});

test("clearing a session drops its snapshots and leaves other sessions alone", (t) => {
  const root = createTempRoot(t);
  const first = write(root, "a.txt", "before");
  const second = write(root, "b.txt", "before");
  const beforeFirst = captureBefore(first);
  const beforeSecond = captureBefore(second);
  fs.writeFileSync(first, "after");
  fs.writeFileSync(second, "after");
  commitWriteSnapshot("session-6", first, beforeFirst, root);
  commitWriteSnapshot("session-7", second, beforeSecond, root);

  clearSessionSnapshots(["session-6"], root);

  assert.deepEqual(listUndoableFiles("session-6", root), []);
  assert.deepEqual(listUndoableFiles("session-7", root), [second]);
});
