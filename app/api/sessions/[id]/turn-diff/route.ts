import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { resolveSessionPath } from "@/lib/session-reader";
import { listTurnChanges, turnFilePatch } from "@/lib/turn-baseline";

export const runtime = "nodejs";

/**
 * One turn's written files and counts, from its baseline (`lib/turn-baseline.ts`),
 * and with `path=` the patch for one of them. Both come from the same
 * baseline-to-now diff, so a card's counts are the diff its row opens.
 *
 * A turn with no baseline — a plain folder, or one recorded before baselines —
 * answers an empty list, and the card keeps the transcript's own file names.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const turnId = req.nextUrl.searchParams.get("turnId") ?? "";
  const target = req.nextUrl.searchParams.get("path") ?? undefined;
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(turnId)) return NextResponse.json({ error: "Invalid turn" }, { status: 400 });
  if (!await resolveSessionPath(id)) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const changes = await listTurnChanges(id, turnId);
  if (!changes) return NextResponse.json([]);
  if (target) {
    if (!changes.some((change) => change.path === target)) {
      return NextResponse.json({ error: "File is not in this turn" }, { status: 400 });
    }
    const patch = await turnFilePatch(id, turnId, target);
    return NextResponse.json(patch ? { supported: true, patch, status: "modified" } : { supported: false });
  }
  return NextResponse.json(changes.map((change) => ({
    supported: true,
    path: change.path,
    additions: change.additions,
    deletions: change.deletions,
  })));
}
