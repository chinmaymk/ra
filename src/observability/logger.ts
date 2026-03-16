import { JsonlWriter } from './writer'

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
  private sessionId: string | undefined
  private writer: JsonlWriter

  constructor(options: LoggerOptions) {
    this.level = options.level
    this.sessionId = options.sessionId
    this.writer = new JsonlWriter(options.output, options.filePath)
  }

  setSessionId(sessionId: string): void { this.sessionId = sessionId }

  /** Redirect log output to a new session directory. */
  async setSessionDir(sessionDir: string): Promise<void> {
    await this.writer.setFilePath(`${sessionDir}/logs.jsonl`)
  }

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

/** A no-op logger that silently discards all messages. */
export class NoopLogger extends Logger {
  constructor() { super({ level: 'error', output: 'stderr' }) }
  override debug(_message: string, _data?: Record<string, unknown>): void {}
  override info(_message: string, _data?: Record<string, unknown>): void {}
  override warn(_message: string, _data?: Record<string, unknown>): void {}
  override error(_message: string, _data?: Record<string, unknown>): void {}
  override async setSessionDir(_sessionDir: string): Promise<void> {}
  override async flush(): Promise<void> {}
}
