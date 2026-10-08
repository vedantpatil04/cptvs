type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFields = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const isProduction = process.env.NODE_ENV === 'production';
const minimumLevel: LogLevel =
  process.env.NODE_ENV === 'test' ? 'warn' : isProduction ? 'info' : 'debug';

const serializeError = (error: unknown): unknown =>
  error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;

const write = (level: LogLevel, message: string, fields: LogFields = {}): void => {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel]) return;
  const { err, ...rest } = fields;
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...rest,
    ...(err === undefined ? {} : { err: serializeError(err) }),
  };
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  // Structured JSON in production (log aggregators); readable lines locally.
  stream.write(
    isProduction
      ? `${JSON.stringify(entry)}\n`
      : `${entry.time} ${level.toUpperCase().padEnd(5)} ${message}${
          Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ''
        }${err === undefined ? '' : `\n${String((err as Error)?.stack ?? err)}`}\n`,
  );
};

export const logger = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
