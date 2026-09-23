const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const state = { user: null, dashboard: null, categories: [], allCategories: [], capacitySectors: [], methods: [], taxConditions: [], arcaLookupConfigured: false, arcaBillingConfigured: false, tickets: [], users: [], subscribers: [], invoices: [], quote: null };

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
  $("#user-role").textContent = ({ admin: "Administrador", coordinator: "Coordinador", employee: "Empleado", viewer: "Consulta / recorredor" })[state.user.role];
  $$('[data-admin]').forEach((el) => el.classList.toggle("hidden", state.user.role !== "admin"));
  $$('[data-operational]').forEach((el) => el.classList.toggle("hidden", state.user.role === "viewer"));
}

async function loadAll() {
  const [dashboard, categories, methods, taxConditions, tickets, subscribers, users, allCategories, capacitySectors, invoices] = await Promise.all([
    request("/api/dashboard"), request("/api/categories"), request("/api/payment-methods"), request("/api/tax-conditions"),
    request("/api/tickets"),
    request("/api/subscribers"),
    state.user.role === "admin" ? request("/api/users") : Promise.resolve({ users: [] }),
    state.user.role === "admin" ? request("/api/categories/all") : Promise.resolve({ categories: [] }),
    state.user.role === "admin" ? request("/api/capacity-sectors") : Promise.resolve({ sectors: [] }),
    state.user.role === "viewer" ? Promise.resolve({ invoices: [] }) : request("/api/invoices")
  ]);
  state.dashboard = dashboard;
  state.categories = categories.categories;
  state.methods = methods.methods;
  state.taxConditions = taxConditions.conditions;
  state.arcaLookupConfigured = taxConditions.arcaLookupConfigured;
  state.arcaBillingConfigured = taxConditions.arcaBillingConfigured;
  state.tickets = tickets.tickets;
  state.users = users?.users || [];
  state.subscribers = subscribers.subscribers;
  state.allCategories = allCategories.categories;
  state.capacitySectors = capacitySectors.sectors;
  state.invoices = invoices.invoices;
  renderDashboard(dashboard);
  renderCategories();
  renderTickets();
  renderRates();
  renderUsers();
  renderSubscribers();
  renderCategoryAdmin();
  renderCapacitySectors();
  renderTaxConditions();
  renderInvoices();
}

