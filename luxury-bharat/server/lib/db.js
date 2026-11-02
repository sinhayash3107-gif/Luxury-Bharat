import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');

const cache = new Map();
const stmt = (s) => { let x = cache.get(s); if (!x) { x = db.prepare(s); cache.set(s, x); } return x; };
// Every query is parameterised. undefined -> NULL, booleans -> 0/1.
const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? +v : v));
export const get = (s, ...p) => stmt(s).get(...norm(p));
export const all = (s, ...p) => stmt(s).all(...norm(p));
export const run = (s, ...p) => stmt(s).run(...norm(p));

let depth = 0, spId = 0;
/** Synchronous transaction (BEGIN IMMEDIATE). fn must NOT be async. Nested calls become savepoints. */
export function tx(fn) {
  if (depth > 0) {
    const sp = `sp${++spId}`;
    db.exec(`SAVEPOINT ${sp}`); depth++;
    try { const r = fn(); depth--; db.exec(`RELEASE ${sp}`); return r; }
    catch (e) { depth--; db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); throw e; }
  }
  db.exec('BEGIN IMMEDIATE'); depth = 1;
  try { const r = fn(); db.exec('COMMIT'); depth = 0; return r; }
  catch (e) { depth = 0; try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
}

export function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (get('SELECT 1 FROM _migrations WHERE name=?', f)) continue;
    tx(() => { db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); run('INSERT INTO _migrations VALUES (?,?)', f, new Date().toISOString()); });
    console.log(`[db] applied migration ${f}`);
  }
}

export const now = () => new Date().toISOString();
export const J = (v, d = null) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };
