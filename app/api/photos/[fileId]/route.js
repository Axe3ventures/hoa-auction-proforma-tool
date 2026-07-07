import { getPhotoStream } from "../../../../lib/googleDrive";

// Streams the image bytes through our own server instead of a public Drive
// link — keeps these personal property photos private (drive.file-scoped
// tokens can't grant "anyone with the link" access anyway).
export async function GET(request, { params }) {
  const { fileId } = params;
  try {
    const result = await getPhotoStream(fileId);
    if (!result) {
      return new Response("Google Drive isn't configured", { status: 500 });
    }
    const webStream = new ReadableStream({
      start(controller) {
        result.stream.on("data", (chunk) => controller.enqueue(chunk));
        result.stream.on("end", () => controller.close());
        result.stream.on("error", (err) => controller.error(err));
      },
    });
    return new Response(webStream, {
      headers: { "Content-Type": result.mimeType, "Cache-Control": "private, max-age=86400" },
    });
  } catch (err) {
    return new Response(`Failed to load photo: ${err.message}`, { status: 500 });
  }
}
