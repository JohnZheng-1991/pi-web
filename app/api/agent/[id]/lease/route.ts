import { NextResponse } from "next/server";
import { holdSessionLivenessLease, renewSessionLivenessLeases } from "@/lib/session-liveness";

const HOLDER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// POST /api/agent/[id]/lease - Renew selected-session SSE leases. `?holder=` (a page id) also
// holds a lease of that page's own: a hidden page that let go of the stream (#1283).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const holder = new URL(req.url).searchParams.get("holder");
  const renewed = renewSessionLivenessLeases(id);
  if (holder && HOLDER_PATTERN.test(holder)) holdSessionLivenessLease(id, holder);
  return NextResponse.json({
    success: true,
    renewed,
  }, { headers: { "Cache-Control": "no-store" } });
}
