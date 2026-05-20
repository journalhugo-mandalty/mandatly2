import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(req: NextRequest) {
  const { to, sujet, corps } = await req.json();
  if (!to || !corps) return NextResponse.json({ error: "to/corps requis" }, { status: 400 });

  const from = process.env.EMAIL_FROM;
  const pass = process.env.EMAIL_APP_PASSWORD;
  const provider = process.env.EMAIL_PROVIDER || "gmail"; // gmail | outlook | smtp

  if (!from || !pass) {
    return NextResponse.json(
      { error: "Email non configuré. Ajoutez EMAIL_FROM et EMAIL_APP_PASSWORD dans vos variables d'environnement Vercel." },
      { status: 503 }
    );
  }

  const transportConfig =
    provider === "outlook"
      ? { host: "smtp-mail.outlook.com", port: 587, secure: false, auth: { user: from, pass } }
      : provider === "smtp"
      ? { host: process.env.EMAIL_SMTP_HOST || "localhost", port: Number(process.env.EMAIL_SMTP_PORT || 587), secure: false, auth: { user: from, pass } }
      : { service: "gmail", auth: { user: from, pass } };

  try {
    const transporter = nodemailer.createTransport(transportConfig as any);
    await transporter.sendMail({
      from: `"${process.env.EMAIL_NAME || "Mandatly"}" <${from}>`,
      to,
      subject: sujet,
      text: corps,
      html: `<div style="font-family:Georgia,serif;font-size:14px;line-height:1.7;max-width:600px">${corps.replace(/\n/g, "<br>")}</div>`,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
