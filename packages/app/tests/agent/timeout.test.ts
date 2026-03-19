import { test, expect } from 'bun:test'
import { withTimeout } from '@chinmaymk/ra'

test('resolves when promise completes before timeout', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 1000, 'test operation')
  expect(result).toBe('ok')
})

test('rejects with timeout error when promise exceeds timeout', async () => {
  const slow = new Promise(resolve => setTimeout(resolve, 5000))
  await expect(withTimeout(slow, 50, 'test operation')).rejects.toThrow("test operation timed out after 50ms")
})

test('returns promise directly when timeout is 0 (disabled)', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 0, 'test operation')
  expect(result).toBe('ok')
})

test('propagates original errors (not timeout)', async () => {
  await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'test')).rejects.toThrow('boom')
})
