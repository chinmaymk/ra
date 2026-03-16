/** Shared JSONL writer for observability output (logger and tracer). */
export class JsonlWriter {
  private fileWriter: ReturnType<ReturnType<typeof Bun.file>['writer']> | undefined
  private output: 'stderr' | 'stdout' | 'file'

  constructor(output: 'stderr' | 'stdout' | 'file', filePath?: string) {
    this.output = output
    if (output === 'file' && filePath) {
      this.fileWriter = Bun.file(filePath).writer()
    }
  }

  write(data: unknown): void {
    const line = JSON.stringify(data) + '\n'
    if (this.fileWriter) this.fileWriter.write(line)
    else if (this.output === 'stdout') process.stdout.write(line)
    else process.stderr.write(line)
  }

  async flush(): Promise<void> {
    if (this.fileWriter) await this.fileWriter.flush()
  }
}
