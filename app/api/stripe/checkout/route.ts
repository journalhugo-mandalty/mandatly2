import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;

  if (!stripeKey) {
    return NextResponse.json(
      { error: "Stripe non configuré. Ajoutez STRIPE_SECRET_KEY dans Vercel." },
      { status: 503 }
    );
  }
  if (!priceId) {
    return NextResponse.json(
      { error: "STRIPE_PRICE_ID manquant. Créez un prix récurrent de 49€/mois dans Stripe Dashboard." },
      { status: 503 }
    );
  }

  const { email, userId } = await req.json().catch(() => ({}));
  if (!email) return NextResponse.json({ error: "email requis" }, { status: 400 });

  const origin = req.headers.get("origin") || "https://mandatly2.vercel.app";

  const body = new URLSearchParams({
    "payment_method_types[]": "card",
    "mode": "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "customer_email": email,
    "success_url": `${origin}?stripe=success`,
    "cancel_url": `${origin}?stripe=cancel`,
    "metadata[user_id]": userId || "",
    "allow_promotion_codes": "true",
    "subscription_data[trial_period_days]": "14",
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json();
    return NextResponse.json({ error: err.error?.message || "Stripe error" }, { status: 500 });
  }

  const session = await res.json();
  return NextResponse.json({ url: session.url, sessionId: session.id });
}
