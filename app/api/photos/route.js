import { NextResponse } from "next/server";
import { uploadPhoto, listPhotos, deletePhoto } from "../../../lib/googleDrive";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const dealType = searchParams.get("dealType");
  if (!id || !dealType) {
    return NextResponse.json({ error: "id and dealType are required" }, { status: 400 });
  }
  try {
    const photos = await listPhotos(dealType, id);
    return NextResponse.json({ photos });
  } catch (err) {
    console.error(`GET /api/photos failed for ${dealType}/${id}:`, err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const formData = await request.formData();
  const id = formData.get("id");
  const dealType = formData.get("dealType");
  const address = formData.get("address");
  const file = formData.get("file");
  if (!id || !dealType || !file) {
    return NextResponse.json({ ok: false, error: "id, dealType, and file are required" }, { status: 400 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadPhoto(dealType, String(id), address || "", buffer, file.type, file.name);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, file: result.file });
  } catch (err) {
    console.error(`POST /api/photos failed for ${dealType}/${id}:`, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");
  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }
  try {
    await deletePhoto(fileId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/photos failed for fileId=${fileId}:`, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
