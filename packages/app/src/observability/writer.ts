import { appendFile } from 'node:fs/promises'

/** Shared JSONL writer for observability output (logger and tracer). */
export class JsonlWriter {
  private output: 'stderr' | 'stdout' | 'file'
  private filePath: string | undefined
  private buffer: string[] = []

  constructor(output: 'stderr' | 'stdout' | 'file', filePath?: string) {
    this.output = output
    if (output === 'file' && filePath) {
      this.filePath = filePath
    }
  }

  write(data: unknown): void {
    const line = JSON.stringify(data) + '\n'
    if (this.filePath) {
      this.buffer.push(line)
    } else if (this.output === 'stdout') {
      process.stdout.write(line)
    } else {
      process.stderr.write(line)
    }
  }

  async flush(): Promise<void> {
    if (this.filePath && this.buffer.length > 0) {
      const data = this.buffer.join('')
      this.buffer = []
      await appendFile(this.filePath, data)
    }
  }
}
