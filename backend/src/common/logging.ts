// Shared structured-logging helpers. Events are shaped as {domain}.{action}.{phase}.

import type { Logger as PinoBaseLogger } from 'pino'
import type { PinoLogger } from 'nestjs-pino'

export type AppLogger = PinoBaseLogger | PinoLogger

export const ms = (start: number): number =>
  Math.round(performance.now() - start)

export const shortId = (id: string): string => id.slice(0, 8)

// Returns a child logger that auto-attaches { jobPositionId, userId? } to every emit.
export function jobLogger(
  log: AppLogger,
  jobPositionId: string,
  userId?: string,
): PinoBaseLogger {
  const base: PinoBaseLogger =
    (log as PinoLogger).logger ?? (log as PinoBaseLogger)
  return base.child({
    jobPositionId,
    ...(userId ? { userId } : {}),
  })
}

// Timed op helper: emits `${event}.start` and `${event}.done|failed` with durationMs.
export function startOp(
  log: AppLogger,
  event: string,
  fields: Record<string, unknown> = {},
): {
  ok: (extra?: Record<string, unknown>) => void
  fail: (err: unknown, extra?: Record<string, unknown>) => void
} {
  const base: PinoBaseLogger =
    (log as PinoLogger).logger ?? (log as PinoBaseLogger)
  const startedAt = performance.now()
  base.info({ event: `${event}.start`, ...fields }, `${event} start`)
  return {
    ok: (extra = {}) =>
      base.info(
        {
          event: `${event}.done`,
          durationMs: ms(startedAt),
          ...fields,
          ...extra,
        },
        `${event} done`,
      ),
    fail: (err, extra = {}) =>
      base.error(
        {
          event: `${event}.failed`,
          durationMs: ms(startedAt),
          err,
          ...fields,
          ...extra,
        },
        `${event} failed`,
      ),
  }
}
