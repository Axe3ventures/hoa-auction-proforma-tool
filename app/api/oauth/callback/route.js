import { NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET(request) {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } = process.env;
  const code = new URL(request.url).searchParams.get("code");
  if (!code) {
    return new NextResponse("Missing ?code from Google — start over at /api/oauth/start", { status: 400 });
  }

  const redirectUri = new URL("/api/oauth/callback", request.url).toString();
  const oauth2Client = new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, redirectUri);

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return new NextResponse(
        "Google didn't return a refresh_token — this usually means you've already authorized this " +
          "app before and Google is skipping re-consent. Revoke access at " +
          "https://myaccount.google.com/permissions (find this app and remove it), then visit " +
          "/api/oauth/start again.",
        { status: 400 }
      );
    }
    return new NextResponse(
      "Success. Copy this value into GOOGLE_OAUTH_REFRESH_TOKEN (in .env.local and in Vercel's " +
        "Environment Variables), alongside GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET:\n\n" +
        `${tokens.refresh_token}\n\n` +
        "You can close this tab once you've copied it.",
      { headers: { "Content-Type": "text/plain" } }
    );
  } catch (err) {
    return new NextResponse(`OAuth exchange failed: ${err.message}`, { status: 500 });
  }
}
