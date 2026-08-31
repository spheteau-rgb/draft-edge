/**
 * POST /api/season/ingest -> transcribe ONE screenshot into rows.
 *
 * One image per request on purpose: a six-image week stays well inside the
 * function timeout, and the client can show progress instead of a long hang.
 * This route writes nothing — the client accumulates rows across images and
 * commits them in a single call to /api/season/snapshot.
 */
import { NextResponse } from "next/server";
import { isTranscriptionConfigured, transcribeScreenshot } from "@/lib/season/transcribe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  if (!isTranscriptionConfigured()) {
    return NextResponse.json(
      { error: "Transcription is not configured on the server (ANTHROPIC_API_KEY missing)." },
      { status: 503 }
    );
  }

  let body: { image?: string; mediaType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const image = (body.image ?? "").replace(/^data:[^,]+,/, "");
  const mediaType = body.mediaType ?? "image/png";

  if (!image) return NextResponse.json({ error: "image (base64) is required" }, { status: 400 });
  if (!ALLOWED_TYPES.includes(mediaType)) {
    return NextResponse.json({ error: `mediaType must be one of ${ALLOWED_TYPES.join(", ")}` }, { status: 400 });
  }
  // base64 inflates by ~4/3, so this bounds the decoded image.
  if (image.length * 0.75 > MAX_BYTES) {
    return NextResponse.json({ error: "Image is larger than 8MB" }, { status: 413 });
  }

  try {
    return NextResponse.json(await transcribeScreenshot(image, mediaType));
  } catch (err) {
    const message = err instanceof Error ? err.message : "transcription failed";
    console.error("POST /api/season/ingest failed", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
