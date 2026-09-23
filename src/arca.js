const endpoints = {
  homologation: "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5",
  production: "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5"
};

export function normalizeCuit(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isValidCuit(value) {
  const cuit = normalizeCuit(value);
  if (!/^\d{11}$/.test(cuit)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(cuit[index]) * weight, 0);
  const remainder = 11 - (sum % 11);
  const checkDigit = remainder === 11 ? 0 : remainder === 10 ? 9 : remainder;
  return checkDigit === Number(cuit[10]);
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function decodeXml(value = "") {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'").replaceAll("&amp;", "&").trim();
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
  return decodeXml(match?.[1] || "");
}

export function parseTaxpayerResponse(xml) {
  const fault = tag(xml, "faultstring") || tag(xml, "errorConstancia");
  if (fault) throw new Error(`ARCA rechazó la consulta: ${fault}`);
  const idPersona = normalizeCuit(tag(xml, "idPersona"));
  const razonSocial = tag(xml, "razonSocial");
  const apellido = tag(xml, "apellido");
  const nombre = tag(xml, "nombre");
  const legalName = razonSocial || [apellido, nombre].filter(Boolean).join(" ");
  if (!idPersona || !legalName) throw new Error("ARCA no devolvió datos identificatorios para ese CUIT.");
  return { cuit: idPersona, legalName, status: tag(xml, "estadoClave") || null };
}

export function arcaLookupConfigured() {
  return Boolean(process.env.ARCA_CUIT_REPRESENTADA && process.env.ARCA_TOKEN && process.env.ARCA_SIGN);
}

export async function lookupTaxpayer(cuit, fetchImplementation = fetch) {
  const normalized = normalizeCuit(cuit);
  if (!isValidCuit(normalized)) throw new Error("Ingrese un CUIT válido de 11 dígitos.");
  if (!arcaLookupConfigured()) {
    throw new Error("La consulta de CUIT a ARCA todavía no está habilitada. Falta configurar el certificado y la autorización del servicio.");
  }
  const environment = process.env.ARCA_ENV === "production" ? "production" : "homologation";
  const endpoint = process.env.ARCA_PADRON_URL || endpoints[environment];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
  <soapenv:Header/><soapenv:Body><a5:getPersona_v2>
    <token>${escapeXml(process.env.ARCA_TOKEN)}</token><sign>${escapeXml(process.env.ARCA_SIGN)}</sign>
    <cuitRepresentada>${escapeXml(process.env.ARCA_CUIT_REPRESENTADA)}</cuitRepresentada><idPersona>${normalized}</idPersona>
  </a5:getPersona_v2></soapenv:Body>
</soapenv:Envelope>`;
  const response = await fetchImplementation(endpoint, {
    method: "POST",
    headers: { "content-type": "text/xml; charset=utf-8", SOAPAction: "" },
    body,
    signal: AbortSignal.timeout(15_000)
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`ARCA no respondió correctamente (${response.status}).`);
  const taxpayer = parseTaxpayerResponse(responseText);
  if (taxpayer.cuit !== normalized) throw new Error("La respuesta de ARCA no corresponde al CUIT consultado.");
  return taxpayer;
}
