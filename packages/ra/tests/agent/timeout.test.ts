import { test, expect } from 'bun:test'
import { withTimeout, TimeoutError } from '@chinmaymk/ra'

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

test('TimeoutError has correct name and message', () => {
  const err = new TimeoutError('MyTool', 5000)
  expect(err.name).toBe('TimeoutError')
  expect(err.message).toBe("MyTool timed out after 5000ms")
  expect(err).toBeInstanceOf(Error)
  expect(err).toBeInstanceOf(TimeoutError)
})

test('negative timeout returns promise directly (same as disabled)', async () => {
  const result = await withTimeout(Promise.resolve('ok'), -1, 'test')
  expect(result).toBe('ok')
})

test('timeout error is instanceof TimeoutError', async () => {
  const slow = new Promise(resolve => setTimeout(resolve, 5000))
  try {
    await withTimeout(slow, 50, 'slow op')
    expect.unreachable('should have thrown')
  } catch (err) {
    expect(err).toBeInstanceOf(TimeoutError)
  }
})
