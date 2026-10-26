import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { TurnWrittenFiles } = await jiti.import("./TurnWrittenFiles.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TurnWrittenFiles, props)),
  );
}

const file = (filePath, additions, deletions) => ({ filePath, toolCallIds: ["1"], additions, deletions });

test("renders a card with a header, relative path and per-file counts", () => {
  const html = render({
    cwd: "/repo",
    files: [file("/repo/src/deep/report.html", 13, 2)],
    onOpenFileDiff() {},
  });
  assert.match(html, /Edited 1 files/);
  assert.match(html, /\+13/);
  assert.match(html, /-2/);
  assert.match(html, /src\/deep\//);
  assert.match(html, /report\.html/);
  assert.match(html, /title="\/repo\/src\/deep\/report\.html"/);
});

test("renders nothing when no files were written", () => {
  assert.equal(render({ files: [], onOpenFileDiff() {} }), "");
});

test("shows no count for a file whose tool recorded no patch", () => {
  const html = render({ files: [file("/abs/src/a.ts")], onOpenFileDiff() {} });
  assert.match(html, /a\.ts/);
  const card = html.slice(html.indexOf("<section"));
  const rows = card.slice(card.indexOf("</div>") + 6);
  assert.doesNotMatch(rows, /\+0/);
  assert.doesNotMatch(rows, /-0/);
});

test("the header totals every file, including those below the fold", () => {
  const html = render({
    files: [file("/a.ts", 1, 1), file("/b.ts", 2, 2), file("/c.ts", 3, 3), file("/d.ts", 4, 4)],
    onOpenFileDiff() {},
  });
  assert.match(html, /Edited 4 files/);
  assert.match(html, /\+10/);
  assert.match(html, /-10/);
});

test("shows three files by default and offers the rest through a disclosure", () => {
  const html = render({
    files: [file("/a.ts", 1, 0), file("/b.ts", 1, 0), file("/c.ts", 1, 0), file("/d.ts", 1, 0)],
    onOpenFileDiff() {},
  });
  assert.match(html, /a\.ts/);
  assert.match(html, /b\.ts/);
  assert.match(html, /c\.ts/);
  assert.doesNotMatch(html, /d\.ts/);
  assert.match(html, /Show 1 more files/);
  assert.match(html, /aria-expanded="false"/);
});

test("no disclosure is needed for three files", () => {
  const html = render({ files: [file("/a.ts"), file("/b.ts"), file("/c.ts")], onOpenFileDiff() {} });
  assert.doesNotMatch(html, /aria-expanded/);
});

test("rows are inert when the caller offers no diff pane", () => {
  const html = render({ files: [file("/a.ts", 3, 1)] });
  assert.match(html, /disabled/);
  const withDiff = render({ files: [file("/a.ts", 3, 1)], onOpenFileDiff() {} });
  assert.doesNotMatch(withDiff, /disabled/);
});

test("offers undo on every row when the caller can undo", () => {
  const html = render({ files: [file("/repo/a.ts", 1, 0)], onUndoFile: async () => ({ message: "" }) });
  assert.match(html, /Undo the changes to a\.ts/);
});

test("shows no undo button without an undo handler", () => {
  const html = render({ files: [file("/repo/a.ts", 1, 0)] });
  assert.doesNotMatch(html, /Undo the changes to/);
});
