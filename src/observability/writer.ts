import { appendFile } from 'node:fs/promises'

/** Shared JSONL writer for observability output (logger and tracer). */
export class JsonlWriter {
  private filePath: string | undefined
  private output: 'stderr' | 'stdout' | 'file'
  private pending: Promise<void>[] = []

  constructor(output: 'stderr' | 'stdout' | 'file', filePath?: string) {
    this.output = output
    if (output === 'file' && filePath) {
      this.filePath = filePath
    }
  }

  write(data: unknown): void {
    const line = JSON.stringify(data) + '\n'
    if (this.filePath) {
      const p = appendFile(this.filePath, line).catch(() => {})
      this.pending.push(p)
    } else if (this.output === 'stdout') {
      process.stdout.write(line)
    } else {
      process.stderr.write(line)
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.pending)
    this.pending = []
  }
}
