export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  if (ms <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}
