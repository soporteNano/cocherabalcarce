const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const state = { user: null, categories: [], methods: [], tickets: [], users: [], quote: null };

const money = (cents = 0) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(cents / 100);
const dateTime = (value) => new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const duration = (value) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
};

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.className = "toast", 3200);
}

function showApp() {
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#user-name").textContent = state.user.display_name;
  $("#user-role").textContent = ({ admin: "Administrador", coordinator: "Coordinador", employee: "Empleado" })[state.user.role];
  $$('[data-admin]').forEach((el) => el.classList.toggle("hidden", state.user.role !== "admin"));
}

async function loadAll() {
  const calls = [
    request("/api/dashboard"), request("/api/categories"), request("/api/payment-methods"), request("/api/tickets")
  ];
  if (state.user.role === "admin") calls.push(request("/api/users"));
  const [dashboard, categories, methods, tickets, users] = await Promise.all(calls);
  state.categories = categories.categories;
  state.methods = methods.methods;
  state.tickets = tickets.tickets;
  state.users = users?.users || [];
  renderDashboard(dashboard);
  renderCategories();
  renderTickets();
  renderRates();
  renderUsers();
}

const roleLabel = (role) => ({ employee: "Empleado / cajero", coordinator: "Coordinador", admin: "Administrador" })[role] || role;

function renderUsers() {
  const tbody = $("#users-body");
  if (!tbody) return;
  tbody.innerHTML = state.users.map((item) => `
    <tr data-user-id="${item.id}">
      <td><input class="user-name-input" value="${escapeHtml(item.display_name)}"></td>
      <td><strong>${escapeHtml(item.username)}</strong></td>
      <td><select class="role-select"><option value="employee" ${item.role === "employee" ? "selected" : ""}>Empleado / cajero</option><option value="coordinator" ${item.role === "coordinator" ? "selected" : ""}>Coordinador</option><option value="admin" ${item.role === "admin" ? "selected" : ""}>Administrador</option></select></td>
      <td><label class="status-toggle"><input type="checkbox" class="active-toggle" ${item.active ? "checked" : ""}> Activo</label></td>
      <td><div class="table-actions"><button class="secondary save-user" type="button">Guardar</button><button class="secondary reset-password" type="button">Contraseña</button></div></td>
    </tr>
  `).join("");
  $$(".save-user", tbody).forEach((button) => button.onclick = () => saveUser(button.closest("tr")));
  $$(".reset-password", tbody).forEach((button) => button.onclick = () => resetPassword(button.closest("tr")));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

async function saveUser(row) {
  try {
    await request(`/api/users/${row.dataset.userId}`, { method: "PATCH", body: JSON.stringify({
      displayName: $(".user-name-input", row).value,
      role: $(".role-select", row).value,
      active: $(".active-toggle", row).checked
    }) });
    toast("Usuario actualizado."); await loadAll();
  } catch (error) { toast(error.message, true); }
}

async function resetPassword(row) {
  const password = prompt("Ingresá la nueva contraseña (mínimo 8 caracteres):");
  if (password === null) return;
  try {
    await request(`/api/users/${row.dataset.userId}/password`, { method: "POST", body: JSON.stringify({ password }) });
    toast("Contraseña actualizada.");
  } catch (error) { toast(error.message, true); }
}

function renderDashboard(data) {
  $("#stat-open").textContent = data.open_count || 0;
  $("#stat-exits").textContent = data.exits_today || 0;
  $("#stat-charged").textContent = money(data.charged_today);
  const chip = $("#shift-status");
  const panel = $("#shift-panel");
  if ($("#backup-status")) $("#backup-status").textContent = data.backup.lastBackupAt ? `Última copia: ${dateTime(data.backup.lastBackupAt)} · ${data.backup.copies} copia/s` : "Todavía no se creó ninguna copia.";
  if (data.shift) {
    chip.textContent = `Turno abierto · ${data.shift.user_name}`;
    chip.className = "status-chip open";
    panel.innerHTML = `<div class="section-heading"><div><p class="eyebrow">Caja activa</p><h3>Turno iniciado ${dateTime(data.shift.opened_at)}</h3></div><button id="close-shift" class="secondary">Cerrar caja</button></div>`;
    $("#close-shift").onclick = closeShift;
  } else {
    chip.textContent = "Caja cerrada";
    chip.className = "status-chip";
    panel.innerHTML = `<div class="section-heading"><div><p class="eyebrow">Antes de operar</p><h3>Abrir un turno de caja</h3></div><form id="open-shift-form" class="section-heading"><input name="opening" type="number" min="0" step="0.01" placeholder="Efectivo inicial" required><button class="primary">Abrir caja</button></form></div>`;
    $("#open-shift-form").onsubmit = openShift;
  }
}

function renderCategories() {
  $("#entry-category").innerHTML = state.categories.map((category) => `<option value="${category.id}">${category.name}</option>`).join("");
}

function renderTickets() {
  const tbody = $("#tickets-body");
  tbody.innerHTML = state.tickets.map((ticket) => `
    <tr><td>${ticket.plate}</td><td>${ticket.category_name}</td><td>${dateTime(ticket.entry_at)}</td><td>${duration(ticket.entry_at)}</td><td><button class="primary charge" data-id="${ticket.id}">Cobrar</button></td></tr>
  `).join("");
  $("#empty-tickets").classList.toggle("hidden", state.tickets.length > 0);
  $$(".charge", tbody).forEach((button) => button.onclick = () => openCharge(Number(button.dataset.id)));
}

function renderRates() {
  $("#rate-cards").innerHTML = state.categories.map((category) => `
    <form class="rate-card" data-category="${category.id}">
      <h4>${category.name}</h4>
      <div class="rate-fields">
        <label>30 minutos<input name="fraction" type="number" min="0" step="0.01" value="${(category.fraction_cents || 0) / 100}"></label>
        <label>Estadía diaria<input name="daily" type="number" min="0" step="0.01" value="${(category.daily_cents || 0) / 100}"></label>
        <label>24 horas<input name="fullDay" type="number" min="0" step="0.01" value="${(category.full_day_cents || 0) / 100}"></label>
        <label>Mensual completo<input name="monthly" type="number" min="0" step="0.01" value="${(category.monthly_cents || 0) / 100}"></label>
        <label>Mensual diurno<input name="monthlyDay" type="number" min="0" step="0.01" value="${(category.monthly_day_cents || 0) / 100}"></label>
      </div>
      <button class="primary wide">${category.valid_from ? "Guardar para mañana" : "Guardar tarifa inicial"}</button>
    </form>
  `).join("");
  $$(".rate-card").forEach((form) => form.onsubmit = saveRate);
}

async function openShift(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await request("/api/shifts/open", { method: "POST", body: JSON.stringify({ openingCashCents: Math.round(Number(data.get("opening")) * 100) }) });
    toast("Turno abierto correctamente."); await loadAll();
  } catch (error) { toast(error.message, true); }
}

async function closeShift() {
  const value = prompt("Ingresá el efectivo contado al cerrar la caja:");
  if (value === null) return;
  const reportWindow = window.open("", "_blank", "width=760,height=850");
  try {
    const result = await request("/api/shifts/close", { method: "POST", body: JSON.stringify({ countedCashCents: Math.round(Number(value) * 100) }) });
    renderCloseReport(reportWindow, result.report);
    toast(`Caja cerrada. Efectivo esperado: ${money(result.report.expectedCashCents)}`); await loadAll();
  } catch (error) { if (reportWindow) reportWindow.close(); toast(error.message, true); }
}

