export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

let currentLevel: LogLevel = (process.env.RA_LOG_LEVEL as LogLevel) || 'info'
let jsonMode = process.env.RA_LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production'

export function setLogLevel(level: LogLevel): void { currentLevel = level }
export function setJsonMode(enabled: boolean): void { jsonMode = enabled }

interface LogEntry {
  level: LogLevel
  msg: string
  timestamp: string
  [key: string]: unknown
}

export interface Logger {
  debug: (msg: string, fields?: Record<string, unknown>) => void
  info: (msg: string, fields?: Record<string, unknown>) => void
  warn: (msg: string, fields?: Record<string, unknown>) => void
  error: (msg: string, fields?: Record<string, unknown>) => void
  child: (fields: Record<string, unknown>) => Logger
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...fields,
  }

  if (jsonMode) {
    process.stderr.write(JSON.stringify(entry) + '\n')
  } else {
    const prefix = `[${entry.timestamp}] ${level.toUpperCase()}`
    const extra = fields ? ' ' + JSON.stringify(fields) : ''
    process.stderr.write(`${prefix} ${msg}${extra}\n`)
  }
}

function createLogger(baseFields?: Record<string, unknown>): Logger {
  const merge = (fields?: Record<string, unknown>) =>
    baseFields ? { ...baseFields, ...fields } : fields

  return {
    debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, merge(fields)),
    info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, merge(fields)),
    warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, merge(fields)),
    error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, merge(fields)),
    child: (extraFields: Record<string, unknown>) =>
      createLogger(baseFields ? { ...baseFields, ...extraFields } : extraFields),
  }
}

export const logger: Logger = createLogger()
