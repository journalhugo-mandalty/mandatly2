import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat") || "44.858538";
  const lng = searchParams.get("lng") || "-0.650722";
  const googleKey = process.env.GOOGLE_STREETVIEW_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const log: Record<string, any> = {
    has_google_key: !!googleKey,
    has_anthropic_key: !!anthropicKey,
  };

  if (!googleKey) return NextResponse.json(log);

  // Step 1: metadata
  try {
    const t0 = Date.now();
    const meta = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${googleKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    log.meta_status_http = meta.status;
    log.meta_ok = meta.ok;
    const md = await meta.json();
    log.meta_sv_status = md.status;
    log.meta_date = md.date;
    log.meta_pano = md.pano_id?.slice(0, 10);
    log.meta_location = md.location;
    log.meta_ms = Date.now() - t0;
  } catch (e: any) {
    log.meta_error = e.message;
    return NextResponse.json(log);
  }

  if (log.meta_sv_status !== "OK") return NextResponse.json(log);

  // Step 2: image fetch
  try {
    const t1 = Date.now();
    const imgRes = await fetch(
      `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&key=${googleKey}&fov=90&pitch=0`,
      { signal: AbortSignal.timeout(10000) }
    );
    log.img_http = imgRes.status;
    log.img_ok = imgRes.ok;
    log.img_ct = imgRes.headers.get("content-type");
    const buf = await imgRes.arrayBuffer();
    log.img_bytes = buf.byteLength;
    log.img_ms = Date.now() - t1;
  } catch (e: any) {
    log.img_error = e.message;
    return NextResponse.json(log);
  }

  if (!anthropicKey) return NextResponse.json(log);

  // Step 3: Claude call with single image
  try {
    const base64 = Buffer.from(log.img_bytes > 0
      ? await (await fetch(`https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&key=${googleKey}&fov=90`, { signal: AbortSignal.timeout(8000) })).arrayBuffer()
      : new ArrayBuffer(0)
    ).toString("base64");

    const t2 = Date.now();
    const cr = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 80,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
          { type: "text", text: "Vue de rue France. Nom sur boîte aux lettres/interphone/portail ? Réponds UNIQUEMENT le nom ou AUCUN." }
        ]}]
      }),
    });
    log.claude_http = cr.status;
    log.claude_ok = cr.ok;
    log.claude_ms = Date.now() - t2;
    if (cr.ok) {
      const cd = await cr.json();
      log.claude_text = cd.content?.[0]?.text || "";
    } else {
      log.claude_error = await cr.text();
    }
  } catch (e: any) {
    log.claude_exception = e.message;
  }

  return NextResponse.json(log);
}
