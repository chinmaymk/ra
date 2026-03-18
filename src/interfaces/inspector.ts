import { join } from 'path'
import type { SessionStorage } from '../storage/sessions'
import type { MemoryStore } from '../memory/store'

export interface InspectorOptions {
  port: number
  storage: SessionStorage
  memoryStore?: MemoryStore
  dataDir: string
}

// ── API Handlers ──────────────────────────────────────────────────────

async function apiSessions(storage: SessionStorage): Promise<Response> {
  const sessions = await storage.list()
  sessions.sort((a, b) => new Date(b.meta.created).getTime() - new Date(a.meta.created).getTime())
  return json(sessions)
}

async function apiSessionMessages(storage: SessionStorage, id: string): Promise<Response> {
  try {
    const messages = await storage.readMessages(id)
    return json(messages)
  } catch {
    return json({ error: 'Session not found' }, 404)
  }
}

async function apiSessionLogs(storage: SessionStorage, id: string): Promise<Response> {
  return readJsonl(join(storage.sessionDir(id), 'logs.jsonl'))
}

async function apiSessionTraces(storage: SessionStorage, id: string): Promise<Response> {
  return readJsonl(join(storage.sessionDir(id), 'traces.jsonl'))
}

async function apiMemories(memoryStore?: MemoryStore, query?: string): Promise<Response> {
  if (!memoryStore) return json([])
  if (query) return json(memoryStore.search(query, 100))
  return json(memoryStore.list(100))
}

// ── Helpers ───────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

async function readJsonl(path: string): Promise<Response> {
  const file = Bun.file(path)
  if (!(await file.exists())) return json([])
  const text = await file.text()
  const entries = text
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
  return json(entries)
}

// ── HTML ──────────────────────────────────────────────────────────────

function indexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ra inspector</title>
<style>
  :root {
    --bg: #0d1117; --bg2: #161b22; --bg3: #21262d; --border: #30363d;
    --text: #e6edf3; --text2: #8b949e; --accent: #58a6ff; --accent2: #3fb950;
    --red: #f85149; --orange: #d29922; --purple: #bc8cff;
    --font: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; line-height: 1.5; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Layout */
  .app { display: grid; grid-template-columns: 300px 1fr; grid-template-rows: 48px 1fr; height: 100vh; }
  header { grid-column: 1 / -1; background: var(--bg2); border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 16px; gap: 16px; }
  header h1 { font-size: 15px; font-weight: 600; color: var(--accent); }
  header .tabs { display: flex; gap: 2px; }
  header .tab { padding: 6px 14px; border-radius: 6px; cursor: pointer; color: var(--text2); transition: all 0.15s; font-size: 12px; }
  header .tab:hover { background: var(--bg3); color: var(--text); }
  header .tab.active { background: var(--accent); color: #fff; }
  .sidebar { background: var(--bg2); border-right: 1px solid var(--border); overflow-y: auto; }
  .main { overflow-y: auto; padding: 16px; }

  /* Sidebar */
  .sidebar-header { padding: 12px 14px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text2); }
  .session-item { padding: 10px 14px; cursor: pointer; border-left: 3px solid transparent; transition: all 0.1s; }
  .session-item:hover { background: var(--bg3); }
  .session-item.active { background: var(--bg3); border-left-color: var(--accent); }
  .session-item .id { font-size: 12px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .session-item .meta { font-size: 11px; color: var(--text2); margin-top: 2px; }

  /* Messages */
  .message { margin-bottom: 12px; border-radius: 8px; padding: 12px 16px; max-width: 100%; }
  .message.user { background: #1c2940; border: 1px solid #1f3a5f; }
  .message.assistant { background: var(--bg2); border: 1px solid var(--border); }
  .message.system { background: #1a1e2e; border: 1px solid #2d3555; }
  .message.tool { background: #1a2216; border: 1px solid #2a3d22; font-size: 12px; }
  .message .role { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; font-weight: 700; }
  .message.user .role { color: var(--accent); }
  .message.assistant .role { color: var(--accent2); }
  .message.system .role { color: var(--purple); }
  .message.tool .role { color: var(--orange); }
  .message .content { white-space: pre-wrap; word-break: break-word; }
  .message .tool-calls { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
  .tool-call { background: var(--bg); border-radius: 6px; padding: 8px 12px; margin-top: 6px; font-size: 12px; }
  .tool-call .name { color: var(--orange); font-weight: 600; }
  .tool-call .args { color: var(--text2); margin-top: 4px; max-height: 200px; overflow-y: auto; }

  /* Logs */
  .log-entry { display: grid; grid-template-columns: 180px 50px 1fr; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--border); font-size: 12px; align-items: start; }
  .log-entry:hover { background: var(--bg2); }
  .log-ts { color: var(--text2); font-size: 11px; }
  .log-level { font-weight: 700; font-size: 11px; text-transform: uppercase; }
  .log-level.debug { color: var(--text2); }
  .log-level.info { color: var(--accent); }
  .log-level.warn { color: var(--orange); }
  .log-level.error { color: var(--red); }
  .log-msg { color: var(--text); }
  .log-data { color: var(--text2); font-size: 11px; margin-top: 2px; }

  /* Traces */
  .trace-entry { border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .trace-header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--bg2); cursor: pointer; }
  .trace-header:hover { background: var(--bg3); }
  .trace-name { font-weight: 600; color: var(--accent); }
  .trace-duration { color: var(--orange); font-size: 12px; }
  .trace-status { font-size: 11px; padding: 1px 8px; border-radius: 10px; font-weight: 600; }
  .trace-status.ok { background: #1a2e1a; color: var(--accent2); }
  .trace-status.error { background: #2e1a1a; color: var(--red); }
  .trace-attrs { padding: 10px 14px; font-size: 12px; display: none; }
  .trace-entry.open .trace-attrs { display: block; }
  .attr-row { display: flex; gap: 8px; padding: 2px 0; }
  .attr-key { color: var(--purple); min-width: 160px; }
  .attr-val { color: var(--text2); word-break: break-all; }
  .trace-indent { display: flex; align-items: center; gap: 4px; }
  .indent-bar { width: 2px; height: 100%; background: var(--border); margin-left: 8px; }

  /* Memory */
  .memory-search { display: flex; gap: 8px; margin-bottom: 16px; }
  .memory-search input { flex: 1; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; color: var(--text); font-family: var(--font); font-size: 13px; outline: none; }
  .memory-search input:focus { border-color: var(--accent); }
  .memory-search button { background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-family: var(--font); font-size: 12px; font-weight: 600; }
  .memory-item { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; }
  .memory-item .memory-content { white-space: pre-wrap; word-break: break-word; }
  .memory-item .memory-meta { font-size: 11px; color: var(--text2); margin-top: 6px; display: flex; gap: 12px; }
  .memory-item .memory-tags { color: var(--purple); }

  /* States */
  .empty { text-align: center; padding: 48px 16px; color: var(--text2); }
  .empty .icon { font-size: 32px; margin-bottom: 12px; }
  .badge { font-size: 10px; background: var(--bg3); color: var(--text2); padding: 2px 8px; border-radius: 10px; }
  .loading { text-align: center; padding: 32px; color: var(--text2); }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--border); }
</style>
</head>
<body>
<div class="app">
  <header>
    <h1>ra inspector</h1>
    <div class="tabs">
      <div class="tab active" data-view="messages">Messages</div>
      <div class="tab" data-view="logs">Logs</div>
      <div class="tab" data-view="traces">Traces</div>
      <div class="tab" data-view="memory">Memory</div>
    </div>
  </header>
  <div class="sidebar" id="sidebar">
    <div class="sidebar-header">Sessions</div>
    <div id="session-list"><div class="loading">Loading…</div></div>
  </div>
  <div class="main" id="main">
    <div class="empty"><div class="icon">&#9776;</div>Select a session to inspect</div>
  </div>
</div>
<script>
(function() {
  const $ = (s, el) => (el || document).querySelector(s)
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)]
  const main = $('#main')
  let currentSession = null
  let currentView = 'messages'

  // ── Tabs ──
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      currentView = tab.dataset.view
      if (currentView === 'memory') loadMemory()
      else if (currentSession) loadSessionView(currentSession, currentView)
    })
  })

  // ── Sessions ──
  async function loadSessions() {
    const res = await fetch('/api/sessions')
    const sessions = await res.json()
    const list = $('#session-list')
    if (!sessions.length) { list.innerHTML = '<div class="empty">No sessions</div>'; return }
    list.innerHTML = sessions.map(s => {
      const d = new Date(s.meta.created)
      const time = d.toLocaleString()
      return '<div class="session-item" data-id="' + esc(s.id) + '">' +
        '<div class="id">' + esc(s.id.slice(0, 8)) + '… <span class="badge">' + esc(s.meta.provider) + '/' + esc(s.meta.model) + '</span></div>' +
        '<div class="meta">' + esc(s.meta.interface) + ' · ' + esc(time) + '</div></div>'
    }).join('')
    $$('.session-item', list).forEach(el => {
      el.addEventListener('click', () => {
        $$('.session-item').forEach(e => e.classList.remove('active'))
        el.classList.add('active')
        currentSession = el.dataset.id
        loadSessionView(currentSession, currentView)
      })
    })
  }

  // ── Load view ──
  async function loadSessionView(id, view) {
    if (view === 'memory') { loadMemory(); return }
    main.innerHTML = '<div class="loading">Loading…</div>'
    try {
      const res = await fetch('/api/sessions/' + id + '/' + view)
      const data = await res.json()
      if (view === 'messages') renderMessages(data)
      else if (view === 'logs') renderLogs(data)
      else if (view === 'traces') renderTraces(data)
    } catch(e) { main.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>' }
  }

  // ── Render Messages ──
  function renderMessages(messages) {
    if (!messages.length) { main.innerHTML = '<div class="empty">No messages</div>'; return }
    main.innerHTML = messages.map(m => {
      const role = m.role || 'unknown'
      const cls = role === 'tool' ? 'tool' : role
      let content = ''
      if (typeof m.content === 'string') {
        content = esc(m.content)
      } else if (Array.isArray(m.content)) {
        content = m.content.map(block => {
          if (typeof block === 'string') return esc(block)
          if (block.type === 'text') return esc(block.text || '')
          if (block.type === 'thinking') return '<span style="color:var(--purple)">[thinking] </span>' + esc(block.thinking || '')
          if (block.type === 'tool_use') return '<span style="color:var(--orange)">[tool_use: ' + esc(block.name || '') + ']</span>\\n' + esc(JSON.stringify(block.input, null, 2))
          if (block.type === 'tool_result') return '<span style="color:var(--accent2)">[tool_result]</span>\\n' + esc(typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2))
          return esc(JSON.stringify(block, null, 2))
        }).join('\\n')
      } else if (m.content != null) {
        content = esc(JSON.stringify(m.content, null, 2))
      }

      let toolCallsHtml = ''
      if (m.toolCalls && m.toolCalls.length) {
        toolCallsHtml = '<div class="tool-calls">' + m.toolCalls.map(tc =>
          '<div class="tool-call"><span class="name">' + esc(tc.name || tc.function?.name || 'tool') + '</span>' +
          '<div class="args">' + esc(JSON.stringify(tc.input || tc.arguments || tc.function?.arguments, null, 2)) + '</div></div>'
        ).join('') + '</div>'
      }

      return '<div class="message ' + cls + '">' +
        '<div class="role">' + esc(role) + (m.toolCallId ? ' <span class="badge">' + esc(m.toolCallId) + '</span>' : '') + '</div>' +
        '<div class="content">' + content + '</div>' +
        toolCallsHtml + '</div>'
    }).join('')
    main.scrollTop = main.scrollHeight
  }

  // ── Render Logs ──
  function renderLogs(logs) {
    if (!logs.length) { main.innerHTML = '<div class="empty">No logs</div>'; return }
    main.innerHTML = logs.map(log => {
      const ts = log.timestamp ? new Date(log.timestamp).toLocaleString() : ''
      const level = (log.level || 'info').toLowerCase()
      const msg = log.message || ''
      const rest = Object.keys(log).filter(k => !['timestamp','level','message','sessionId'].includes(k))
      const extra = rest.length ? rest.map(k => esc(k) + '=' + esc(JSON.stringify(log[k]))).join(' ') : ''
      return '<div class="log-entry">' +
        '<span class="log-ts">' + esc(ts) + '</span>' +
        '<span class="log-level ' + level + '">' + esc(level) + '</span>' +
        '<span><span class="log-msg">' + esc(msg) + '</span>' +
        (extra ? '<div class="log-data">' + extra + '</div>' : '') + '</span></div>'
    }).join('')
  }

  // ── Render Traces ──
  function renderTraces(traces) {
    if (!traces.length) { main.innerHTML = '<div class="empty">No traces</div>'; return }
    // Build tree by traceId
    const byTrace = new Map()
    for (const t of traces) {
      const tid = t.traceId || 'unknown'
      if (!byTrace.has(tid)) byTrace.set(tid, [])
      byTrace.get(tid).push(t)
    }
    let html = ''
    for (const [tid, spans] of byTrace) {
      html += '<div style="margin-bottom:16px"><div style="font-size:11px;color:var(--text2);margin-bottom:8px">Trace ' + esc(tid.slice(0,8)) + '…</div>'
      // Build parent-child tree
      const byId = new Map()
      const roots = []
      for (const s of spans) { byId.set(s.spanId, s) }
      for (const s of spans) {
        if (!s.parentSpanId || !byId.has(s.parentSpanId)) roots.push(s)
      }
      function renderSpan(span, depth) {
        const dur = span.durationMs != null ? span.durationMs.toFixed(1) + 'ms' : ''
        const status = span.status || 'ok'
        const attrs = span.attributes || {}
        const attrHtml = Object.entries(attrs).map(([k,v]) =>
          '<div class="attr-row"><span class="attr-key">' + esc(k) + '</span><span class="attr-val">' + esc(JSON.stringify(v)) + '</span></div>'
        ).join('')
        let eventsHtml = ''
        if (span.events && span.events.length) {
          eventsHtml = '<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px">' +
            span.events.map(ev => '<div class="attr-row"><span class="attr-key">' + esc(ev.name) + '</span><span class="attr-val">' + esc(JSON.stringify(ev.attributes || {})) + '</span></div>').join('') + '</div>'
        }
        const indent = depth * 20
        let out = '<div class="trace-entry" style="margin-left:' + indent + 'px">' +
          '<div class="trace-header" onclick="this.parentElement.classList.toggle(\'open\')">' +
          '<span class="trace-name">' + esc(span.name) + '</span>' +
          '<span class="trace-duration">' + esc(dur) + '</span>' +
          '<span class="trace-status ' + status + '">' + esc(status) + '</span></div>' +
          '<div class="trace-attrs">' + attrHtml + eventsHtml + '</div></div>'
        // Render children
        const children = spans.filter(s => s.parentSpanId === span.spanId)
        children.sort((a,b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
        for (const child of children) out += renderSpan(child, depth + 1)
        return out
      }
      for (const root of roots) html += renderSpan(root, 0)
      html += '</div>'
    }
    main.innerHTML = html
  }

  // ── Memory ──
  async function loadMemory(query) {
    main.innerHTML = '<div class="memory-search"><input type="text" placeholder="Search memories…" id="mem-q" value="' + esc(query || '') + '"><button onclick="searchMem()">Search</button></div><div id="mem-list"><div class="loading">Loading…</div></div>'
    const url = query ? '/api/memory?q=' + encodeURIComponent(query) : '/api/memory'
    const res = await fetch(url)
    const memories = await res.json()
    const list = $('#mem-list')
    if (!memories.length) { list.innerHTML = '<div class="empty">No memories</div>'; return }
    list.innerHTML = memories.map(m =>
      '<div class="memory-item"><div class="memory-content">' + esc(m.content) + '</div>' +
      '<div class="memory-meta"><span>' + esc(m.createdAt || '') + '</span>' +
      (m.tags ? '<span class="memory-tags">' + esc(m.tags) + '</span>' : '') +
      '<span class="badge">id:' + m.id + '</span></div></div>'
    ).join('')
  }
  window.searchMem = () => {
    const q = $('#mem-q')
    loadMemory(q ? q.value : '')
  }
  // Enter to search
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target && e.target.id === 'mem-q') window.searchMem()
  })

  function esc(s) { if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

  loadSessions()
})()
</script>
</body>
</html>`
}

// ── Server ────────────────────────────────────────────────────────────

export class InspectorServer {
  private server: ReturnType<typeof Bun.serve> | null = null
  private options: InspectorOptions

  constructor(options: InspectorOptions) {
    this.options = options
  }

  get port(): number { return (this.server?.port ?? this.options.port) as number }

  async start(): Promise<void> {
    const { storage, memoryStore } = this.options

    this.server = Bun.serve({
      port: this.options.port,
      fetch: async (req: Request): Promise<Response> => {
        const url = new URL(req.url)
        const path = url.pathname

        // API routes
        if (path === '/api/sessions') return apiSessions(storage)

        const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)\/(\w+)$/)
        if (sessionMatch) {
          const [, id, view] = sessionMatch
          if (view === 'messages') return apiSessionMessages(storage, id!)
          if (view === 'logs') return apiSessionLogs(storage, id!)
          if (view === 'traces') return apiSessionTraces(storage, id!)
          return json({ error: 'Unknown view' }, 404)
        }

        if (path === '/api/memory') {
          const q = url.searchParams.get('q') || undefined
          return apiMemories(memoryStore, q)
        }

        // Serve the SPA
        if (path === '/' || path === '/index.html') {
          return new Response(indexHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        }

        return json({ error: 'Not Found' }, 404)
      },
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop(true)
      this.server = null
    }
  }
}
