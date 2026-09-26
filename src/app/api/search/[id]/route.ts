import { NextResponse } from "next/server";
import { getSearch, toPublic } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const record = await getSearch((await params).id);
  if (!record) return NextResponse.json({ error: "Search not found." }, { status: 404 });
  return NextResponse.json(toPublic(record), { headers: { "Cache-Control": "no-store" } });
}
