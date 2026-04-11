import type {
  SessionInfo,
  CreateSessionOptions,
  Message,
  ToolInfo,
  MiddlewareInfo,
  ProviderInfo,
  ConfigSummary,
  ImageAttachment,
  KnowledgeBase,
  KnowledgeDocument,
  WebPanelInfo,
} from './types'

const BASE = '/api'

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  sessions: {
    list: () => fetchJson<SessionInfo[]>('/sessions'),

    create: (message: string, options?: CreateSessionOptions) =>
      fetchJson<SessionInfo>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ message, ...options }),
      }),

    get: (id: string) => fetchJson<SessionInfo>(`/sessions/${id}`),

    messages: (id: string) => fetchJson<Message[]>(`/sessions/${id}/messages`),

    send: (id: string, message: string, attachments?: ImageAttachment[]) =>
      fetchJson<{ ok: boolean }>(`/sessions/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message, attachments }),
      }),

    stop: (id: string) =>
      fetchJson<{ ok: boolean }>(`/sessions/${id}/stop`, { method: 'POST' }),

    markDone: (id: string) =>
      fetchJson<{ ok: boolean }>(`/sessions/${id}/done`, { method: 'POST' }),

    delete: (id: string) =>
      fetchJson<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
  },

  config: {
    get: () => fetchJson<ConfigSummary>('/config'),
    update: (updates: Partial<ConfigSummary>) =>
      fetchJson<ConfigSummary>('/config', {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),
  },

  tools: {
    list: () => fetchJson<ToolInfo[]>('/tools'),
  },

  middleware: {
    list: () => fetchJson<MiddlewareInfo[]>('/middleware'),
  },

  web: {
    panels: () => fetchJson<{ panels: WebPanelInfo[] }>('/web/panels'),
  },

  providers: {
    list: () => fetchJson<ProviderInfo[]>('/providers'),
  },

  terminal: {
    create: (command: string, cwd?: string) =>
      fetchJson<{ id: string }>('/terminal', {
        method: 'POST',
        body: JSON.stringify({ command, cwd }),
      }),

    stream: (id: string): EventSource =>
      new EventSource(`${BASE}/terminal/${id}/stream`),

    kill: (id: string) =>
      fetchJson<{ ok: boolean }>(`/terminal/${id}/kill`, { method: 'POST' }),

    stdin: (id: string, data: string) =>
      fetchJson<{ ok: boolean }>(`/terminal/${id}/stdin`, {
        method: 'POST',
        body: JSON.stringify({ data }),
      }),
  },

  knowledge: {
    list: () => fetchJson<KnowledgeBase[]>('/knowledge'),

    get: (id: string) => fetchJson<KnowledgeBase>(`/knowledge/${id}`),

    create: (name: string, description: string, embedding?: string) =>
      fetchJson<KnowledgeBase>('/knowledge', {
        method: 'POST',
        body: JSON.stringify({ name, description, embedding }),
      }),

    update: (id: string, updates: Partial<Pick<KnowledgeBase, 'name' | 'description'>>) =>
      fetchJson<KnowledgeBase>(`/knowledge/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),

    delete: (id: string) =>
      fetchJson<{ ok: boolean }>(`/knowledge/${id}`, { method: 'DELETE' }),

    documents: (id: string) =>
      fetchJson<KnowledgeDocument[]>(`/knowledge/${id}/documents`),

    upload: (id: string, formData: FormData) =>
      fetch(`${BASE}/knowledge/${id}/documents`, { method: 'POST', body: formData })
        .then(r => { if (!r.ok) throw new Error('Upload failed'); return r.json() as Promise<KnowledgeDocument> }),

    deleteDocument: (kbId: string, docId: string) =>
      fetchJson<{ ok: boolean }>(`/knowledge/${kbId}/documents/${docId}`, { method: 'DELETE' }),
  },

  subscribe: (id: string): EventSource => new EventSource(`${BASE}/sessions/${id}/events`),
}
