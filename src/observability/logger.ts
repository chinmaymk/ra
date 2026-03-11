export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  sessionId?: string
  [key: string]: unknown
}

export interface LoggerOptions {
  level: LogLevel
  output: 'stderr' | 'stdout' | 'file' | 'session'
  filePath?: string
  sessionId?: string
}

export class Logger {
  private level: LogLevel
  private output: 'stderr' | 'stdout' | 'file' | 'session'
  private filePath: string | undefined
  private sessionId: string | undefined
  private fileWriter: ReturnType<ReturnType<typeof Bun.file>['writer']> | undefined
  private pendingLines: string[] | undefined

  constructor(options: LoggerOptions) {
    this.level = options.level
    this.output = options.output
    this.filePath = options.filePath
    this.sessionId = options.sessionId
    if (this.output === 'file' && this.filePath) {
      this.fileWriter = Bun.file(this.filePath).writer()
    }
    if (this.output === 'session') {
      this.pendingLines = []
    }
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId
  }

  /** Set the session directory for 'session' output mode. Flushes any buffered lines. */
  setSessionDir(sessionDir: string): void {
    if (this.output !== 'session') return
    this.fileWriter = Bun.file(`${sessionDir}/logs.jsonl`).writer()
    if (this.pendingLines) {
      for (const line of this.pendingLines) {
        this.fileWriter.write(line)
      }
      this.pendingLines = undefined
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data)
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data)
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data)
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data)
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[this.level]) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(this.sessionId && { sessionId: this.sessionId }),
      ...data,
    }

    this.emit(entry)
  }

  /** Flush buffered file writes. Call before process exit. */
  async flush(): Promise<void> {
    if (this.fileWriter) {
      await this.fileWriter.flush()
    }
  }

  private emit(entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n'
    if (this.output === 'session' && this.pendingLines) {
      this.pendingLines.push(line)
    } else if (this.fileWriter) {
      this.fileWriter.write(line)
    } else if (this.output === 'stdout') {
      process.stdout.write(line)
    } else {
      process.stderr.write(line)
    }
  }
}

/** A no-op logger that silently discards all messages. */
export class NoopLogger extends Logger {
  constructor() {
    super({ level: 'error', output: 'stderr' })
  }
  override debug(_message: string, _data?: Record<string, unknown>): void {}
  override info(_message: string, _data?: Record<string, unknown>): void {}
  override warn(_message: string, _data?: Record<string, unknown>): void {}
  override error(_message: string, _data?: Record<string, unknown>): void {}
  override async flush(): Promise<void> {}
}
