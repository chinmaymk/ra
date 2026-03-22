import { createWriteStream, type WriteStream } from 'node:fs'

/** Shared JSONL writer for observability output (logger and tracer). */
export class JsonlWriter {
  private stream: WriteStream | undefined
  private output: 'stderr' | 'stdout' | 'file'
  private filePath: string | undefined

  constructor(output: 'stderr' | 'stdout' | 'file', filePath?: string) {
    this.output = output
    if (output === 'file' && filePath) {
      this.filePath = filePath
      this.stream = createWriteStream(filePath, { flags: 'a' })
    }
  }

  write(data: unknown): void {
    const line = JSON.stringify(data) + '\n'
    if (this.filePath) {
      if (!this.stream) this.stream = createWriteStream(this.filePath, { flags: 'a' })
      this.stream.write(line)
    } else if (this.output === 'stdout') {
      process.stdout.write(line)
    } else {
      process.stderr.write(line)
    }
  }

  async flush(): Promise<void> {
    const stream = this.stream
    if (!stream) return
    this.stream = undefined
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', resolve)
      stream.once('error', reject)
      stream.end()
    })
  }
}
