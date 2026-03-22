import { appendFileSync } from 'node:fs'

/** Shared JSONL writer for observability output (logger and tracer). */
export class JsonlWriter {
  private output: 'stderr' | 'stdout' | 'file'
  private filePath: string | undefined

  constructor(output: 'stderr' | 'stdout' | 'file', filePath?: string) {
    this.output = output
    if (output === 'file' && filePath) {
      this.filePath = filePath
    }
  }

  write(data: unknown): void {
    const line = JSON.stringify(data) + '\n'
    if (this.filePath) {
      appendFileSync(this.filePath, line)
    } else if (this.output === 'stdout') {
      process.stdout.write(line)
    } else {
      process.stderr.write(line)
    }
  }

  async flush(): Promise<void> {
    // No-op: appendFileSync writes are immediately flushed by the OS.
  }
}