function renderCloseReport(target, report) {
  if (!target) { toast("El navegador bloqueó la vista del comprobante.", true); return; }
  const payments = report.paymentTotals.length
    ? report.paymentTotals.map((item) => `<tr><td>${item.name}</td><td>${item.operations}</td><td>${money(item.amount_cents)}</td></tr>`).join("")
    : `<tr><td colspan="3">Sin cobros en el turno</td></tr>`;
  const vehicles = report.vehiclesInside.map((item) => `<tr><td>${item.category}</td><td>${item.quantity}</td></tr>`).join("");
  target.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cierre de caja #${report.shiftId}</title><style>
    body{font-family:Arial,sans-serif;color:#17231d;max-width:720px;margin:28px auto;padding:0 18px}h1{margin-bottom:4px}h2{margin-top:26px;font-size:18px;border-bottom:1px solid #ccc;padding-bottom:6px}.muted{color:#66736c}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}th:last-child,td:last-child{text-align:right}.totals{display:grid;grid-template-columns:1fr auto;gap:7px 18px}.strong{font-weight:bold;font-size:18px}.difference{color:${report.differenceCents === 0 ? "#175c44" : "#a33a31"}}button{margin:20px 0;padding:10px 16px;border:0;border-radius:8px;background:#175c44;color:white;font-weight:bold}@media print{button{display:none}body{margin:0}}
  </style></head><body><h1>Cochera Balcarce</h1><p class="muted">Comprobante de cierre de caja #${report.shiftId}</p>
  <p><strong>Apertura:</strong> ${dateTime(report.openedAt)} — ${report.openedBy}<br><strong>Cierre:</strong> ${dateTime(report.closedAt)} — ${report.closedBy}</p>
  <h2>Movimientos</h2><div class="totals"><span>Ingresos registrados</span><strong>${report.entries}</strong><span>Salidas cobradas</span><strong>${report.exits}</strong><span>Excepciones de precio</span><strong>${report.exceptions}</strong></div>
  <h2>Cobros por medio</h2><table><thead><tr><th>Medio</th><th>Operaciones</th><th>Total</th></tr></thead><tbody>${payments}</tbody></table>
  <h2>Arqueo</h2><div class="totals"><span>Efectivo inicial</span><strong>${money(report.openingCashCents)}</strong><span>Total cobrado</span><strong>${money(report.totalCollectedCents)}</strong><span>Efectivo esperado</span><strong>${money(report.expectedCashCents)}</strong><span>Efectivo contado</span><strong>${money(report.countedCashCents)}</strong><span class="strong">Diferencia</span><strong class="strong difference">${money(report.differenceCents)}</strong></div>
  <h2>Vehículos que quedan en la cochera</h2><table><tbody>${vehicles}<tr><td><strong>Total</strong></td><td><strong>${report.totalInside}</strong></td></tr></tbody></table>
  <button onclick="window.print()">Imprimir comprobante</button></body></html>`);
  target.document.close();
}

async function openCharge(id) {
  const ticket = state.tickets.find((item) => item.id === id);
  const form = $("#charge-form");
  form.ticketId.value = id;
  $("#charge-title").textContent = `Cobrar ${ticket.plate}`;
  state.quote = null;
  $("#payment-rows").innerHTML = "";
  addPaymentRow();
  $("#charge-dialog").showModal();
  await updateQuote();
}

async function updateQuote() {
  const form = $("#charge-form");
  try {
    state.quote = await request(`/api/tickets/${form.ticketId.value}/quote`, { method: "POST", body: JSON.stringify({ mode: form.mode.value }) });
    $("#quote-time").textContent = `${state.quote.elapsedMinutes} minutos`;
    $("#quote-amount").textContent = money(state.quote.amountCents);
    $("#quote-detail").textContent = state.quote.fractions ? `${state.quote.fractions} fracción/es iniciada/s` : "Tarifa fija";
    form.chargedAmount.value = (state.quote.amountCents / 100).toFixed(2);
    const rows = $$(".payment-row", form);
    if (rows.length === 1) $("input", rows[0]).value = (state.quote.amountCents / 100).toFixed(2);
  } catch (error) { toast(error.message, true); $("#charge-dialog").close(); }
}

async function saveRate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const toCents = (name) => Math.round(Number(data.get(name)) * 100);
  try {
    const category = state.categories.find((item) => item.id === Number(form.dataset.category));
    const today = new Date().toISOString().slice(0, 10);
    await request("/api/tariffs", { method: "POST", body: JSON.stringify({
      categoryId: Number(form.dataset.category), fractionCents: toCents("fraction"), dailyCents: toCents("daily"),
      fullDayCents: toCents("fullDay"), monthlyCents: toCents("monthly"), monthlyDayCents: toCents("monthlyDay"),
      validFrom: category.valid_from ? undefined : today
    }) });
    toast(category.valid_from ? "Tarifa guardada. Entrará en vigencia mañana." : "Tarifa inicial guardada y vigente.");
    await loadAll();
  } catch (error) { toast(error.message, true); }
}

$("#login-form").onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const result = await request("/api/login", { method: "POST", body: JSON.stringify(data) });
    state.user = result.user; showApp(); await loadAll();
  } catch (error) { $("#login-error").textContent = error.message; }
};

$("#logout").onclick = async () => { await request("/api/logout", { method: "POST" }); location.reload(); };
$("#create-user-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    await request("/api/users", { method: "POST", body: JSON.stringify(data) });
    form.reset(); toast("Empleado creado correctamente."); await loadAll();
  } catch (error) { toast(error.message, true); }
};
$("#refresh").onclick = () => loadAll().catch((error) => toast(error.message, true));
$("#backup-now").onclick = async () => {
  try { await request("/api/backups", { method: "POST", body: "{}" }); toast("Respaldo creado y verificado."); await loadAll(); }
  catch (error) { toast(error.message, true); }
};
$("#entry-form").onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await request("/api/tickets", { method: "POST", body: JSON.stringify(data) });
    event.currentTarget.reset(); toast(`Ingreso de ${data.plate.toUpperCase()} registrado.`); await loadAll();
  } catch (error) { toast(error.message, true); }
};

$("#charge-form").mode.onchange = updateQuote;
$("#charge-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const payments = $$(".payment-row", form).map((row) => ({
      methodId: Number($("select", row).value), amountCents: Math.round(Number($("input", row).value) * 100)
    }));
    await request(`/api/tickets/${form.ticketId.value}/close`, { method: "POST", body: JSON.stringify({
      mode: form.mode.value,
      chargedCents: Math.round(Number(form.chargedAmount.value) * 100),
      exceptionReason: form.exceptionReason.value,
      payments
    }) });
    $("#charge-dialog").close(); form.reset(); toast("Cobro y salida registrados."); await loadAll();
  } catch (error) { toast(error.message, true); }
};
$$('[data-close-dialog]').forEach((button) => button.onclick = () => $("#charge-dialog").close());
$("#add-payment").onclick = () => addPaymentRow(0);

function addPaymentRow(amount) {
  const row = document.createElement("div");
  row.className = "payment-row";
  row.innerHTML = `<select>${state.methods.map((method) => `<option value="${method.id}">${method.name}</option>`).join("")}</select><input type="number" min="0" step="0.01" value="${amount ?? ""}" required><button type="button" class="remove-payment" title="Quitar">×</button>`;
  $("#payment-rows").append(row);
  $(".remove-payment", row).onclick = () => { if ($$(".payment-row").length > 1) row.remove(); };
  if ($$(".payment-row").length === 1 && state.quote) $("input", row).value = (state.quote.amountCents / 100).toFixed(2);
}

$$('.nav-item').forEach((button) => button.onclick = () => {
  $$('.nav-item').forEach((item) => item.classList.toggle("active", item === button));
  $$('.page-view').forEach((view) => view.classList.add("hidden"));
  $(`#${button.dataset.view}-view`).classList.remove("hidden");
  $("#page-title").textContent = ({ rates: "Configuración de tarifas", users: "Empleados y usuarios", operation: "Movimiento del día" })[button.dataset.view];
});

request("/api/session").then(async ({ user }) => {
  state.user = user; showApp(); await loadAll();
}).catch(() => {});
