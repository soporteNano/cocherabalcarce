import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { db, audit, activeTariff, nowIso, databasePath } from "./db.js";
import { hashPassword, verifyPassword } from "./security.js";
import { calculateSuggestedAmount, elapsedMinutes } from "./pricing.js";
import { backupStatus, runBackup, startBackupScheduler } from "./backup.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 3210);
const sessions = new Map();

const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(value));
};

const parseCookies = (header = "") => Object.fromEntries(
  header.split(";").map((item) => item.trim().split("=")).filter(([key]) => key)
);

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Solicitud demasiado grande.");
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error("JSON inválido."); }
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) return null;
  return db.prepare("SELECT id, username, display_name, role FROM users WHERE id = ? AND active = 1").get(session.userId) || null;
}

function requireUser(req, res, roles) {
  const user = currentUser(req);
  if (!user) { json(res, 401, { error: "Debe iniciar sesión." }); return null; }
  if (roles && !roles.includes(user.role)) { json(res, 403, { error: "No tiene permisos para esta acción." }); return null; }
  return user;
}

function openShift() {
  return db.prepare(`
    SELECT s.*, u.display_name user_name
    FROM shifts s JOIN users u ON u.id = s.user_id
    WHERE s.closed_at IS NULL LIMIT 1
  `).get();
}

function capacitySnapshot() {
  const result = {};
  for (const group of ["car", "motorcycle"]) {
    const capacity = db.prepare(`
      SELECT COALESCE(SUM(capacity), 0) total FROM capacity_sectors
      WHERE active = 1 AND capacity_group = ? AND purpose IN ('casual', 'mixed')
    `).get(group).total;
    const occupied = db.prepare(`
      SELECT COUNT(*) total FROM tickets t JOIN categories c ON c.id = t.category_id
      WHERE t.status = 'open' AND c.capacity_group = ?
    `).get(group).total;
    result[group] = { capacity, occupied, available: Math.max(0, capacity - occupied), overCapacity: Math.max(0, occupied - capacity) };
  }
  return result;
}

function normalizePlate(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function cents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("Importe inválido.");
  return Math.round(number);
}

function tomorrowDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

const validRoles = new Set(["employee", "coordinator", "admin"]);

