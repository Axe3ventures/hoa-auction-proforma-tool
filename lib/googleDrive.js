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

function getDrive() {
  const auth = getAuth();
  return auth ? google.drive({ version: "v3", auth }) : null;
}

// A single shared root folder (created lazily on first upload) keeps all
// drive-by photos out of the account's Drive root — looked up by name rather
// than a hardcoded ID so no env var is needed.
const ROOT_FOLDER_NAME = "HOA Auction ProForma Photos";
const FOLDER_MIME = "application/vnd.google-apps.folder";
let cachedRootFolderId = null;

async function getOrCreateRootFolder(drive) {
  if (cachedRootFolderId) return cachedRootFolderId;

  const existing = await drive.files.list({
    q: `name = '${ROOT_FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id)",
    spaces: "drive",
  });
  if (existing.data.files?.length) {
    cachedRootFolderId = existing.data.files[0].id;
    return cachedRootFolderId;
  }

  const created = await drive.files.create({
    requestBody: { name: ROOT_FOLDER_NAME, mimeType: FOLDER_MIME },
    fields: "id",
  });
  cachedRootFolderId = created.data.id;
  return cachedRootFolderId;
}

// One subfolder per property, named after its address, looked up by the
// dealType/propertyId tag (not by name) so it still resolves correctly even
// if two properties happen to share an address string.
async function getOrCreatePropertyFolder(drive, rootFolderId, dealType, id, address) {
  const existing = await drive.files.list({
    q: `'${rootFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='dealType' and value='${dealType}' } and appProperties has { key='propertyId' and value='${id}' }`,
    fields: "files(id)",
    spaces: "drive",
  });
  if (existing.data.files?.length) return existing.data.files[0].id;

  const folderName = (address || "").trim().slice(0, 200) || `${dealType}-${id}`;
  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: FOLDER_MIME,
      parents: [rootFolderId],
      appProperties: { dealType, propertyId: String(id), isPropertyFolder: "true" },
    },
    fields: "id",
  });
  return created.data.id;
}

// Tags each uploaded file with appProperties (dealType + propertyId) instead
// of tracking photos in the Sheet — keeps the Sheet's column count from
// growing per-photo, and Drive's files.list query does the filtering.
export async function uploadPhoto(dealType, id, address, buffer, mimeType, filename) {
  const drive = getDrive();
  if (!drive) return { ok: false, error: "Google Drive isn't configured (missing OAuth credentials)." };

  try {
    const rootFolderId = await getOrCreateRootFolder(drive);
    const propertyFolderId = await getOrCreatePropertyFolder(drive, rootFolderId, dealType, id, address);
    const res = await drive.files.create({
      requestBody: {
        name: filename || `${Date.now()}.jpg`,
        parents: [propertyFolderId],
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

// Lists photos tagged for one property, newest first. Excludes the property
// folder itself, which carries the same dealType/propertyId tags.
export async function listPhotos(dealType, id) {
  const drive = getDrive();
  if (!drive) return [];

  const res = await drive.files.list({
    q: `appProperties has { key='dealType' and value='${dealType}' } and appProperties has { key='propertyId' and value='${id}' } and mimeType != '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id, name, createdTime)",
    orderBy: "createdTime desc",
    spaces: "drive",
  });
  return res.data.files || [];
}

export async function deletePhoto(fileId) {
  const drive = getDrive();
  if (!drive) return false;
  await drive.files.delete({ fileId });
  return true;
}

// Streams the raw image bytes back through our own server rather than
// exposing a public Drive link — these are personal deal photos, not meant
// to be world-readable, and drive.file tokens can't generate public share
// links for files the way a "anyone with the link" setting would need.
export async function getPhotoStream(fileId) {
  const drive = getDrive();
  if (!drive) return null;
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  return { stream: res.data, mimeType: res.headers["content-type"] || "image/jpeg" };
}

// --- Cleanup support (see lib/photoCleanup.js) ---

// Every per-property photo folder, with its tags — used by the cleanup job
// to decide what's eligible for deletion. `redSince` is only present once
// the cleanup job has actually observed the property as red/purchased-by-
// other for the first time (see markFolderRedSince).
export async function listAllPropertyFolders() {
  const drive = getDrive();
  if (!drive) return [];
  const rootFolderId = await getOrCreateRootFolder(drive);
  const res = await drive.files.list({
    q: `'${rootFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id, name, appProperties)",
    spaces: "drive",
    pageSize: 1000,
  });
  return (res.data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    dealType: f.appProperties?.dealType || "",
    propertyId: f.appProperties?.propertyId || "",
    redSince: f.appProperties?.redSince || "",
  }));
}

export async function markFolderRedSince(folderId, dateStr) {
  const drive = getDrive();
  if (!drive) return;
  await drive.files.update({ fileId: folderId, requestBody: { appProperties: { redSince: dateStr } } });
}

// Setting a key to null in appProperties removes just that key (Drive patch
// semantics) — used when a property comes back off red/purchased-by-other so
// a future elimination restarts the 7-day clock instead of reusing a stale date.
export async function clearFolderRedSince(folderId) {
  const drive = getDrive();
  if (!drive) return;
  await drive.files.update({ fileId: folderId, requestBody: { appProperties: { redSince: null } } });
}

// Permanently deletes the folder and everything in it (Drive's files.delete
// on a folder recursively removes its children too).
export async function deleteFolderAndContents(folderId) {
  const drive = getDrive();
  if (!drive) return false;
  await drive.files.delete({ fileId: folderId });
  return true;
}
