import { env } from '../config/env';

/**
 * Minimal structured logger. In production each line is one JSON object, which Cloud Logging turns into
 * a structured entry with the right severity; a stack trace in `message` is picked up by Error Reporting.
 * Locally it prints readable lines.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown> & { err?: unknown };

const SEVERITY: Record<Level, string> = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR' };

function describe(err: unknown): { error?: string; stack?: string } {
  if (err instanceof Error) return { error: err.message, ...(err.stack ? { stack: err.stack } : {}) };
  return err === undefined ? {} : { error: String(err) };
}

function write(level: Level, message: string, fields: Fields = {}): void {
  const { err, ...rest } = fields;
  if (!env.logJson) {
    const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    const extra: unknown[] = [];
    if (Object.keys(rest).length) extra.push(rest);
    if (err !== undefined) extra.push(err);
    out(`[${level}] ${message}`, ...extra);
    return;
  }
  const e = describe(err);
  const entry = {
    severity: SEVERITY[level],
    message: e.stack ? `${message}\n${e.stack}` : message,
    ...rest,
    ...(e.error ? { error: e.error } : {}),
  };
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ severity: entry.severity, message: entry.message });
  }
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const log = {
  debug: (message: string, fields?: Fields) => write('debug', message, fields),
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
};
