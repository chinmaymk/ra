import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { SessionInfo } from '@/lib/types'
import { api } from '@/lib/api'

export function useSessionList(pollIntervalMs = 2000) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const requestCounterRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const pollIntervalRef = useRef(pollIntervalMs)

  // Keep the interval ref in sync so the stable callbacks use the latest value
  pollIntervalRef.current = pollIntervalMs

  const clearPollTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const scheduleNextPoll = useCallback(() => {
    clearPollTimeout()
    timeoutRef.current = setTimeout(() => {
      fetchSessions().then(() => {
        if (mountedRef.current) scheduleNextPoll()
      })
    }, pollIntervalRef.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchSessions = useCallback(async () => {
    const requestId = ++requestCounterRef.current
    try {
      const list = await api.sessions.list()
      if (!mountedRef.current || requestId !== requestCounterRef.current) return
      setSessions(list)
      setError(null)
      setIsLoading(false)
    } catch (err) {
      if (!mountedRef.current || requestId !== requestCounterRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions')
      setIsLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    clearPollTimeout()
    await fetchSessions()
    if (mountedRef.current) scheduleNextPoll()
  }, [clearPollTimeout, fetchSessions, scheduleNextPoll])

  useEffect(() => {
    mountedRef.current = true

    // Initial fetch, then start polling
    fetchSessions().then(() => {
      if (mountedRef.current) scheduleNextPoll()
    })

    return () => {
      mountedRef.current = false
      clearPollTimeout()
    }
  }, [fetchSessions, scheduleNextPoll, clearPollTimeout])

  // Reset poll timing when interval changes
  useEffect(() => {
    pollIntervalRef.current = pollIntervalMs
  }, [pollIntervalMs])

  const needsInput = useMemo(() => sessions.filter(s => s.status === 'needs-input'), [sessions])
  const running = useMemo(() => sessions.filter(s => s.status === 'running'), [sessions])
  const hasErrors = useMemo(() => sessions.filter(s => s.status === 'error'), [sessions])
  const done = useMemo(() => sessions.filter(s => s.status === 'done'), [sessions])

  return { sessions, needsInput, running, hasErrors, done, error, isLoading, refresh }
}
