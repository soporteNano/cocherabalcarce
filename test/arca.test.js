import test from "node:test";
import assert from "node:assert/strict";
import { isValidCuit, normalizeCuit, parseTaxpayerResponse } from "../src/arca.js";

test("valida y normaliza un CUIT", () => {
  assert.equal(normalizeCuit("20-16475510-0"), "20164755100");
  assert.equal(isValidCuit("20-16475510-0"), true);
  assert.equal(isValidCuit("20-16475510-1"), false);
});

test("obtiene apellido y nombre de una persona física devuelta por ARCA", () => {
  const result = parseTaxpayerResponse(`
    <personaReturn><datosGenerales><apellido>PEREZ</apellido><estadoClave>ACTIVO</estadoClave>
    <idPersona>20164755100</idPersona><nombre>JUAN</nombre></datosGenerales></personaReturn>
  `);
  assert.deepEqual(result, { cuit: "20164755100", legalName: "PEREZ JUAN", status: "ACTIVO" });
});

test("prioriza la razón social informada por ARCA", () => {
  const result = parseTaxpayerResponse(`
    <personaReturn><datosGenerales><idPersona>30712345678</idPersona>
    <razonSocial>COCHERA EJEMPLO SA</razonSocial></datosGenerales></personaReturn>
  `);
  assert.equal(result.legalName, "COCHERA EJEMPLO SA");
});
