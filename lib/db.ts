import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_DIR  = path.join(process.cwd(), '.data')
const DB_PATH = path.join(DB_DIR, 'myspeed.db')

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS speedtest_history (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        INTEGER NOT NULL,
    ping      REAL    NOT NULL,
    jitter    REAL    NOT NULL,
    download  REAL    NOT NULL,
    upload    REAL    NOT NULL,
    server    TEXT,
    isp       TEXT,
    ip        TEXT
  );

  CREATE TABLE IF NOT EXISTS ping_history (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    ts   INTEGER NOT NULL,
    ms   INTEGER NOT NULL,
    ttl  INTEGER
  );

  CREATE TABLE IF NOT EXISTS alert_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        INTEGER NOT NULL,
    type      TEXT    NOT NULL,
    value     REAL    NOT NULL,
    threshold REAL    NOT NULL,
    message   TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_speedtest_ts ON speedtest_history(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_ping_ts      ON ping_history(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_alert_ts     ON alert_log(ts DESC);
`)

export default db
