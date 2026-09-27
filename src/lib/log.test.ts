import { describe, expect, it } from 'vitest';
import {
  getRecentEntries,
  normalizeLogLevel,
  resetLoggerForTest,
  setLogLevel,
  subscribeLogs,
  writeLog
} from './log';

describe('ロガー (Phase 2)', () => {
  it('レベル未満は出さず、不正値は info に正規化する', () => {
    resetLoggerForTest();
    expect(normalizeLogLevel('DEBUG')).toBe('debug');
    expect(normalizeLogLevel('xx')).toBe('info');
    expect(normalizeLogLevel(undefined)).toBe('info');
    setLogLevel('warn');
    writeLog('info', 'test', '抑止される');
    writeLog('error', 'test', '通る');
    const recent = getRecentEntries(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].level).toBe('error');
  });

  it('off では全抑止し、購読者に届く', () => {
    resetLoggerForTest();
    const seen: string[] = [];
    const unsub = subscribeLogs((e) => seen.push(e.message));
    writeLog('info', 'test', '届く');
    expect(seen).toEqual(['届く']);
    unsub();
    setLogLevel('off');
    writeLog('error', 'test', '届かない');
    expect(getRecentEntries(10)).toHaveLength(1);
  });

  it('上限を超えた古い分は捨てる', () => {
    resetLoggerForTest();
    for (let i = 0; i < 250; i += 1) writeLog('info', 'test', `m${i}`);
    const recent = getRecentEntries(500);
    expect(recent).toHaveLength(200);
    expect(recent[0].message).toBe('m50');
  });
});
