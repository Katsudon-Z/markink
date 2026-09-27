import { ipc } from './ipc';

/** ログレベル。off は全抑止 (設定値は Rust 側にも永続化する)。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off';

export type ActiveLogLevel = Exclude<LogLevel, 'off'>;

export interface LogEntry {
  seq: number;
  time: number;
  level: ActiveLogLevel;
  source: string;
  message: string;
}

const LEVEL_ORDER: Record<ActiveLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const MAX_ENTRIES = 200;

let currentLevel: LogLevel = 'info';
let fileSinkEnabled = false;
let seq = 0;
const entries: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();

export function normalizeLogLevel(value: string | undefined | null): LogLevel {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
    case 'off':
      return value!.trim().toLowerCase() as LogLevel;
    default:
      return 'info';
  }
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

/** ファイル追記を開始する (App 起動時に1回。テストでは呼ばない)。開始前の保持分も流す。 */
export function enableFileLog(): void {
  if (fileSinkEnabled) return;
  fileSinkEnabled = true;
  for (const entry of entries) {
    void ipc.appendLog(formatLine(entry)).catch(() => {});
  }
}

export function getRecentEntries(limit = 100): LogEntry[] {
  return entries.slice(Math.max(0, entries.length - Math.max(0, limit)));
}

export function subscribeLogs(listener: (entry: LogEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const formatLine = (entry: LogEntry): string =>
  `${new Date(entry.time).toISOString()} [${entry.level}] [${entry.source}] ${entry.message}`;

export function writeLog(level: ActiveLogLevel, source: string, message: string): void {
  if (currentLevel === 'off') return;
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel as ActiveLogLevel]) return;
  const entry: LogEntry = { seq: seq + 1, time: Date.now(), level, source, message };
  seq = entry.seq;
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  const line = formatLine(entry);
  if (level === 'debug') console.debug(line);
  else if (level === 'info') console.log(line);
  else if (level === 'warn') console.warn(line);
  else console.error(line);
  for (const listener of [...listeners]) {
    try {
      listener(entry);
    } catch {
      // 閲覧側の失敗はログを妨げない
    }
  }
  if (fileSinkEnabled) {
    void ipc.appendLog(line).catch(() => {});
  }
}

/** テスト用に全状態を戻す。本体からは呼ばない。 */
export function resetLoggerForTest(): void {
  currentLevel = 'info';
  fileSinkEnabled = false;
  entries.length = 0;
  listeners.clear();
}
