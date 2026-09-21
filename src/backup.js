import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { db, databasePath, nowIso, audit } from "./db.js";

const backupDir = process.env.COCHERA_BACKUP_DIR || join(dirname(databasePath), "..", "backups");
const retention = 12;
const weekMs = 7 * 24 * 60 * 60 * 1000;

function backupFiles() {
  mkdirSync(backupDir, { recursive: true });
  return readdirSync(backupDir)
    .filter((name) => /^cochera-\d{8}-\d{6}\.sqlite$/.test(name))
    .map((name) => ({ name, path: join(backupDir, name), modified: statSync(join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified);
}

export function backupStatus() {
  const latest = backupFiles()[0];
  return { directory: backupDir, lastBackupAt: latest ? new Date(latest.modified).toISOString() : null, copies: backupFiles().length };
}

export function runBackup(userId = null, force = false) {
  const current = backupStatus();
  if (!force && current.lastBackupAt && Date.now() - new Date(current.lastBackupAt).getTime() < weekMs) {
    return { ...current, created: false };
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const destination = join(backupDir, `cochera-${stamp}.sqlite`);
  const escaped = destination.replaceAll("'", "''");
  db.exec(`VACUUM INTO '${escaped}'`);

  const verification = new DatabaseSync(destination, { readOnly: true });
  const integrity = verification.prepare("PRAGMA integrity_check").get().integrity_check;
  verification.close();
  if (integrity !== "ok") {
    unlinkSync(destination);
    throw new Error("La copia se generó, pero no superó la verificación de integridad.");
  }

  for (const old of backupFiles().slice(retention)) unlinkSync(old.path);
  audit(userId, "backup", "database", destination, { integrity, automatic: !force, createdAt: nowIso() });
  return { ...backupStatus(), created: true, path: destination };
}

export function startBackupScheduler() {
  const check = () => {
    try { runBackup(null, false); }
    catch (error) { console.error("No se pudo realizar el respaldo automático:", error); }
  };
  setTimeout(check, 1500);
  setInterval(check, 6 * 60 * 60 * 1000).unref();
}

