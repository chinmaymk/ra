import type { Logger as ILogger, LogLevel } from '@chinmaymk/ra'
import { JsonlWriter } from './writer'

export type { LogLevel, LogEntry } from '@chinmaymk/ra'
export { NoopLogger } from '@chinmaymk/ra'

const LOG_LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export interface LoggerOptions {
  level: LogLevel
  output: 'stderr' | 'stdout' | 'file'
  filePath?: string
  sessionId?: string
}

export class Logger implements ILogger {
  private level: LogLevel
  private sessionId: string | undefined
  private writer: JsonlWriter

  constructor(options: LoggerOptions) {
    this.level = options.level
    this.sessionId = options.sessionId
    this.writer = new JsonlWriter(options.output, options.filePath)
  }

  setSessionId(sessionId: string): void { this.sessionId = sessionId }

  debug(message: string, data?: Record<string, unknown>): void { this.log('debug', message, data) }
  info(message: string, data?: Record<string, unknown>): void { this.log('info', message, data) }
  warn(message: string, data?: Record<string, unknown>): void { this.log('warn', message, data) }
  error(message: string, data?: Record<string, unknown>): void { this.log('error', message, data) }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
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
