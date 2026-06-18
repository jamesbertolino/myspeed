import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_DIR  = path.join(process.cwd(), '.data')
const DB_PATH = path.join(DB_DIR, 'myspeed.db')

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('busy_timeout = 5000')
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
    ip        TEXT,
    auto      INTEGER NOT NULL DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS android_devices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id    TEXT    NOT NULL,
    device_name  TEXT,
    model        TEXT,
    android_ver  TEXT,
    last_seen    INTEGER NOT NULL,
    UNIQUE(device_id)
  );

  CREATE TABLE IF NOT EXISTS android_reports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           INTEGER NOT NULL,
    device_id    TEXT    NOT NULL,
    wifi_ssid    TEXT,
    wifi_bssid   TEXT,
    wifi_rssi    INTEGER,
    wifi_freq    INTEGER,
    wifi_speed   INTEGER,
    ip_address   TEXT,
    ping_ms      REAL,
    battery_pct  INTEGER,
    battery_chg  INTEGER,
    extra        TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_speedtest_ts    ON speedtest_history(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_ping_ts         ON ping_history(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_alert_ts        ON alert_log(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_android_dev     ON android_devices(device_id);
  CREATE INDEX IF NOT EXISTS idx_android_rep_ts  ON android_reports(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_android_rep_dev ON android_reports(device_id, ts DESC);
`)

export default db
