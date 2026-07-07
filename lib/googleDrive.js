import { google } from "googleapis";
import { Readable } from "stream";

// Reuses the same OAuth credentials as the Sheets integration — the refresh
// token must have been issued with the drive.file scope (see
// /api/oauth/start) or every call here will fail with an insufficient-scope
// error. drive.file (not full Drive access) means this app can only see
// files it created itself, nothing else in the account's Drive.
function getAuth() {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REFRESH_TOKEN) return null;
  const oauth2Client = new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN });
  return oauth2Client;
}

// A single shared folder (created lazily on first upload) keeps all
// drive-by photos out of the account's Drive root — named once and reused,
// looked up by name rather than a hardcoded ID so no env var is needed.
const FOLDER_NAME = "HOA Auction ProForma Photos";
let cachedFolderId = null;

async function getOrCreateFolder(drive) {
  if (cachedFolderId) return cachedFolderId;

  const existing = await drive.files.list({
    q: `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    spaces: "drive",
  });
  if (existing.data.files?.length) {
    cachedFolderId = existing.data.files[0].id;
    return cachedFolderId;
  }

  const created = await drive.files.create({
    requestBody: { name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" },
    fields: "id",
  });
  cachedFolderId = created.data.id;
  return cachedFolderId;
}

// Tags each uploaded file with appProperties (dealType + propertyId) instead
// of tracking photos in the Sheet — keeps the Sheet's column count from
// growing per-photo, and Drive's files.list query does the filtering.
export async function uploadPhoto(dealType, id, buffer, mimeType, filename) {
  const auth = getAuth();
  if (!auth) return { ok: false, error: "Google Drive isn't configured (missing OAuth credentials)." };

  const drive = google.drive({ version: "v3", auth });
  try {
    const folderId = await getOrCreateFolder(drive);
    const res = await drive.files.create({
      requestBody: {
        name: filename || `${dealType}-${id}-${Date.now()}.jpg`,
        parents: [folderId],
        appProperties: { dealType, propertyId: String(id) },
      },
      media: { mimeType: mimeType || "image/jpeg", body: Readable.from(buffer) },
      fields: "id, name, createdTime",
    });
    return { ok: true, file: res.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Lists photos tagged for one property, newest first.
export async function listPhotos(dealType, id) {
  const auth = getAuth();
  if (!auth) return [];

  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: `appProperties has { key='dealType' and value='${dealType}' } and appProperties has { key='propertyId' and value='${id}' } and trashed = false`,
    fields: "files(id, name, createdTime)",
    orderBy: "createdTime desc",
    spaces: "drive",
  });
  return res.data.files || [];
}

export async function deletePhoto(fileId) {
  const auth = getAuth();
  if (!auth) return false;
  const drive = google.drive({ version: "v3", auth });
  await drive.files.delete({ fileId });
  return true;
}

// Streams the raw image bytes back through our own server rather than
// exposing a public Drive link — these are personal deal photos, not meant
// to be world-readable, and drive.file tokens can't generate public share
// links for files the way a "anyone with the link" setting would need.
export async function getPhotoStream(fileId) {
  const auth = getAuth();
  if (!auth) return null;
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  return { stream: res.data, mimeType: res.headers["content-type"] || "image/jpeg" };
}
