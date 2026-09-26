import { after, NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { exchangeCode, fetchOsmUser, revokeToken } from "@/lib/osm";
import { createSessionCookie, OAUTH_COOKIE, verify } from "@/lib/session";

interface PendingLogin {
  state: string;
  verifier: string;
  returnTo: string;
}

function redirectHome(error: string) {
  const response = NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error)}`, config.appUrl));
  response.cookies.delete(OAUTH_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get("error")) {
    return redirectHome(params.get("error") === "access_denied" ? "Sign-in was cancelled." : "OpenStreetMap sign-in failed.");
  }

  const pending = verify<PendingLogin>(request.cookies.get(OAUTH_COOKIE)?.value);
  const code = params.get("code");
  if (!pending || !code || params.get("state") !== pending.state) {
    return redirectHome("Your sign-in attempt expired. Please try again.");
  }

  try {
    const accessToken = await exchangeCode(code, pending.verifier);
    const user = await fetchOsmUser(accessToken);
    // We only needed the token to learn who this is.
    after(() => revokeToken(accessToken));

    const response = NextResponse.redirect(new URL(pending.returnTo, config.appUrl));
    const session = createSessionCookie(user);
    response.cookies.set(session.name, session.value, session.options);
    response.cookies.delete(OAUTH_COOKIE);
    return response;
  } catch (err) {
    console.error("OpenStreetMap sign-in failed:", err);
    return redirectHome("OpenStreetMap sign-in failed. Please try again.");
  }
}
