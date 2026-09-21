import test from "node:test";
import assert from "node:assert/strict";
import { calculateSuggestedAmount, startedFractions } from "../src/pricing.js";

test("35 minutos equivalen a dos fracciones", () => {
  const start = "2026-09-21T10:00:00.000Z";
  const end = "2026-09-21T10:35:00.000Z";
  assert.equal(startedFractions(start, end), 2);
  assert.deepEqual(
    calculateSuggestedAmount({ start, end, mode: "fraction", prices: { fractionCents: 150000 } }),
    { amountCents: 300000, fractions: 2 }
  );
});

test("una fracción iniciada se cobra completa", () => {
  assert.equal(startedFractions("2026-09-21T10:00:00Z", "2026-09-21T10:00:01Z"), 1);
  assert.equal(startedFractions("2026-09-21T10:00:00Z", "2026-09-21T10:30:01Z"), 2);
});

