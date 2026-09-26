import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { osmEnabled } from "@/lib/config";
import { authorizeUrl, createPkce } from "@/lib/osm";
import { cookieOptions, OAUTH_COOKIE, sign } from "@/lib/session";
import { safeReturnTo } from "@/lib/signing";

const PENDING_TTL_SECONDS = 10 * 60;

export async function GET(request: NextRequest) {
  if (!osmEnabled()) {
    return NextResponse.json({ error: "OpenStreetMap sign-in isn't configured on this server." }, { status: 503 });
  }
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = createPkce();
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));

  const response = NextResponse.redirect(authorizeUrl(state, challenge));
  response.cookies.set(
    OAUTH_COOKIE,
    sign({ state, verifier, returnTo, exp: Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS }),
    cookieOptions(PENDING_TTL_SECONDS),
  );
  return response;
}
