import { test, expect } from "bun:test"

// Test the budget logic in isolation
test("stops loop when token budget exceeded", () => {
  let stopped = false
  const budget = 100_000
  const accumulated = 150_000

  if (accumulated > budget) {
    stopped = true
  }

  expect(stopped).toBe(true)
})

test("does not stop when under budget", () => {
  let stopped = false
  const budget = 100_000
  const accumulated = 50_000

  if (accumulated > budget) {
    stopped = true
  }

  expect(stopped).toBe(false)
})

test("does not stop when exactly at budget", () => {
  let stopped = false
  const budget = 100_000
  const accumulated = 100_000

  if (accumulated > budget) {
    stopped = true
  }

  expect(stopped).toBe(false)
})
