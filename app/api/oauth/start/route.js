import { NextResponse } from "next/server";
import { google } from "googleapis";

// One-time helper for connecting via your own Google account instead of a
// service account JSON key. Visit this route (locally, e.g.
// http://localhost:3210/api/oauth/start), sign in, and approve — you'll land
// on /api/oauth/callback which shows the refresh token to copy into your env
// vars. See SETUP.md "Connect via OAuth instead" for the full walkthrough.
export async function GET(request) {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } = process.env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) {
    return NextResponse.json(
      {
        error:
          "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local first (see SETUP.md).",
      },
      { status: 400 }
    );
  }

  const redirectUri = new URL("/api/oauth/callback", request.url).toString();
  const oauth2Client = new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces Google to issue a refresh_token even if you've authorized this app before
    // drive.file (not full drive access) — lets the app create/read/delete
    // only the photo files it uploads itself, nothing else in your Drive.
    scope: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"],
  });

  return NextResponse.redirect(authUrl);
}