function renderUsers() {
  const tbody = $("#users-body");
  if (!tbody) return;
  tbody.innerHTML = state.users.map((item) => `
    <tr data-user-id="${item.id}">
      <td><input class="user-name-input" value="${escapeHtml(item.display_name)}"></td>
      <td><strong>${escapeHtml(item.username)}</strong></td>
      <td><select class="role-select"><option value="employee" ${item.role === "employee" ? "selected" : ""}>Empleado / cajero</option><option value="coordinator" ${item.role === "coordinator" ? "selected" : ""}>Coordinador</option><option value="viewer" ${item.role === "viewer" ? "selected" : ""}>Consulta / recorredor</option><option value="admin" ${item.role === "admin" ? "selected" : ""}>Administrador</option></select></td>
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
  $("#stat-car-available").textContent = capacityText(data.capacity.car);
  $("#stat-moto-available").textContent = capacityText(data.capacity.motorcycle);
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
  updateEntryCapacity();
}

function capacityText(item) {
  return item.capacity > 0 ? `${item.available} de ${item.capacity}` : "Sin configurar";
}

function renderCategories() {
  $("#entry-category").innerHTML = state.categories.map((category) => `<option value="${category.id}">${category.name}</option>`).join("");
  $("#subscriber-category").innerHTML = state.categories.map((category) => `<option value="${category.id}">${category.name}</option>`).join("");
  updateEntryCapacity();
}

function renderCategoryAdmin() {
  const tbody = $("#categories-admin-body");
  if (!tbody) return;
  tbody.innerHTML = state.allCategories.map((category) => `
    <tr data-category-id="${category.id}">
      <td><input class="category-name-input" value="${escapeHtml(category.name)}"></td>
      <td><select class="category-group"><option value="car" ${category.capacity_group === "car" ? "selected" : ""}>Auto/camioneta</option><option value="motorcycle" ${category.capacity_group === "motorcycle" ? "selected" : ""}>Moto</option></select></td>
      <td>${category.ticket_count} ticket/s · ${category.subscriber_count} abonado/s</td>
      <td><label class="status-toggle"><input class="category-active" type="checkbox" ${category.active ? "checked" : ""}> Activa</label></td>
      <td><button type="button" class="secondary save-category">Guardar</button></td>
    </tr>
  `).join("");
  $$(".save-category", tbody).forEach((button) => button.onclick = () => saveCategory(button.closest("tr")));
}

async function saveCategory(row) {
  try {
    await request(`/api/categories/${row.dataset.categoryId}`, { method: "PATCH", body: JSON.stringify({
      name: $(".category-name-input", row).value,
      capacityGroup: $(".category-group", row).value,
      active: $(".category-active", row).checked
    }) });
    toast("Categoría actualizada."); await loadAll();
  } catch (error) { toast(error.message, true); }
}

function renderCapacitySectors() {
  const tbody = $("#sectors-body");
  if (!tbody) return;
  tbody.innerHTML = state.capacitySectors.map((sector) => `
    <tr data-sector-id="${sector.id}">
      <td><input class="sector-name" value="${escapeHtml(sector.name)}"></td>
      <td><select class="sector-group"><option value="car" ${sector.capacity_group === "car" ? "selected" : ""}>Autos/camionetas</option><option value="motorcycle" ${sector.capacity_group === "motorcycle" ? "selected" : ""}>Motos</option></select></td>
      <td><select class="sector-purpose"><option value="casual" ${sector.purpose === "casual" ? "selected" : ""}>Alquiler diario</option><option value="subscriber" ${sector.purpose === "subscriber" ? "selected" : ""}>Abonados</option><option value="mixed" ${sector.purpose === "mixed" ? "selected" : ""}>Uso mixto</option></select></td>
      <td><input class="sector-capacity" type="number" min="0" step="1" value="${sector.capacity}"></td>
      <td><label class="status-toggle"><input class="sector-active" type="checkbox" ${sector.active ? "checked" : ""}> Activo</label></td>
      <td><button type="button" class="secondary save-sector">Guardar</button></td>
    </tr>
  `).join("");
  $("#empty-sectors").classList.toggle("hidden", state.capacitySectors.length > 0);
  $$(".save-sector", tbody).forEach((button) => button.onclick = () => saveSector(button.closest("tr")));
}

async function saveSector(row) {
  try {
    await request(`/api/capacity-sectors/${row.dataset.sectorId}`, { method: "PATCH", body: JSON.stringify({
      name: $(".sector-name", row).value, capacityGroup: $(".sector-group", row).value,
      purpose: $(".sector-purpose", row).value, capacity: Number($(".sector-capacity", row).value),
      active: $(".sector-active", row).checked
    }) });
    toast("Capacidad actualizada."); await loadAll();
  } catch (error) { toast(error.message, true); }
}

function selectedCapacity() {
  const categoryId = Number($("#entry-category").value);
  const category = state.categories.find((item) => item.id === categoryId);
  return category && state.dashboard ? state.dashboard.capacity[category.capacity_group] : null;
}

function updateEntryCapacity() {
  const box = $("#entry-capacity");
  if (!box) return;
  const capacity = selectedCapacity();
  const strong = $("strong", box);
  if (!capacity || capacity.capacity === 0) {
    strong.textContent = "Sin límite configurado";
    box.classList.remove("full");
    return;
  }
  strong.textContent = `${capacity.available} lugares disponibles de ${capacity.capacity}`;
  box.classList.toggle("full", capacity.available <= 0);
}

function renderSubscribers() {
  const tbody = $("#subscribers-body");
  const labels = { active: "Activo", suspended: "Suspendido", inactive: "Inactivo" };
  tbody.innerHTML = state.subscribers.map((item) => {
    const statusAction = item.status === "suspended"
      ? `<button type="button" class="secondary subscriber-status" data-status="active">Reactivar</button>`
      : item.status === "active" ? `<button type="button" class="secondary subscriber-status" data-status="suspended">Suspender</button>`
      : state.user.role === "admin" ? `<button type="button" class="secondary subscriber-status" data-status="active">Reactivar</button>` : "";
    const editAction = state.user.role === "admin" ? `<button type="button" class="secondary edit-subscriber">Editar</button>` : "";
    const deactivateAction = state.user.role === "admin" && item.status !== "inactive" ? `<button type="button" class="secondary subscriber-status" data-status="inactive">Dar de baja</button>` : "";
    const actions = state.user.role === "employee" ? "" : `${editAction}${statusAction}${deactivateAction}`;
    return `<tr data-subscriber-id="${item.id}">
      <td><span class="subscriber-contact"><strong>${escapeHtml(item.full_name)}</strong><small>${escapeHtml(item.document || item.phone || "Sin datos de contacto")}</small></span></td>
      <td>${item.plan === "full" ? "Mensual completo" : "Mensual diurno"}<br><small>${escapeHtml(item.category_name)}</small></td>
      <td><div class="plate-tags">${item.plates.map((plate) => `<span class="plate-tag">${escapeHtml(plate)}</span>`).join("")}</div></td>
      <td><span class="state-badge state-${item.status}" title="${escapeHtml(item.suspension_reason || "")}">${labels[item.status]}</span></td>
      <td><div class="table-actions">${actions}</div></td>
    </tr>`;
  }).join("");
  $("#empty-subscribers").classList.toggle("hidden", state.subscribers.length > 0);
  $$(".edit-subscriber", tbody).forEach((button) => button.onclick = () => editSubscriber(Number(button.closest("tr").dataset.subscriberId)));
  $$(".subscriber-status", tbody).forEach((button) => button.onclick = () => changeSubscriberStatus(Number(button.closest("tr").dataset.subscriberId), button.dataset.status));
}

function editSubscriber(id) {
  const item = state.subscribers.find((subscriber) => subscriber.id === id);
  const form = $("#subscriber-form");
  form.subscriberId.value = item.id;
  form.fullName.value = item.full_name;
  form.document.value = item.document || "";
  form.phone.value = item.phone || "";
  form.email.value = item.email || "";
  form.plan.value = item.plan;
  form.categoryId.value = item.category_id;
  form.startDate.value = item.start_date;
  form.plates.value = item.plates.join(", ");
  $("#subscriber-form-title").textContent = "Modificar abonado";
  $("#cancel-subscriber-edit").classList.remove("hidden");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetSubscriberForm() {
  const form = $("#subscriber-form");
  form.reset();
  form.subscriberId.value = "";
  form.startDate.value = new Date().toISOString().slice(0, 10);
  $("#subscriber-form-title").textContent = "Agregar abonado";
  $("#cancel-subscriber-edit").classList.add("hidden");
}

async function changeSubscriberStatus(id, status) {
  let reason = "";
  if (status === "suspended") {
    reason = prompt("Indicá el motivo de la suspensión:") ?? "";
    if (!reason.trim()) return;
  }
  if (status === "inactive" && !confirm("¿Dar de baja este abonado? Su historial se conservará.")) return;
  try {
    await request(`/api/subscribers/${id}/status`, { method: "POST", body: JSON.stringify({ status, reason }) });
    toast(status === "active" ? "Abonado reactivado." : status === "suspended" ? "Abonado suspendido." : "Abonado dado de baja.");
    await loadAll();
  } catch (error) { toast(error.message, true); }
}

function renderTickets() {
  const tbody = $("#tickets-body");
  const query = $("#vehicle-search").value.trim().toUpperCase();
  const tickets = state.tickets.filter((ticket) => !query || ticket.plate.includes(query));
  tbody.innerHTML = tickets.map((ticket) => `
    <tr><td>${ticket.plate}</td><td>${ticket.category_name}</td><td>${dateTime(ticket.entry_at)}</td><td>${duration(ticket.entry_at)}</td><td>${state.user.role === "viewer" ? "" : `<button class="primary charge" data-id="${ticket.id}">Cobrar</button>`}</td></tr>
  `).join("");
  $("#empty-tickets").textContent = query ? "No se encontraron vehículos con esa patente." : "No hay vehículos dentro.";
  $("#empty-tickets").classList.toggle("hidden", tickets.length > 0);
  $$(".charge", tbody).forEach((button) => button.onclick = () => openCharge(Number(button.dataset.id)));
}

function renderTaxConditions() {
  $("#charge-tax-condition").innerHTML = state.taxConditions.map((condition) => `<option value="${condition.id}" ${condition.id === 5 ? "selected" : ""}>${escapeHtml(condition.name)}</option>`).join("");
}

function renderInvoices() {
  const tbody = $("#invoices-body");
  if (!tbody) return;
  const statusLabels = { pending: "Pendiente", authorizing: "Enviando", authorized: "Autorizada", rejected: "Rechazada", error: "Error", cancelled: "Cancelada" };
  tbody.innerHTML = state.invoices.map((invoice) => `<tr>
    <td>${escapeHtml(invoice.plate)}<br><small>${dateTime(invoice.requested_at)}</small></td>
    <td>${escapeHtml(invoice.customer_name || "Consumidor final")}${invoice.doc_number ? `<br><small>${escapeHtml(invoice.doc_number)}</small>` : ""}</td>
    <td>${escapeHtml(invoice.tax_condition_name)}</td><td>${money(invoice.charged_cents)}</td>
    <td><span class="state-badge state-${invoice.status === "authorized" ? "active" : invoice.status === "pending" ? "suspended" : "inactive"}">${statusLabels[invoice.status]}</span>
      ${invoice.voucher_number ? `<br><small>${String(invoice.point_of_sale).padStart(4, "0")}-${String(invoice.voucher_number).padStart(8, "0")}</small>` : ""}
      ${invoice.error_message ? `<br><small title="${escapeHtml(invoice.error_message)}">${escapeHtml(invoice.error_message)}</small>` : ""}</td>
    <td>${new Set(["pending", "error"]).has(invoice.status) ? `<button class="authorize-invoice secondary" data-id="${invoice.id}" ${state.arcaBillingConfigured ? "" : "disabled"}>Emitir en ARCA</button>` : "—"}</td>
  </tr>`).join("");
  $("#empty-invoices").classList.toggle("hidden", state.invoices.length > 0);
  $("#invoice-connection-status").textContent = state.arcaBillingConfigured ? "Conexión con ARCA configurada" : "Falta configurar la conexión con ARCA";
  $$(".authorize-invoice", tbody).forEach((button) => button.onclick = async () => {
    if (!confirm("Se enviará el comprobante a ARCA para obtener el CAE. Esta operación fiscal no se puede deshacer desde el sistema. ¿Continuar?")) return;
    button.disabled = true;
    button.textContent = "Enviando…";
    try {
      await request(`/api/invoices/${button.dataset.id}/authorize`, { method: "POST", body: "{}" });
      toast("Factura autorizada por ARCA.");
    } catch (error) {
      toast(error.message, true);
    }
    await loadAll();
  });
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
  form.taxConditionId.value = "5";
  form.invoiceRequested.checked = false;
  form.customerName.value = "";
  form.customerDocType.value = "80";
  form.customerDocNumber.value = "";
  form.dataset.verifiedCuit = "";
  $("#arca-lookup-status").textContent = "";
  toggleCustomerFiscalFields();
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
    state.user = result.user; showApp(); resetSubscriberForm(); await loadAll();
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
$("#create-category-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await request("/api/categories", { method: "POST", body: JSON.stringify({ name: form.name.value, capacityGroup: form.capacityGroup.value }) });
    form.reset(); toast("Categoría creada."); await loadAll();
  } catch (error) { toast(error.message, true); }
};
$("#create-sector-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    await request("/api/capacity-sectors", { method: "POST", body: JSON.stringify({ ...data, capacity: Number(data.capacity) }) });
    form.reset(); toast("Piso o sector agregado."); await loadAll();
  } catch (error) { toast(error.message, true); }
};
$("#subscriber-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const raw = Object.fromEntries(new FormData(form));
  const id = raw.subscriberId;
  const payload = {
    fullName: raw.fullName, document: raw.document, phone: raw.phone, email: raw.email,
    plan: raw.plan, categoryId: Number(raw.categoryId), startDate: raw.startDate,
    plates: raw.plates.split(/[\s,;]+/).filter(Boolean)
  };
  try {
    await request(id ? `/api/subscribers/${id}` : "/api/subscribers", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
    resetSubscriberForm(); toast(id ? "Abonado actualizado." : "Abonado creado correctamente."); await loadAll();
  } catch (error) { toast(error.message, true); }
};
$("#cancel-subscriber-edit").onclick = resetSubscriberForm;
$("#refresh").onclick = () => loadAll().catch((error) => toast(error.message, true));
$("#vehicle-search").oninput = renderTickets;
$("#backup-now").onclick = async () => {
  try { await request("/api/backups", { method: "POST", body: "{}" }); toast("Respaldo creado y verificado."); await loadAll(); }
  catch (error) { toast(error.message, true); }
};
$("#entry-form").onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const capacity = selectedCapacity();
  if (capacity?.capacity > 0 && capacity.available <= 0) {
    const reason = prompt("No quedan lugares disponibles. Indicá el motivo para autorizar igualmente el ingreso:");
    if (!reason?.trim()) return;
    data.capacityOverride = true;
    data.capacityReason = reason.trim();
  }
  try {
    await request("/api/tickets", { method: "POST", body: JSON.stringify(data) });
    event.currentTarget.reset(); toast(`Ingreso de ${data.plate.toUpperCase()} registrado.`); await loadAll();
  } catch (error) { toast(error.message, true); }
};
$("#entry-category").onchange = updateEntryCapacity;

$("#charge-form").mode.onchange = updateQuote;
$("#charge-form").taxConditionId.onchange = toggleCustomerFiscalFields;
$("#charge-form").invoiceRequested.onchange = toggleCustomerFiscalFields;
function toggleCustomerFiscalFields() {
  const form = $("#charge-form");
  const mustIdentify = Number(form.taxConditionId.value) !== 5;
  $("#customer-fiscal-fields").classList.toggle("hidden", !mustIdentify && !form.invoiceRequested.checked);
  form.customerName.required = mustIdentify;
  form.customerDocNumber.required = mustIdentify;
  form.customerName.readOnly = mustIdentify;
  if (mustIdentify) form.customerDocType.value = "80";
  form.customerDocType.disabled = mustIdentify;
  $("#lookup-cuit").classList.toggle("hidden", form.customerDocType.value !== "80");
  if (mustIdentify && !state.arcaLookupConfigured) {
    $("#arca-lookup-status").textContent = "La conexión con ARCA requiere configurar el certificado.";
  }
}

async function lookupCuit() {
  const form = $("#charge-form");
  const cuit = form.customerDocNumber.value.replace(/\D/g, "");
  form.customerDocNumber.value = cuit;
  form.dataset.verifiedCuit = "";
  form.customerName.value = "";
  if (cuit.length !== 11) {
    $("#arca-lookup-status").textContent = "El CUIT debe tener 11 dígitos.";
    return;
  }
  $("#arca-lookup-status").textContent = "Consultando ARCA…";
  $("#lookup-cuit").disabled = true;
  try {
    const taxpayer = await request(`/api/arca/taxpayers/${cuit}`);
    form.customerName.value = taxpayer.legalName;
    form.dataset.verifiedCuit = taxpayer.cuit;
    $("#arca-lookup-status").textContent = taxpayer.status ? `Datos confirmados por ARCA · CUIT ${taxpayer.status}` : "Datos confirmados por ARCA";
  } catch (error) {
    $("#arca-lookup-status").textContent = error.message;
    toast(error.message, true);
  } finally {
    $("#lookup-cuit").disabled = false;
  }
}

$("#lookup-cuit").onclick = lookupCuit;
$("#charge-form").customerDocType.onchange = toggleCustomerFiscalFields;
$("#charge-form").customerDocNumber.oninput = () => {
  const form = $("#charge-form");
  form.dataset.verifiedCuit = "";
  if (form.customerDocType.value === "80") form.customerName.value = "";
  $("#arca-lookup-status").textContent = "";
  clearTimeout(lookupCuit.timer);
  const cuit = form.customerDocNumber.value.replace(/\D/g, "");
  if (form.customerDocType.value === "80" && cuit.length === 11) lookupCuit.timer = setTimeout(lookupCuit, 500);
};
$("#charge-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const mustIdentify = Number(form.taxConditionId.value) !== 5;
    const enteredCuit = form.customerDocNumber.value.replace(/\D/g, "");
    if (mustIdentify && form.dataset.verifiedCuit !== enteredCuit) throw new Error("Debe consultar y confirmar el CUIT en ARCA antes de cobrar.");
    const payments = $$(".payment-row", form).map((row) => ({
      methodId: Number($("select", row).value), amountCents: Math.round(Number($("input", row).value) * 100)
    }));
    await request(`/api/tickets/${form.ticketId.value}/close`, { method: "POST", body: JSON.stringify({
      mode: form.mode.value,
      chargedCents: Math.round(Number(form.chargedAmount.value) * 100),
      exceptionReason: form.exceptionReason.value,
      taxConditionId: Number(form.taxConditionId.value),
      invoiceRequested: form.invoiceRequested.checked,
      customerName: form.customerName.value,
      customerDocType: form.customerDocNumber.value ? Number(form.customerDocType.value) : null,
      customerDocNumber: form.customerDocNumber.value,
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
  $("#page-title").textContent = ({ rates: "Categorías y tarifas", capacity: "Capacidad de la cochera", invoices: "Facturación electrónica", users: "Empleados y usuarios", subscribers: "Abonados mensuales", operation: "Movimiento del día" })[button.dataset.view];
});

request("/api/session").then(async ({ user }) => {
  state.user = user; showApp(); resetSubscriberForm(); await loadAll();
}).catch(() => {});
