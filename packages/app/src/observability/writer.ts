import { appendFile } from 'node:fs/promises'

/** Shared JSONL writer for observability output (logger and tracer). */
export class JsonlWriter {
  private output: 'stderr' | 'stdout' | 'file'
  private filePath: string | undefined
  private tail: Promise<void> = Promise.resolve()

  constructor(output: 'stderr' | 'stdout' | 'file', filePath?: string) {
    this.output = output
    if (output === 'file' && filePath) {
      this.filePath = filePath
    }
  }

  write(data: unknown): void {
    const line = JSON.stringify(data) + '\n'
    if (this.filePath) {
      this.tail = this.tail.then(() => appendFile(this.filePath!, line))
    } else if (this.output === 'stdout') {
      process.stdout.write(line)
    } else {
      process.stderr.write(line)
    }
  }

  async flush(): Promise<void> {
    await this.tail
  }
}
