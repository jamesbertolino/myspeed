import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

function resolveDbPath(): string {
  const preferred = path.join(process.cwd(), '.data')
  try {
    if (!fs.existsSync(preferred)) fs.mkdirSync(preferred, { recursive: true })
    return path.join(preferred, 'myspeed.db')
  } catch {
    // Vercel and some hosts have a read-only project dir; fall back to /tmp
    return path.join('/tmp', 'myspeed.db')
  }
}

const DB_PATH = resolveDbPath()

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

  CREATE TABLE IF NOT EXISTS wifi_scan_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            INTEGER NOT NULL,
    band24_ch     INTEGER,
    band24_score  INTEGER,
    band24_rec    INTEGER,
    band5_ch      INTEGER,
    band5_score   INTEGER,
    band5_rec     INTEGER,
    net_count     INTEGER NOT NULL DEFAULT 0,
    networks_json TEXT
  );

  CREATE TABLE IF NOT EXISTS device_scan_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    subnet      TEXT,
    device_count INTEGER NOT NULL DEFAULT 0,
    devices_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON device_scan_snapshots(ts DESC);

  CREATE TABLE IF NOT EXISTS known_devices (
    mac        TEXT    PRIMARY KEY,
    label      TEXT,
    ip         TEXT,
    vendor     TEXT,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    trusted    INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_wifi_scan_ts    ON wifi_scan_history(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_speedtest_ts    ON speedtest_history(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_ping_ts         ON ping_history(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_alert_ts        ON alert_log(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_android_dev     ON android_devices(device_id);
  CREATE INDEX IF NOT EXISTS idx_android_rep_ts  ON android_reports(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_android_rep_dev ON android_reports(device_id, ts DESC);
`)

export default db
