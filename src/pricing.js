const HALF_HOUR_MS = 30 * 60 * 1000;

export function elapsedMinutes(start, end) {
  const duration = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error("El horario de salida no puede ser anterior al ingreso.");
  }
  return Math.ceil(duration / 60000);
}

export function startedFractions(start, end) {
  const duration = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error("El horario de salida no puede ser anterior al ingreso.");
  }
  return Math.max(1, Math.ceil(duration / HALF_HOUR_MS));
}

export function calculateSuggestedAmount({ start, end, mode, prices }) {
  if (mode === "fraction") {
    const fractions = startedFractions(start, end);
    return { amountCents: fractions * prices.fractionCents, fractions };
  }
  if (mode === "daily") {
    return { amountCents: prices.dailyCents, fractions: null };
  }
  if (mode === "24h") {
    return { amountCents: prices.fullDayCents, fractions: null };
  }
  throw new Error("Modalidad de cobro inválida.");
}

