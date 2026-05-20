import { NextRequest, NextResponse } from "next/server";

// Merci Facteur Pro API — https://www.merci-facteur.com/pro/
// Token: variable MERCI_FACTEUR_TOKEN dans Vercel
// Format: POST JSON avec destinataire + expéditeur + contenu
export async function POST(req: NextRequest) {
  const token = process.env.MERCI_FACTEUR_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "Merci Facteur non configuré. Créez un compte sur merci-facteur.com/pro/, " +
          "obtenez votre token API et ajoutez MERCI_FACTEUR_TOKEN dans vos variables Vercel.",
      },
      { status: 503 }
    );
  }

  const body = await req.json();
  const { dest_nom, dest_adresse, dest_cp, dest_ville, exp_nom, exp_adresse, exp_cp, exp_ville, content } = body;

  if (!dest_nom || !dest_adresse || !dest_cp || !dest_ville || !content) {
    return NextResponse.json({ error: "Champs destinataire incomplets" }, { status: 400 });
  }

  // Parse name into first/last
  const destParts = dest_nom.trim().split(" ");
  const destFirstname = destParts.slice(0, -1).join(" ") || destParts[0];
  const destLastname = destParts.length > 1 ? destParts[destParts.length - 1] : "";

  const expParts = (exp_nom || "Agence").trim().split(" ");
  const expFirstname = expParts.slice(0, -1).join(" ") || expParts[0];
  const expLastname = expParts.length > 1 ? expParts[expParts.length - 1] : "";

  try {
    const res = await fetch("https://www.merci-facteur.com/api/1.0/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: {
          firstname: destFirstname || "Madame",
          lastname: destLastname || "Monsieur",
          address1: dest_adresse,
          zipcode: dest_cp,
          city: dest_ville,
          country: "FR",
        },
        sender: {
          firstname: expFirstname,
          lastname: expLastname,
          address1: exp_adresse || "",
          zipcode: exp_cp || "",
          city: exp_ville || "",
          country: "FR",
        },
        letter: {
          content,
          format: "A4",
          color: "BW",
          duplex: false,
          send_date: "ASAP",
        },
      }),
    });

    const data = res.ok ? await res.json() : null;
    const text = !res.ok ? await res.clone().text() : null;

    if (!res.ok) {
      return NextResponse.json({ error: `Merci Facteur: ${text}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, order_id: data?.id || data?.order_id || null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
