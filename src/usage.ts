import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, basename, isAbsolute, sep } from 'node:path';
import type { Config } from './config.js';
import type { TokenUsage } from './contracts.js';

export const visitorHeader = 'x-personacore-visitor';
export const validVisitor = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const visitorHash = (id: string) => createHash('sha256').update(id).digest('hex');
const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' });
export function helsinkiDay(now: Date): string {
  const parts = calendar.formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
export class AdmissionDenied extends Error {
  constructor(readonly code: 'daily_limit' | 'visitor_daily_limit' | 'visitor_rate_limited', readonly retryAfter?: number) { super(code); }
}
export type Reservation = { day: string; visitor: string };
export interface UsageStore {
  reserve(visitor: string, now: Date): Reservation;
  recordUsage(reservation: Reservation, usage: TokenUsage): void;
  recordSuccess(reservation: Reservation): void;
  close(): void;
}
export class SQLiteUsageStore implements UsageStore {
  readonly db: DatabaseSync;
  constructor(private readonly config: Config, path?: string) {
    if (!path && config.DATA_DIR) {
      const knowledge = realpathSync(config.KNOWLEDGE_DIR);
      let ancestor = resolve(config.DATA_DIR);
      const missing: string[] = [];
      while (!existsSync(ancestor)) { missing.unshift(basename(ancestor)); ancestor = dirname(ancestor); }
      const data = resolve(realpathSync(ancestor), ...missing);
      const location = relative(knowledge, data);
      if (!location || (!isAbsolute(location) && location !== '..' && !location.startsWith('..' + sep))) throw new Error('DATA_DIR must be separate from knowledge.');
      mkdirSync(data, { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(path ?? (config.DATA_DIR ? resolve(config.DATA_DIR, 'usage.sqlite') : ':memory:'), { timeout: 1000 });
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.db.exec('BEGIN IMMEDIATE');
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      if (version > 1) throw new Error('Unsupported usage database version');
      if (version < 1) {
        this.db.exec(`CREATE TABLE aggregate_daily (
          day TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0,
          measured_calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE visitor_daily (
          day TEXT NOT NULL, visitor_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
          window_start INTEGER NOT NULL, window_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, visitor_hash)
        ) STRICT;
        PRAGMA user_version=1;`);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.close(); throw error; }
  }
  reserve(visitor: string, now: Date): Reservation {
    const day = helsinkiDay(now), hashed = visitorHash(visitor), ms = now.getTime();
    const cutoff = helsinkiDay(new Date(ms - this.config.USAGE_RETENTION_DAYS * 86400000));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM visitor_daily WHERE day < ?').run(cutoff);
      this.db.prepare('DELETE FROM aggregate_daily WHERE day < ?').run(cutoff);
      this.db.prepare('INSERT OR IGNORE INTO aggregate_daily(day) VALUES (?)').run(day);
      this.db.prepare('INSERT OR IGNORE INTO visitor_daily(day, visitor_hash, window_start) VALUES (?, ?, ?)').run(day, hashed, ms);
      const aggregate = this.db.prepare('SELECT attempts FROM aggregate_daily WHERE day=?').get(day)!;
      const row = this.db.prepare('SELECT attempts, window_start, window_count FROM visitor_daily WHERE day=? AND visitor_hash=?').get(day, hashed)!;
      if (Number(aggregate.attempts) >= this.config.DAILY_ATTEMPT_CAP) throw new AdmissionDenied('daily_limit');
      if (Number(row.attempts) >= this.config.VISITOR_DAILY_ALLOWANCE) throw new AdmissionDenied('visitor_daily_limit');
      const reset = ms - Number(row.window_start) >= this.config.VISITOR_RATE_WINDOW_MS;
      const start = reset ? ms : Number(row.window_start);
      const count = reset ? 0 : Number(row.window_count);
      if (count >= this.config.VISITOR_RATE_MAX) throw new AdmissionDenied('visitor_rate_limited', Math.max(1, Math.ceil((start + this.config.VISITOR_RATE_WINDOW_MS - ms) / 1000)));
      this.db.prepare('UPDATE aggregate_daily SET attempts=attempts+1 WHERE day=?').run(day);
      this.db.prepare('UPDATE visitor_daily SET attempts=attempts+1, window_start=?, window_count=? WHERE day=? AND visitor_hash=?').run(start, count + 1, day, hashed);
      this.db.exec('COMMIT');
      return { day, visitor: hashed };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  recordUsage({ day }: Reservation, usage: TokenUsage) {
    this.db.prepare('UPDATE aggregate_daily SET measured_calls=measured_calls+1, input_tokens=input_tokens+?, output_tokens=output_tokens+?, total_tokens=total_tokens+? WHERE day=?').run(usage.inputTokens, usage.outputTokens, usage.totalTokens, day);
  }
  recordSuccess({ day }: Reservation) { this.db.prepare('UPDATE aggregate_daily SET successes=successes+1 WHERE day=?').run(day); }
  close() { this.db.close(); }
}
