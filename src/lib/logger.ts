export type LogMeta = Record<string, unknown>;

function serializeError(error: unknown): LogMeta {
  if (!error || typeof error !== 'object') return { error };
  const anyErr = error as any;
  return {
    name: anyErr.name,
    message: anyErr.message,
    stack: anyErr.stack,
  };
}

function write(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: LogMeta) {
  const payload = {
    level,
    message,
    time: new Date().toISOString(),
    ...(meta || {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info(message: string, meta?: LogMeta) {
    write('info', message, meta);
  },
  warn(message: string, meta?: LogMeta) {
    write('warn', message, meta);
  },
  error(message: string, error?: unknown, meta?: LogMeta) {
    write('error', message, {
      ...(meta || {}),
      ...(error !== undefined ? { error: serializeError(error) } : {}),
    });
  },
  debug(message: string, meta?: LogMeta) {
    if (process.env.NODE_ENV !== 'production') {
      write('debug', message, meta);
    }
  },
};
