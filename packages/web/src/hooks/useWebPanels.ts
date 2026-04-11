import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { WebPanelInfo } from '@/lib/types'

export function useWebPanels(): WebPanelInfo[] {
  const [panels, setPanels] = useState<WebPanelInfo[]>([])

  useEffect(() => {
    let cancelled = false
    api.web.panels()
      .then(r => {
        if (!cancelled) setPanels(r.panels)
      })
      .catch(() => {
        if (!cancelled) setPanels([])
      })
    return () => { cancelled = true }
  }, [])

  return panels
}
