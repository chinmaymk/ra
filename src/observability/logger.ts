import { OutputWriter } from './output-writer'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  sessionId?: string
  [key: string]: unknown
}

export interface LoggerOptions {
  level: LogLevel
  output: 'stderr' | 'stdout' | 'file'
  filePath?: string
  sessionId?: string
}

export class Logger {
  private level: LogLevel
  private writer: OutputWriter
  private sessionId: string | undefined

  constructor(options: LoggerOptions) {
    this.level = options.level
    this.writer = new OutputWriter(options.output, options.filePath)
    this.sessionId = options.sessionId
  }

  setSessionId(sessionId: string): void { this.sessionId = sessionId }

  debug(message: string, data?: Record<string, unknown>): void { this.log('debug', message, data) }
  info(message: string, data?: Record<string, unknown>): void { this.log('info', message, data) }
  warn(message: string, data?: Record<string, unknown>): void { this.log('warn', message, data) }
  error(message: string, data?: Record<string, unknown>): void { this.log('error', message, data) }

  protected log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[this.level]) return
    this.writer.write({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(this.sessionId && { sessionId: this.sessionId }),
      ...data,
    })
  }

  async flush(): Promise<void> { await this.writer.flush() }
}

/** A no-op logger that silently discards all messages. */
export class NoopLogger extends Logger {
  constructor() { super({ level: 'error', output: 'stderr' }) }
  protected override log(): void {}
  override async flush(): Promise<void> {}
}
