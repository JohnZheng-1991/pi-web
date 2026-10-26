import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { undoFileWrite } from "@/lib/file-snapshots";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { SESSION_ID_PATTERN } from "@/lib/session-ui-state-shared";

export const dynamic = "force-dynamic";

// POST /api/sessions/[id]/undo - restore the files a turn wrote.
//
// Only files with a snapshot of that session can be undone
// (`lib/file-snapshots.ts`), and each one only while it still holds what the
// write left: a file the user edited since is refused, not overwritten. The
// path is authorized like a file read, plus the session's own cwd, so a
// session that ran before the file's folder was browsable can still undo.

interface UndoRequest { files?: unknown }

function refusal(status: number, reason: string, error: string) {
  return NextResponse.json({ error, reason }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return refusal(403, "request-denied", "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "content-type", "Content-Type must be application/json");
  const { id } = await params;
  if (!SESSION_ID_PATTERN.test(id)) return refusal(400, "invalid-request", "Not a session id");

  let body: UndoRequest;
  try {
    body = await req.json() as UndoRequest;
  } catch {
    return refusal(400, "invalid-request", "Invalid JSON body");
  }
  const files = body?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > 100) {
    return refusal(400, "invalid-request", "files must be a non-empty array of paths");
  }
  if (!files.every((file) => typeof file === "string" && file.length > 0 && file.length < 4096)) {
    return refusal(400, "invalid-request", "files must be a non-empty array of paths");
  }

  const roots = await getAllowedFileRoots();

  const results: Array<{ filePath: string; ok: boolean; reason?: string; deleted?: boolean }> = [];
  for (const filePath of files as string[]) {
    if (!isExistingFilePathAllowed(filePath, roots)) {
      results.push({ filePath, ok: false, reason: "forbidden" });
      continue;
    }
    try {
      results.push({ filePath, ...(await undoFileWrite(id, filePath)) });
    } catch (error) {
      results.push({ filePath, ok: false, reason: error instanceof Error ? error.message : "failed" });
    }
  }
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
