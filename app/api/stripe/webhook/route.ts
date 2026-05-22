import { NextRequest, NextResponse } from "next/server";

export const config = { api: { bodyParser: false } };

async function getRawBody(req: NextRequest): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: "non configuré" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature") || "";
  const rawBody = await getRawBody(req);

  // Verify Stripe signature manually (avoid heavy stripe npm package)
  const crypto = await import("crypto");
  const parts = sig.split(",");
  const tPart = parts.find(p => p.startsWith("t="));
  const v1Part = parts.find(p => p.startsWith("v1="));
  if (!tPart || !v1Part) return NextResponse.json({ error: "signature invalide" }, { status: 400 });

  const timestamp = tPart.slice(2);
  const expected = v1Part.slice(3);
  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const hmac = crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex");
  if (hmac !== expected) return NextResponse.json({ error: "signature incorrecte" }, { status: 400 });

  const event = JSON.parse(rawBody.toString("utf8"));

  // Handle subscription events — update Supabase user record
  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (supabaseUrl && supabaseServiceKey) {
      const obj = event.data.object;
      const userId = obj.metadata?.user_id || obj.subscription_details?.metadata?.user_id;
      const status = event.type === "customer.subscription.deleted" ? "inactive"
        : obj.status === "active" || obj.status === "trialing" ? "active"
        : "inactive";
      const currentPeriodEnd = obj.current_period_end
        ? new Date(obj.current_period_end * 1000).toISOString()
        : null;

      if (userId) {
        await fetch(`${supabaseUrl}/rest/v1/user_data?user_id=eq.${userId}`, {
          method: "PATCH",
          headers: {
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            subscription_status: status,
            subscription_period_end: currentPeriodEnd,
            stripe_customer_id: obj.customer || null,
          }),
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
