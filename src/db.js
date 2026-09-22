import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./security.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.COCHERA_DATA_DIR || join(projectRoot, "data");
mkdirSync(dataDir, { recursive: true });

export const databasePath = join(dataDir, "cochera.sqlite");
export const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('employee', 'coordinator', 'admin')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    capacity_group TEXT NOT NULL DEFAULT 'car' CHECK(capacity_group IN ('car', 'motorcycle')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS capacity_sectors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    capacity_group TEXT NOT NULL CHECK(capacity_group IN ('car', 'motorcycle')),
    purpose TEXT NOT NULL DEFAULT 'casual' CHECK(purpose IN ('casual', 'subscriber', 'mixed')),
    capacity INTEGER NOT NULL CHECK(capacity >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY,
    full_name TEXT NOT NULL,
    document TEXT,
    phone TEXT,
    email TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'inactive')),
    suspension_reason TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY,
    subscriber_id INTEGER NOT NULL UNIQUE REFERENCES subscribers(id),
    plan TEXT NOT NULL CHECK(plan IN ('full', 'day')),
    category_id INTEGER NOT NULL REFERENCES categories(id),
    start_date TEXT NOT NULL,
    spaces INTEGER NOT NULL DEFAULT 1 CHECK(spaces > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriber_plates (
    id INTEGER PRIMARY KEY,
    subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
    plate TEXT NOT NULL UNIQUE COLLATE NOCASE,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tariffs (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    valid_from TEXT NOT NULL,
    fraction_cents INTEGER NOT NULL CHECK(fraction_cents >= 0),
    daily_cents INTEGER NOT NULL CHECK(daily_cents >= 0),
    full_day_cents INTEGER NOT NULL CHECK(full_day_cents >= 0),
    monthly_cents INTEGER NOT NULL CHECK(monthly_cents >= 0),
    monthly_day_cents INTEGER NOT NULL CHECK(monthly_day_cents >= 0),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category_id, valid_from)
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    opened_at TEXT NOT NULL,
    opening_cash_cents INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT,
    counted_cash_cents INTEGER,
    notes TEXT,
    close_report_json TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift
    ON shifts((1)) WHERE closed_at IS NULL;

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    plate TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    entry_at TEXT NOT NULL,
    entry_user_id INTEGER NOT NULL REFERENCES users(id),
    entry_shift_id INTEGER NOT NULL REFERENCES shifts(id),
    exit_at TEXT,
    exit_user_id INTEGER REFERENCES users(id),
    exit_shift_id INTEGER REFERENCES shifts(id),
    pricing_mode TEXT CHECK(pricing_mode IN ('fraction', 'daily', '24h')),
    tariff_id INTEGER REFERENCES tariffs(id),
    suggested_cents INTEGER,
    charged_cents INTEGER,
    exception_reason TEXT,
    capacity_override INTEGER NOT NULL DEFAULT 0,
    capacity_reason TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE UNIQUE INDEX IF NOT EXISTS one_open_ticket_per_plate
    ON tickets(plate) WHERE status = 'open';

  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind TEXT NOT NULL DEFAULT 'other',
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    shift_id INTEGER NOT NULL REFERENCES shifts(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    method_id INTEGER NOT NULL REFERENCES payment_methods(id),
    amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
    paid_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL
  );
`);

const shiftColumns = db.prepare("PRAGMA table_info(shifts)").all().map((column) => column.name);
if (!shiftColumns.includes("close_report_json")) {
  db.exec("ALTER TABLE shifts ADD COLUMN close_report_json TEXT");
}

const categoryColumns = db.prepare("PRAGMA table_info(categories)").all().map((column) => column.name);
if (!categoryColumns.includes("capacity_group")) {
  db.exec("ALTER TABLE categories ADD COLUMN capacity_group TEXT NOT NULL DEFAULT 'car'");
}

const ticketColumns = db.prepare("PRAGMA table_info(tickets)").all().map((column) => column.name);
if (!ticketColumns.includes("capacity_override")) {
  db.exec("ALTER TABLE tickets ADD COLUMN capacity_override INTEGER NOT NULL DEFAULT 0");
}
if (!ticketColumns.includes("capacity_reason")) {
  db.exec("ALTER TABLE tickets ADD COLUMN capacity_reason TEXT");
}

const userCount = db.prepare("SELECT COUNT(*) count FROM users").get().count;
if (userCount === 0) {
  const initialPassword = process.env.COCHERA_ADMIN_PASSWORD || "Cambiar123!";
  db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role)
    VALUES (?, ?, ?, 'admin')
  `).run("admin", "Administrador", hashPassword(initialPassword));
}

const insertCategory = db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
for (const name of ["Auto", "Camioneta", "Moto"]) insertCategory.run(name);
db.prepare("UPDATE categories SET capacity_group = 'motorcycle' WHERE name = 'Moto' COLLATE NOCASE").run();

const insertMethod = db.prepare("INSERT OR IGNORE INTO payment_methods (name, kind) VALUES (?, ?)");
for (const [name, kind] of [
  ["Efectivo", "cash"],
  ["Transferencia", "transfer"],
  ["Débito", "card"],
  ["Crédito", "card"],
  ["QR / billetera", "wallet"]
]) insertMethod.run(name, kind);

export function nowIso() {
  return new Date().toISOString();
}

export function audit(userId, action, entityType, entityId, details = {}) {
  db.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId || null, action, entityType, entityId == null ? null : String(entityId), JSON.stringify(details), nowIso());
}

export function activeTariff(categoryId, at = new Date()) {
  return db.prepare(`
    SELECT * FROM tariffs
    WHERE category_id = ? AND valid_from <= ?
    ORDER BY valid_from DESC, id DESC LIMIT 1
  `).get(categoryId, at.toISOString().slice(0, 10));
}
