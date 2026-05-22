import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return NextResponse.json({ configured: false });

  const customerId = new URL(req.url).searchParams.get("customer_id");
  if (!customerId) return NextResponse.json({ configured: true, status: "no_customer" });

  const res = await fetch(
    `https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=all&limit=1`,
    { headers: { Authorization: `Bearer ${stripeKey}` } }
  );
  if (!res.ok) return NextResponse.json({ configured: true, status: "error" });

  const data = await res.json();
  const sub = data.data?.[0];
  if (!sub) return NextResponse.json({ configured: true, status: "no_subscription" });

  return NextResponse.json({
    configured: true,
    status: sub.status,
    trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end,
  });
}
