import { NextResponse } from "next/server";
import { runPhotoCleanup } from "../../../../lib/photoCleanup";

// Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET` when
// it triggers this route (see vercel.json) — this check keeps anyone else
// from hitting the URL and force-running a deletion sweep.
export async function GET(request) {
  const { CRON_SECRET } = process.env;
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const results = await runPhotoCleanup();
    return NextResponse.json({ ok: true, ...results });
  } catch (err) {
    console.error("Photo cleanup cron failed:", err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
