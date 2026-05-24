import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const logLevel = process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug");

const redactList = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "privateKey",
  "config.privateKey",
  "wallet.privateKey",
];

export const logger = pino({
  level: logLevel,
  redact: redactList,
  serializers: {
    error: pino.stdSerializers.err,
    request: pino.stdSerializers.req,
    response: pino.stdSerializers.res,
  },
  formatters: {
    level: (label) => ({ level: label }),
    bindings: () => ({}),
  },
  timestamp: pino.timestamp,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
});

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export function createModuleLogger(module: string) {
  return {
    trace: (obj: unknown, msg?: string) => logger.trace({ module, ...(typeof obj === "object" ? obj : { data: obj }) }, msg ?? ""),
    debug: (obj: unknown, msg?: string) => logger.debug({ module, ...(typeof obj === "object" ? obj : { data: obj }) }, msg ?? ""),
    info: (obj: unknown, msg?: string) => logger.info({ module, ...(typeof obj === "object" ? obj : { data: obj }) }, msg ?? ""),
    warn: (obj: unknown, msg?: string) => logger.warn({ module, ...(typeof obj === "object" ? obj : { data: obj }) }, msg ?? ""),
    error: (obj: unknown, msg?: string) => logger.error({ module, ...(typeof obj === "object" ? obj : { data: obj }) }, msg ?? ""),
    fatal: (obj: unknown, msg?: string) => logger.fatal({ module, ...(typeof obj === "object" ? obj : { data: obj }) }, msg ?? ""),
  };
}

export function logTradeEvent(
  event: "opportunity_detected" | "execution_started" | "execution_success" | "execution_failed" | "transaction_sent" | "transaction_confirmed",
  data: Record<string, unknown>,
) {
  const eventLogger = createModuleLogger("trade");
  const level = event.includes("failed") ? "error" : event.includes("success") ? "info" : "debug";

  const logData = {
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };

  eventLogger[level === "error" ? "error" : level === "info" ? "info" : "debug"](logData, `Trade ${event}`);

  return logData;
}

export function logError(
  module: string,
  operation: string,
  error: unknown,
  context?: Record<string, unknown>,
) {
  const err = error instanceof Error ? error : new Error(String(error));
  const errorInfo = {
    module,
    operation,
    error: {
      name: err.name,
      message: err.message,
      stack: isProduction ? undefined : err.stack,
    },
    ...context,
  };

  logger.error(errorInfo, `${operation} failed`);

  return errorInfo;
}

export function logPerformance(
  module: string,
  operation: string,
  startTime: number,
  metadata?: Record<string, unknown>,
) {
  const durationMs = Date.now() - startTime;
  logger.debug({
    module,
    operation,
    durationMs,
    ...(metadata || {}),
  }, `${operation} completed in ${durationMs}ms`);

  return durationMs;
}

export function withErrorLogging<T>(
  module: string,
  operation: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>,
): Promise<T> {
  return fn().catch((error) => {
    logError(module, operation, error, context);
    throw error;
  });
}
