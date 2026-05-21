import { NextRequest, NextResponse } from "next/server";

// Street View + Claude Vision — reads names from letterboxes/gates
// Requires: GOOGLE_STREETVIEW_KEY + ANTHROPIC_API_KEY
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!lat || !lng) return NextResponse.json({ nom: null });

  const googleKey = process.env.GOOGLE_STREETVIEW_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!googleKey) return NextResponse.json({ nom: null, reason: "GOOGLE_STREETVIEW_KEY manquante" });
  if (!anthropicKey) return NextResponse.json({ nom: null, reason: "ANTHROPIC_API_KEY manquante" });

  try {
    // Step 1: Check Street View metadata (free, no charge)
    const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${googleKey}`;
    const meta = await fetch(metaUrl, { signal: AbortSignal.timeout(5000) });
    if (!meta.ok) return NextResponse.json({ nom: null });
    const metaData = await meta.json();
    if (metaData.status !== "OK") return NextResponse.json({ nom: null, reason: "pas d'imagery Street View" });

    // Step 2: Fetch Street View image
    const imgUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&key=${googleKey}&fov=90&pitch=0`;
    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
    if (!imgRes.ok) return NextResponse.json({ nom: null });

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    if (!contentType.includes("image")) return NextResponse.json({ nom: null });

    const imgBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(imgBuffer).toString("base64");
    const mediaType = contentType.includes("png") ? "image/png" : "image/jpeg";

    // Step 3: Claude Vision — read letterbox/gate/nameplate
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 80,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Regarde cette vue de rue en France. Y a-t-il un nom de famille ou de société lisible sur une boîte aux lettres, un interphone, un portail ou une plaque nominative ? Si oui, réponds UNIQUEMENT avec le nom exact tel qu'il apparaît (ex: DUPONT, Famille MARTIN, SCI LES ACACIAS). Si aucun nom n'est clairement lisible, réponds exactement AUCUN." }
          ]
        }]
      }),
    });

    if (!claudeRes.ok) return NextResponse.json({ nom: null });

    const claudeData = await claudeRes.json();
    const text = (claudeData.content?.[0]?.text || "").trim();

    if (!text || text === "AUCUN" || text.length < 2 || text.length > 80) {
      return NextResponse.json({ nom: null });
    }

    return NextResponse.json({ nom: text, source: "vision-ia", confidence: "moyenne" });
  } catch (e: any) {
    return NextResponse.json({ nom: null, reason: e.message });
  }
}
