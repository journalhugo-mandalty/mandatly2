import { NextRequest, NextResponse } from "next/server";

// Generate a minimal valid PDF from text lines (ASCII only)
function buildPDF(lines: string[]): Buffer {
  const esc = (s: string) =>
    s.normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\x20-\x7E]/g, "?")
      .replace(/[()\\]/g, (c) => `\\${c}`);

  const streamParts = ["BT", "/F1 11 Tf"];
  let y = 730;
  for (const line of lines) {
    if (y < 60) break;
    streamParts.push(`1 0 0 1 50 ${y} Tm (${esc(line)}) Tj`);
    y -= 20;
  }
  streamParts.push("ET");
  const stream = streamParts.join("\n");

  const obj1 = "1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n";
  const obj2 = "2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n";
  const obj3 =
    "3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R" +
    " /Resources <</Font <</F1 <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>>>>>>> \nendobj\n";
  const obj4 = `4 0 obj\n<</Length ${Buffer.byteLength(stream, "ascii")}>> \nstream\n${stream}\nendstream\nendobj\n`;

  const header = "%PDF-1.4\n";
  const off1 = Buffer.byteLength(header, "ascii");
  const off2 = off1 + Buffer.byteLength(obj1, "ascii");
  const off3 = off2 + Buffer.byteLength(obj2, "ascii");
  const off4 = off3 + Buffer.byteLength(obj3, "ascii");
  const xrefOff = off4 + Buffer.byteLength(obj4, "ascii");

  const pad = (n: number) => n.toString().padStart(10, "0");
  const xref =
    "xref\n0 5\n" +
    "0000000000 65535 f \n" +
    `${pad(off1)} 00000 n \n` +
    `${pad(off2)} 00000 n \n` +
    `${pad(off3)} 00000 n \n` +
    `${pad(off4)} 00000 n \n`;

  const trailer = `trailer\n<</Size 5 /Root 1 0 R>>\nstartxref\n${xrefOff}\n%%EOF`;
  return Buffer.from(header + obj1 + obj2 + obj3 + obj4 + xref + trailer, "ascii");
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.YOUSIGN_API_KEY;
  const sandbox = process.env.YOUSIGN_SANDBOX !== "false"; // default: sandbox
  const base = sandbox
    ? "https://api-sandbox.yousign.app/v3"
    : "https://api.yousign.app/v3";

  if (!apiKey) {
    return NextResponse.json(
      { error: "Yousign non configuré. Ajoutez YOUSIGN_API_KEY dans vos variables Vercel." },
      { status: 503 }
    );
  }

  const { mandat } = await req.json();
  if (!mandat) return NextResponse.json({ error: "mandat requis" }, { status: 400 });

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  try {
    // 1. Create signature request
    const srRes = await fetch(`${base}/signature_requests`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: `Mandat - ${mandat.nom_propriete} - ${mandat.adresse}`,
        delivery_mode: "email",
        timezone: "Europe/Paris",
      }),
    });
    if (!srRes.ok) {
      const err = await srRes.text();
      return NextResponse.json({ error: `Yousign SR: ${err}` }, { status: 500 });
    }
    const sr = await srRes.json();
    const srId: string = sr.id;

    // 2. Upload mandat PDF document
    const pdfLines = [
      "MANDAT DE VENTE",
      "",
      `Bien : ${mandat.nom_propriete}`,
      `Adresse : ${mandat.adresse}, ${mandat.ville}`,
      `Type : ${mandat.type}`,
      `Prix de vente : ${mandat.prix?.toLocaleString("fr-FR") || ""} EUR`,
      `Surface : ${mandat.surface} m2`,
      `Honoraires : ${mandat.honoraires}%`,
      `Mandat : ${mandat.exclusif ? "Exclusif" : "Simple"}`,
      `Fin de mandat : ${mandat.fin_mandat || "A definir"}`,
      "",
      `Proprietaire : ${mandat.proprietaire}`,
      `Email : ${mandat.email || ""}`,
      `Tel : ${mandat.tel || ""}`,
      "",
      "Ce document constitue un mandat de vente immobiliere.",
      "Signature electronique requise.",
    ];
    const pdfBytes = buildPDF(pdfLines);
    const pdfB64 = pdfBytes.toString("base64");

    const docRes = await fetch(`${base}/signature_requests/${srId}/documents`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        nature: "signable_document",
        name: `mandat_${mandat.id}.pdf`,
        content: pdfB64,
        content_type: "application/pdf",
      }),
    });
    if (!docRes.ok) {
      const err = await docRes.text();
      return NextResponse.json({ error: `Yousign doc: ${err}` }, { status: 500 });
    }
    const doc = await docRes.json();
    const docId: string = doc.id;

    // 3. Add signer
    const [firstName, ...rest] = (mandat.proprietaire || "Proprietaire").split(" ");
    const lastName = rest.join(" ") || firstName;
    const signerRes = await fetch(`${base}/signature_requests/${srId}/signers`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        info: {
          first_name: firstName,
          last_name: lastName,
          email: mandat.email || `proprietaire_${mandat.id}@mandatly.fr`,
          phone_number: mandat.tel?.replace(/\s/g, "") || undefined,
          locale: "fr",
        },
        signature_level: "electronic_signature",
        signature_authentication_mode: "no_otp",
        fields: [
          {
            document_id: docId,
            type: "signature",
            page: 1,
            x: 400,
            y: 700,
            width: 150,
            height: 50,
          },
        ],
      }),
    });
    if (!signerRes.ok) {
      const err = await signerRes.text();
      return NextResponse.json({ error: `Yousign signer: ${err}` }, { status: 500 });
    }
    const signer = await signerRes.json();

    // 4. Activate signature request
    const activateRes = await fetch(`${base}/signature_requests/${srId}/activate`, {
      method: "POST",
      headers,
    });
    if (!activateRes.ok) {
      const err = await activateRes.text();
      return NextResponse.json({ error: `Yousign activate: ${err}` }, { status: 500 });
    }

    // 5. Get signing link
    const linkRes = await fetch(
      `${base}/signature_requests/${srId}/signers/${signer.id}/signature_link`,
      { headers }
    );
    const linkData = linkRes.ok ? await linkRes.json() : {};

    return NextResponse.json({
      ok: true,
      signature_request_id: srId,
      signer_id: signer.id,
      signing_url: linkData.signature_link || linkData.url || null,
      sandbox,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.YOUSIGN_API_KEY;
  const sandbox = process.env.YOUSIGN_SANDBOX !== "false";
  const base = sandbox
    ? "https://api-sandbox.yousign.app/v3"
    : "https://api.yousign.app/v3";

  if (!apiKey) return NextResponse.json({ error: "non configuré" }, { status: 503 });

  const srId = new URL(req.url).searchParams.get("sr_id");
  if (!srId) return NextResponse.json({ error: "sr_id requis" }, { status: 400 });

  const res = await fetch(`${base}/signature_requests/${srId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  const data = await res.json();
  return NextResponse.json({ status: data.status, signers: data.signers });
}
