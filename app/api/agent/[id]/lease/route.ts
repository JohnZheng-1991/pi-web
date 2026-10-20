import { NextResponse } from "next/server";
import { holdSessionLivenessLease } from "@/lib/session-liveness";

const HOLDER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// POST /api/agent/[id]/lease?holder=<page id> - Keep the session a page has selected alive
// (holdSessionLivenessLease()), whether or not the page holds its event stream.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const holder = new URL(req.url).searchParams.get("holder");
  if (!holder || !HOLDER_PATTERN.test(holder)) {
    return NextResponse.json({ error: "holder must be 1-64 letters, digits, - or _" }, { status: 400 });
  }
  holdSessionLivenessLease(id, holder);
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
