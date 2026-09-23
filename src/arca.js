import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Arca } from "@arcasdk/core";

let arcaInstance = null;

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
  const legalName = tag(xml, "razonSocial") || [tag(xml, "apellido"), tag(xml, "nombre")].filter(Boolean).join(" ");
  if (!idPersona || !legalName) throw new Error("ARCA no devolvió datos identificatorios para ese CUIT.");
  return { cuit: idPersona, legalName, status: tag(xml, "estadoClave") || null };
}

function findValue(object, key) {
  if (!object || typeof object !== "object") return undefined;
  if ((typeof object[key] === "string" || typeof object[key] === "number") && String(object[key]).trim()) return String(object[key]).trim();
  for (const child of Object.values(object)) {
    const found = findValue(child, key);
    if (found) return found;
  }
  return undefined;
}

function arcaConfig() {
  const certPath = process.env.ARCA_CERT_PATH ? resolve(process.env.ARCA_CERT_PATH) : "";
  const keyPath = process.env.ARCA_KEY_PATH ? resolve(process.env.ARCA_KEY_PATH) : "";
  return {
    cuit: normalizeCuit(process.env.ARCA_CUIT), certPath, keyPath,
    production: process.env.ARCA_PRODUCTION === "true",
    pointOfSale: Number(process.env.ARCA_POINT_OF_SALE || 0),
    voucherType: Number(process.env.ARCA_VOUCHER_TYPE || 11)
  };
}

export function arcaLookupConfigured() {
  const config = arcaConfig();
  return isValidCuit(config.cuit) && existsSync(config.certPath) && existsSync(config.keyPath);
}

export function arcaBillingConfigured() {
  const config = arcaConfig();
  return arcaLookupConfigured() && Number.isInteger(config.pointOfSale) && config.pointOfSale > 0 && [1, 6, 11].includes(config.voucherType);
}

export function getArca() {
  if (!arcaLookupConfigured()) throw new Error("La conexión con ARCA todavía no está configurada con CUIT, certificado y clave privada.");
  if (!arcaInstance) {
    const config = arcaConfig();
    arcaInstance = new Arca({ cuit: Number(config.cuit), cert: readFileSync(config.certPath, "utf8"), key: readFileSync(config.keyPath, "utf8"), production: config.production });
  }
  return arcaInstance;
}

export async function lookupTaxpayer(cuit) {
  const normalized = normalizeCuit(cuit);
  if (!isValidCuit(normalized)) throw new Error("Ingrese un CUIT válido de 11 dígitos.");
  const details = await getArca().registerScopeThirteenService.getTaxpayerDetails(Number(normalized));
  if (!details) throw new Error("El CUIT no fue encontrado en el padrón de ARCA.");
  const legalName = findValue(details, "razonSocial") || [findValue(details, "apellido"), findValue(details, "nombre")].filter(Boolean).join(" ");
  if (!legalName) throw new Error("ARCA no devolvió la razón social para ese CUIT.");
  return { cuit: normalized, legalName, status: findValue(details, "estadoClave") || null };
}

function rejectionMessage(detail) {
  const observations = detail?.Observaciones?.Obs;
  if (Array.isArray(observations)) return observations.map((item) => `[${item.Code}] ${item.Msg}`).join(" | ");
  if (observations) return `[${observations.Code}] ${observations.Msg}`;
  return "ARCA rechazó el comprobante sin informar el motivo.";
}

export async function emitTicketInvoice({ amountCents, taxConditionId, docType, docNumber }) {
  if (!arcaBillingConfigured()) throw new Error("Falta configurar el punto de venta o el tipo de comprobante de ARCA.");
  const config = arcaConfig();
  const total = Number((amountCents / 100).toFixed(2));
  const isInvoiceC = config.voucherType === 11;
  const netAmount = isInvoiceC ? total : Number((total / 1.21).toFixed(2));
  const vatAmount = isInvoiceC ? 0 : Number((total - netAmount).toFixed(2));
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const resolvedDocType = docNumber ? Number(docType || 80) : 99;
  const resolvedDocNumber = docNumber ? Number(normalizeCuit(docNumber)) : 0;
  const result = await getArca().electronicBillingService.createNextVoucher({
    CantReg: 1, PtoVta: config.pointOfSale, CbteTipo: config.voucherType, Concepto: 2,
    DocTipo: resolvedDocType, DocNro: resolvedDocNumber, CbteFch: date,
    ImpTotal: total, ImpTotConc: 0, ImpNeto: netAmount, ImpOpEx: 0, ImpIVA: vatAmount, ImpTrib: 0,
    MonId: "PES", MonCotiz: 1, CondicionIVAReceptorId: Number(taxConditionId),
    FchServDesde: date, FchServHasta: date, FchVtoPago: date,
    ...(isInvoiceC ? {} : { Iva: [{ Id: 5, BaseImp: netAmount, Importe: vatAmount }] })
  });
  const detail = result?.response?.FeDetResp?.FECAEDetResponse?.[0];
  if (!result?.cae || detail?.Resultado !== "A") throw new Error(rejectionMessage(detail));
  return {
    cae: String(result.cae), caeExpiration: String(result.caeFchVto || ""), voucherNumber: Number(detail.CbteDesde),
    pointOfSale: config.pointOfSale, voucherType: config.voucherType, docType: resolvedDocType,
    docNumber: resolvedDocNumber, raw: result
  };
}