function validatePassword(password) {
  if (String(password || "").length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres.");
  return String(password);
}

function subscriberPayload(body) {
  const fullName = String(body.fullName || "").trim();
  const document = String(body.document || "").trim();
  const phone = String(body.phone || "").trim();
  const email = String(body.email || "").trim();
  const plan = String(body.plan || "");
  const categoryId = Number(body.categoryId);
  const startDate = String(body.startDate || "");
  const plates = [...new Set((Array.isArray(body.plates) ? body.plates : [])
    .map(normalizePlate).filter(Boolean))];
  if (fullName.length < 3) throw new Error("Ingrese el nombre completo del abonado.");
  if (!new Set(["full", "day"]).has(plan)) throw new Error("Plan de abono inválido.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Ingrese una fecha de alta válida.");
  if (plates.length === 0) throw new Error("Ingrese al menos una patente.");
  if (plates.some((plate) => plate.length < 5 || plate.length > 9)) throw new Error("Revise las patentes ingresadas.");
  const category = db.prepare("SELECT id FROM categories WHERE id = ? AND active = 1").get(categoryId);
  if (!category) throw new Error("Categoría inválida.");
  return { fullName, document, phone, email, plan, categoryId, startDate, plates };
}

async function api(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1").get(String(body.username || ""));
    if (!user || !verifyPassword(String(body.password || ""), user.password_hash)) {
      json(res, 401, { error: "Usuario o contraseña incorrectos." }); return;
    }
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    audit(user.id, "login", "session", token.slice(0, 8));
    json(res, 200, { user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } }, {
      "set-cookie": `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = parseCookies(req.headers.cookie).session;
    if (token) sessions.delete(token);
    json(res, 200, { ok: true }, { "set-cookie": "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
    return;
  }

  const user = requireUser(req, res);
  if (!user) return;

  if (req.method === "GET" && url.pathname === "/api/session") {
    json(res, 200, { user }); return;
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    if (!requireUser(req, res, ["admin"])) return;
    const users = db.prepare(`
      SELECT id, username, display_name, role, active, created_at
      FROM users ORDER BY active DESC, display_name COLLATE NOCASE
    `).all();
    json(res, 200, { users }); return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    if (!requireUser(req, res, ["admin"])) return;
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const displayName = String(body.displayName || "").trim();
    const role = String(body.role || "");
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) throw new Error("El usuario debe tener entre 3 y 30 caracteres y usar solo letras, números, punto, guion o guion bajo.");
    if (displayName.length < 3) throw new Error("Ingrese el nombre completo del empleado.");
    if (!validRoles.has(role)) throw new Error("Rol inválido.");
    const password = validatePassword(body.password);
    try {
      const result = db.prepare(`
        INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)
      `).run(username, displayName, hashPassword(password), role);
      audit(user.id, "create", "user", result.lastInsertRowid, { username, displayName, role });
      json(res, 201, { id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("Ese nombre de usuario ya existe.");
      throw error;
    }
    return;
  }

  const userMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (req.method === "PATCH" && userMatch) {
    if (!requireUser(req, res, ["admin"])) return;
    const targetId = Number(userMatch[1]);
    const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(targetId);
    if (!target) throw new Error("Usuario no encontrado.");
    const body = await readBody(req);
    const displayName = String(body.displayName || "").trim();
    const role = String(body.role || "");
    const active = body.active ? 1 : 0;
    if (displayName.length < 3) throw new Error("Ingrese el nombre completo del empleado.");
    if (!validRoles.has(role)) throw new Error("Rol inválido.");
    if (targetId === user.id && (!active || role !== "admin")) throw new Error("No puede quitarse su propio acceso de administrador.");
    db.prepare("UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?").run(displayName, role, active, targetId);
    audit(user.id, "update", "user", targetId, { displayName, role, active: Boolean(active) });
    json(res, 200, { ok: true }); return;
  }

  const passwordMatch = url.pathname.match(/^\/api\/users\/(\d+)\/password$/);
  if (req.method === "POST" && passwordMatch) {
    if (!requireUser(req, res, ["admin"])) return;
    const targetId = Number(passwordMatch[1]);
    const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(targetId);
    if (!target) throw new Error("Usuario no encontrado.");
    const body = await readBody(req);
    const password = validatePassword(body.password);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), targetId);
    audit(user.id, "reset_password", "user", targetId, { username: target.username });
    json(res, 200, { ok: true }); return;
  }

  if (req.method === "GET" && url.pathname === "/api/subscribers") {
    const rows = db.prepare(`
      SELECT s.id, s.full_name, s.document, s.phone, s.email, s.status, s.suspension_reason,
        s.created_at, sub.plan, sub.category_id, sub.start_date, sub.spaces, c.name category_name,
        COALESCE(GROUP_CONCAT(p.plate, ', '), '') plates
      FROM subscribers s
      JOIN subscriptions sub ON sub.subscriber_id = s.id
      JOIN categories c ON c.id = sub.category_id
      LEFT JOIN subscriber_plates p ON p.subscriber_id = s.id AND p.active = 1
      GROUP BY s.id ORDER BY s.status = 'active' DESC, s.full_name COLLATE NOCASE
    `).all();
    json(res, 200, { subscribers: rows.map((row) => ({ ...row, plates: row.plates ? row.plates.split(", ") : [] })) }); return;
  }

  if (req.method === "POST" && url.pathname === "/api/subscribers") {
    if (!requireUser(req, res, ["admin"])) return;
    const values = subscriberPayload(await readBody(req));
    const timestamp = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db.prepare(`
        INSERT INTO subscribers (full_name, document, phone, email, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(values.fullName, values.document || null, values.phone || null, values.email || null, user.id, timestamp, timestamp);
      const subscriberId = Number(result.lastInsertRowid);
      db.prepare(`
        INSERT INTO subscriptions (subscriber_id, plan, category_id, start_date, spaces, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(subscriberId, values.plan, values.categoryId, values.startDate, timestamp, timestamp);
      const insertPlate = db.prepare("INSERT INTO subscriber_plates (subscriber_id, plate, created_at) VALUES (?, ?, ?)");
      for (const plate of values.plates) insertPlate.run(subscriberId, plate, timestamp);
      audit(user.id, "create", "subscriber", subscriberId, values);
      db.exec("COMMIT");
      json(res, 201, { id: subscriberId });
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("subscriber_plates.plate")) throw new Error("Una de las patentes ya pertenece a otro abonado.");
      throw error;
    }
    return;
  }

  const subscriberMatch = url.pathname.match(/^\/api\/subscribers\/(\d+)$/);
  if (req.method === "PATCH" && subscriberMatch) {
    if (!requireUser(req, res, ["admin"])) return;
    const subscriberId = Number(subscriberMatch[1]);
    if (!db.prepare("SELECT id FROM subscribers WHERE id = ?").get(subscriberId)) throw new Error("Abonado no encontrado.");
    const values = subscriberPayload(await readBody(req));
    const timestamp = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`UPDATE subscribers SET full_name=?, document=?, phone=?, email=?, updated_at=? WHERE id=?`)
        .run(values.fullName, values.document || null, values.phone || null, values.email || null, timestamp, subscriberId);
      db.prepare(`UPDATE subscriptions SET plan=?, category_id=?, start_date=?, updated_at=? WHERE subscriber_id=?`)
        .run(values.plan, values.categoryId, values.startDate, timestamp, subscriberId);
      db.prepare("DELETE FROM subscriber_plates WHERE subscriber_id = ?").run(subscriberId);
      const insertPlate = db.prepare("INSERT INTO subscriber_plates (subscriber_id, plate, created_at) VALUES (?, ?, ?)");
      for (const plate of values.plates) insertPlate.run(subscriberId, plate, timestamp);
      audit(user.id, "update", "subscriber", subscriberId, values);
      db.exec("COMMIT");
      json(res, 200, { ok: true });
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("subscriber_plates.plate")) throw new Error("Una de las patentes ya pertenece a otro abonado.");
      throw error;
    }
    return;
  }

  const subscriberStatusMatch = url.pathname.match(/^\/api\/subscribers\/(\d+)\/status$/);
  if (req.method === "POST" && subscriberStatusMatch) {
    if (!requireUser(req, res, ["admin", "coordinator"])) return;
    const subscriberId = Number(subscriberStatusMatch[1]);
    const body = await readBody(req);
    const status = String(body.status || "");
    const reason = String(body.reason || "").trim();
    if (!new Set(["active", "suspended", "inactive"]).has(status)) throw new Error("Estado inválido.");
    if (status === "inactive" && user.role !== "admin") throw new Error("Solo el administrador puede dar de baja un abonado.");
    if (status === "suspended" && !reason) throw new Error("Debe indicar el motivo de la suspensión.");
    const result = db.prepare("UPDATE subscribers SET status=?, suspension_reason=?, updated_at=? WHERE id=?")
      .run(status, status === "suspended" ? reason : null, nowIso(), subscriberId);
    if (result.changes === 0) throw new Error("Abonado no encontrado.");
    audit(user.id, "change_status", "subscriber", subscriberId, { status, reason });
    json(res, 200, { ok: true }); return;
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const counts = db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'open' THEN 1 END) open_count,
        COUNT(CASE WHEN status = 'closed' AND date(exit_at, 'localtime') = date('now', 'localtime') THEN 1 END) exits_today,
        COALESCE(SUM(CASE WHEN status = 'closed' AND date(exit_at, 'localtime') = date('now', 'localtime') THEN charged_cents ELSE 0 END), 0) charged_today
      FROM tickets
    `).get();
    json(res, 200, { ...counts, shift: openShift(), databasePath, backup: backupStatus(), capacity: capacitySnapshot() }); return;
  }

  if (req.method === "POST" && url.pathname === "/api/backups") {
    if (!requireUser(req, res, ["admin"])) return;
    json(res, 201, runBackup(user.id, true)); return;
  }

  if (req.method === "GET" && url.pathname === "/api/categories") {
    const rows = db.prepare(`
      SELECT c.*, t.fraction_cents, t.daily_cents, t.full_day_cents, t.monthly_cents, t.monthly_day_cents, t.valid_from
      FROM categories c
      LEFT JOIN tariffs t ON t.id = (
        SELECT id FROM tariffs WHERE category_id = c.id AND valid_from <= date('now', 'localtime')
        ORDER BY valid_from DESC, id DESC LIMIT 1
      )
      WHERE c.active = 1 ORDER BY c.name
    `).all();
    json(res, 200, { categories: rows }); return;
  }

  if (req.method === "GET" && url.pathname === "/api/categories/all") {
    if (!requireUser(req, res, ["admin"])) return;
    const rows = db.prepare(`
      SELECT c.id, c.name, c.capacity_group, c.active, c.created_at,
        (SELECT COUNT(*) FROM tickets t WHERE t.category_id = c.id) ticket_count,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.category_id = c.id) subscriber_count
      FROM categories c ORDER BY c.active DESC, c.name COLLATE NOCASE
    `).all();
    json(res, 200, { categories: rows }); return;
  }

  if (req.method === "POST" && url.pathname === "/api/categories") {
    if (!requireUser(req, res, ["admin"])) return;
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const capacityGroup = new Set(["car", "motorcycle"]).has(body.capacityGroup) ? body.capacityGroup : "car";
    if (name.length < 2) throw new Error("Ingrese un nombre de categoría.");
    try {
      const result = db.prepare("INSERT INTO categories (name, capacity_group) VALUES (?, ?)").run(name, capacityGroup);
      audit(user.id, "create", "category", result.lastInsertRowid, { name, capacityGroup });
      json(res, 201, { id: Number(result.lastInsertRowid), name });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("Ya existe una categoría con ese nombre.");
      throw error;
    }
    return;
  }

  const categoryMatch = url.pathname.match(/^\/api\/categories\/(\d+)$/);
  if (req.method === "PATCH" && categoryMatch) {
    if (!requireUser(req, res, ["admin"])) return;
    const categoryId = Number(categoryMatch[1]);
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const active = body.active ? 1 : 0;
    const capacityGroup = String(body.capacityGroup || "");
    if (name.length < 2) throw new Error("Ingrese un nombre de categoría.");
    if (!new Set(["car", "motorcycle"]).has(capacityGroup)) throw new Error("Grupo de capacidad inválido.");
    if (!db.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId)) throw new Error("Categoría no encontrada.");
    try {
      db.prepare("UPDATE categories SET name = ?, capacity_group = ?, active = ? WHERE id = ?").run(name, capacityGroup, active, categoryId);
      audit(user.id, "update", "category", categoryId, { name, capacityGroup, active: Boolean(active) });
      json(res, 200, { ok: true });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("Ya existe una categoría con ese nombre.");
      throw error;
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/capacity-sectors") {
    if (!requireUser(req, res, ["admin"])) return;
    json(res, 200, { sectors: db.prepare("SELECT * FROM capacity_sectors ORDER BY active DESC, capacity_group, name COLLATE NOCASE").all() }); return;
  }

  if (req.method === "POST" && url.pathname === "/api/capacity-sectors") {
    if (!requireUser(req, res, ["admin"])) return;
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const capacityGroup = String(body.capacityGroup || "");
    const purpose = String(body.purpose || "");
    const capacity = Number(body.capacity);
    if (name.length < 2) throw new Error("Ingrese el nombre del piso o sector.");
    if (!new Set(["car", "motorcycle"]).has(capacityGroup)) throw new Error("Grupo de capacidad inválido.");
    if (!new Set(["casual", "subscriber", "mixed"]).has(purpose)) throw new Error("Destino de sector inválido.");
    if (!Number.isInteger(capacity) || capacity < 0) throw new Error("La capacidad debe ser un número entero positivo.");
    try {
      const result = db.prepare(`INSERT INTO capacity_sectors (name, capacity_group, purpose, capacity, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .run(name, capacityGroup, purpose, capacity, nowIso());
      audit(user.id, "create", "capacity_sector", result.lastInsertRowid, { name, capacityGroup, purpose, capacity });
      json(res, 201, { id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("Ya existe un piso o sector con ese nombre.");
      throw error;
    }
    return;
  }

  const sectorMatch = url.pathname.match(/^\/api\/capacity-sectors\/(\d+)$/);
  if (req.method === "PATCH" && sectorMatch) {
    if (!requireUser(req, res, ["admin"])) return;
    const body = await readBody(req);
    const sectorId = Number(sectorMatch[1]);
    const name = String(body.name || "").trim();
    const capacityGroup = String(body.capacityGroup || "");
    const purpose = String(body.purpose || "");
    const capacity = Number(body.capacity);
    const active = body.active ? 1 : 0;
    if (name.length < 2 || !new Set(["car", "motorcycle"]).has(capacityGroup) || !new Set(["casual", "subscriber", "mixed"]).has(purpose) || !Number.isInteger(capacity) || capacity < 0) throw new Error("Revise los datos del sector.");
    try {
      const result = db.prepare(`UPDATE capacity_sectors SET name=?, capacity_group=?, purpose=?, capacity=?, active=?, updated_at=? WHERE id=?`)
        .run(name, capacityGroup, purpose, capacity, active, nowIso(), sectorId);
      if (result.changes === 0) throw new Error("Sector no encontrado.");
      audit(user.id, "update", "capacity_sector", sectorId, { name, capacityGroup, purpose, capacity, active: Boolean(active) });
      json(res, 200, { ok: true });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("Ya existe un piso o sector con ese nombre.");
      throw error;
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tariffs") {
    if (!requireUser(req, res, ["admin"])) return;
    const body = await readBody(req);
    const categoryId = Number(body.categoryId);
    const previousCount = db.prepare("SELECT COUNT(*) count FROM tariffs WHERE category_id = ?").get(categoryId).count;
    const earliestDate = previousCount === 0 ? new Date().toISOString().slice(0, 10) : tomorrowDate();
    const validFrom = String(body.validFrom || earliestDate);
    if (validFrom < earliestDate) throw new Error(previousCount === 0 ? "La tarifa inicial no puede tener una fecha pasada." : "La nueva tarifa debe entrar en vigencia desde mañana.");
    const values = ["fractionCents", "dailyCents", "fullDayCents", "monthlyCents", "monthlyDayCents"].map((key) => cents(body[key]));
    const result = db.prepare(`
      INSERT INTO tariffs (category_id, valid_from, fraction_cents, daily_cents, full_day_cents, monthly_cents, monthly_day_cents, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(category_id, valid_from) DO UPDATE SET
        fraction_cents=excluded.fraction_cents, daily_cents=excluded.daily_cents,
        full_day_cents=excluded.full_day_cents, monthly_cents=excluded.monthly_cents,
        monthly_day_cents=excluded.monthly_day_cents, created_by=excluded.created_by
    `).run(categoryId, validFrom, ...values, user.id);
    audit(user.id, "set_tariff", "category", categoryId, { validFrom, values });
    json(res, 201, { id: Number(result.lastInsertRowid), validFrom }); return;
  }

  if (req.method === "GET" && url.pathname === "/api/payment-methods") {
    json(res, 200, { methods: db.prepare("SELECT * FROM payment_methods WHERE active = 1 ORDER BY id").all() }); return;
  }

  if (req.method === "POST" && url.pathname === "/api/shifts/open") {
    const body = await readBody(req);
    if (openShift()) throw new Error("Ya existe un turno abierto.");
    const amount = cents(body.openingCashCents || 0);
    const result = db.prepare("INSERT INTO shifts (user_id, opened_at, opening_cash_cents) VALUES (?, ?, ?)").run(user.id, nowIso(), amount);
    audit(user.id, "open", "shift", result.lastInsertRowid, { openingCashCents: amount });
    json(res, 201, { shift: openShift() }); return;
  }

  if (req.method === "POST" && url.pathname === "/api/shifts/close") {
    const shift = openShift();
    if (!shift) throw new Error("No hay un turno abierto.");
    const body = await readBody(req);
    const counted = cents(body.countedCashCents || 0);
    const closedAt = nowIso();
    const paymentTotals = db.prepare(`
      SELECT m.name, m.kind, COALESCE(SUM(p.amount_cents), 0) amount_cents, COUNT(p.id) operations
      FROM payment_methods m JOIN payments p ON p.method_id = m.id
      WHERE p.shift_id = ? GROUP BY m.id, m.name, m.kind ORDER BY m.id
    `).all(shift.id);
    const cashCollected = paymentTotals.filter((item) => item.kind === "cash").reduce((sum, item) => sum + item.amount_cents, 0);
    const totalCollected = paymentTotals.reduce((sum, item) => sum + item.amount_cents, 0);
    const movements = db.prepare(`
      SELECT
        COUNT(CASE WHEN entry_shift_id = ? THEN 1 END) entries,
        COUNT(CASE WHEN exit_shift_id = ? THEN 1 END) exits,
        COUNT(CASE WHEN exit_shift_id = ? AND exception_reason IS NOT NULL THEN 1 END) exceptions
      FROM tickets
    `).get(shift.id, shift.id, shift.id);
    const vehiclesInside = db.prepare(`
      SELECT c.name category, COUNT(t.id) quantity
      FROM categories c LEFT JOIN tickets t ON t.category_id = c.id AND t.status = 'open'
      WHERE c.active = 1 OR t.id IS NOT NULL
      GROUP BY c.id, c.name ORDER BY c.name
    `).all();
    const report = {
      shiftId: shift.id,
      openedAt: shift.opened_at,
      closedAt,
      openedBy: shift.user_name,
      closedBy: user.display_name,
      openingCashCents: shift.opening_cash_cents,
      paymentTotals,
      totalCollectedCents: totalCollected,
      expectedCashCents: shift.opening_cash_cents + cashCollected,
      countedCashCents: counted,
      differenceCents: counted - (shift.opening_cash_cents + cashCollected),
      entries: movements.entries,
      exits: movements.exits,
      exceptions: movements.exceptions,
      vehiclesInside,
      totalInside: vehiclesInside.reduce((sum, item) => sum + item.quantity, 0),
      notes: String(body.notes || "").trim()
    };
    db.prepare("UPDATE shifts SET closed_at = ?, counted_cash_cents = ?, notes = ?, close_report_json = ? WHERE id = ?")
      .run(closedAt, counted, report.notes || null, JSON.stringify(report), shift.id);
    audit(user.id, "close", "shift", shift.id, report);
    json(res, 200, { report }); return;
  }

  if (req.method === "GET" && url.pathname === "/api/tickets") {
    const rows = db.prepare(`
      SELECT t.*, c.name category_name, u.display_name entry_user_name
      FROM tickets t
      JOIN categories c ON c.id = t.category_id
      JOIN users u ON u.id = t.entry_user_id
      WHERE t.status = 'open' ORDER BY t.entry_at ASC
    `).all();
    json(res, 200, { tickets: rows }); return;
  }

  if (req.method === "POST" && url.pathname === "/api/tickets") {
    const shift = openShift();
    if (!shift) throw new Error("Debe abrir un turno antes de registrar ingresos.");
    const body = await readBody(req);
    const plate = normalizePlate(body.plate);
    if (plate.length < 5 || plate.length > 9) throw new Error("Ingrese una patente válida.");
    const category = db.prepare("SELECT id, capacity_group FROM categories WHERE id = ? AND active = 1").get(Number(body.categoryId));
    if (!category) throw new Error("Categoría inválida.");
    const availability = capacitySnapshot()[category.capacity_group];
    const override = Boolean(body.capacityOverride);
    const capacityReason = String(body.capacityReason || "").trim();
    if (availability.capacity > 0 && availability.available <= 0 && !override) throw new Error("No quedan lugares disponibles para esta categoría.");
    if (override && !capacityReason) throw new Error("Debe indicar el motivo para autorizar el ingreso sin disponibilidad.");
    const publicId = randomUUID();
    const result = db.prepare(`
      INSERT INTO tickets (public_id, plate, category_id, entry_at, entry_user_id, entry_shift_id, capacity_override, capacity_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(publicId, plate, category.id, nowIso(), user.id, shift.id, override ? 1 : 0, override ? capacityReason : null);
    audit(user.id, "entry", "ticket", result.lastInsertRowid, { plate, categoryId: category.id, capacityOverride: override, capacityReason });
    json(res, 201, { id: Number(result.lastInsertRowid), publicId, plate }); return;
  }

  const quoteMatch = url.pathname.match(/^\/api\/tickets\/(\d+)\/quote$/);
  if (req.method === "POST" && quoteMatch) {
    const ticket = db.prepare("SELECT * FROM tickets WHERE id = ? AND status = 'open'").get(Number(quoteMatch[1]));
    if (!ticket) throw new Error("Ticket abierto no encontrado.");
    const body = await readBody(req);
    const tariff = activeTariff(ticket.category_id);
    if (!tariff) throw new Error("La categoría todavía no tiene una tarifa vigente.");
    const exitAt = nowIso();
    const result = calculateSuggestedAmount({
      start: ticket.entry_at, end: exitAt, mode: body.mode,
      prices: { fractionCents: tariff.fraction_cents, dailyCents: tariff.daily_cents, fullDayCents: tariff.full_day_cents }
    });
    json(res, 200, { ...result, elapsedMinutes: elapsedMinutes(ticket.entry_at, exitAt), exitAt, tariffId: tariff.id }); return;
  }

  const closeMatch = url.pathname.match(/^\/api\/tickets\/(\d+)\/close$/);
  if (req.method === "POST" && closeMatch) {
    const shift = openShift();
    if (!shift) throw new Error("Debe abrir un turno antes de cobrar.");
    const ticket = db.prepare("SELECT * FROM tickets WHERE id = ? AND status = 'open'").get(Number(closeMatch[1]));
    if (!ticket) throw new Error("Ticket abierto no encontrado.");
    const body = await readBody(req);
    const tariff = activeTariff(ticket.category_id);
    if (!tariff) throw new Error("La categoría todavía no tiene una tarifa vigente.");
    const exitAt = nowIso();
    const calculation = calculateSuggestedAmount({
      start: ticket.entry_at, end: exitAt, mode: body.mode,
      prices: { fractionCents: tariff.fraction_cents, dailyCents: tariff.daily_cents, fullDayCents: tariff.full_day_cents }
    });
    const charged = cents(body.chargedCents);
    const reason = String(body.exceptionReason || "").trim();
    if (charged !== calculation.amountCents && !reason) throw new Error("Debe indicar el motivo de la excepción de precio.");
    if (!Array.isArray(body.payments) || body.payments.length === 0) throw new Error("Debe indicar al menos un medio de pago.");
    const paymentTotal = body.payments.reduce((sum, payment) => sum + cents(payment.amountCents), 0);
    if (paymentTotal !== charged) throw new Error("La suma de los medios de pago debe coincidir con el total cobrado.");

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        UPDATE tickets SET exit_at=?, exit_user_id=?, exit_shift_id=?, pricing_mode=?, tariff_id=?,
          suggested_cents=?, charged_cents=?, exception_reason=?, status='closed' WHERE id=?
      `).run(exitAt, user.id, shift.id, body.mode, tariff.id, calculation.amountCents, charged, reason || null, ticket.id);
      const insertPayment = db.prepare(`
        INSERT INTO payments (ticket_id, shift_id, user_id, method_id, amount_cents, paid_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const payment of body.payments) {
        const method = db.prepare("SELECT id FROM payment_methods WHERE id=? AND active=1").get(Number(payment.methodId));
        if (!method) throw new Error("Medio de pago inválido.");
        insertPayment.run(ticket.id, shift.id, user.id, method.id, cents(payment.amountCents), exitAt);
      }
      audit(user.id, "exit", "ticket", ticket.id, { suggestedCents: calculation.amountCents, chargedCents: charged, reason });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK"); throw error;
    }
    json(res, 200, { ok: true, suggestedCents: calculation.amountCents, chargedCents: charged }); return;
  }

  json(res, 404, { error: "Ruta no encontrada." });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404); res.end("No encontrado"); return;
  }
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
  res.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    json(res, 400, { error: error.message || "No se pudo completar la operación." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Cochera Balcarce disponible en http://127.0.0.1:${port}`);
  console.log(`Base de datos: ${databasePath}`);
});

startBackupScheduler();
