/** Shared JSON-line output writer for Logger and Tracer */
export class OutputWriter {
  private fileWriter: ReturnType<ReturnType<typeof Bun.file>['writer']> | undefined

  constructor(
    private readonly output: 'stderr' | 'stdout' | 'file',
    filePath?: string,
  ) {
    if (output === 'file' && filePath) {
      this.fileWriter = Bun.file(filePath).writer()
    }
  }

  write(record: unknown): void {
    const line = JSON.stringify(record) + '\n'
    if (this.fileWriter) this.fileWriter.write(line)
    else if (this.output === 'stdout') process.stdout.write(line)
    else process.stderr.write(line)
  }

  async flush(): Promise<void> {
    if (this.fileWriter) await this.fileWriter.flush()
  }
}
