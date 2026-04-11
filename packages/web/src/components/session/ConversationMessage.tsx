import { useState, useMemo } from 'react'
import type { ResolvedMessage } from '@/lib/resolveMessages'
import type { ToolCall, ContentPart } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/Markdown'
import { SvgPreview } from '@/components/SvgPreview'
import {
  Sparkles, Brain, User, Terminal, Server, Loader2,
  CheckCircle2, XCircle, ChevronRight, ChevronDown,
} from 'lucide-react'

const SVG_REGEX = /<svg[\s\S]*?<\/svg>/gi

function extractSvgs(content: string): { cleaned: string; svgs: string[] } {
  const svgs: string[] = []
  const cleaned = content.replace(SVG_REGEX, (match) => {
    svgs.push(match)
    return ''
  }).trim()
  return { cleaned, svgs }
}

interface NormalizedContent {
  text: string
  images: Array<{ src: string; alt?: string }>
}

function normalizeContent(content: string | ContentPart[]): NormalizedContent {
  if (typeof content === 'string') return { text: content, images: [] }
  const text: string[] = []
  const images: Array<{ src: string; alt?: string }> = []
  for (const part of content) {
    if (part.type === 'text') {
      text.push(part.text)
    } else if (part.type === 'image') {
      if (part.source.type === 'base64') {
        images.push({ src: `data:${part.source.mediaType};base64,${part.source.data}` })
      } else {
        images.push({ src: part.source.url })
      }
    }
  }
  return { text: text.join(''), images }
}

interface ConversationMessageProps {
  message: ResolvedMessage
  compact?: boolean
}

export function ConversationMessage({ message, compact = false }: ConversationMessageProps) {
  const isUser = message.role === 'user'
  const { isStreaming } = message

  const { text, images } = useMemo(() => normalizeContent(message.content), [message.content])

  const { cleaned, svgs } = useMemo(
    () => text ? extractSvgs(text) : { cleaned: '', svgs: [] },
    [text],
  )

  return (
    <div
      className={cn(
        'group transition-colors',
        isStreaming && 'slide-up',
        isUser ? 'bg-surface-1/30' : 'hover:bg-surface-1/20',
      )}
    >
      <div className="flex gap-4 max-w-3xl mx-auto px-6 py-5">
        {/* Avatar */}
        <div
          className={cn(
            'h-7 w-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 shadow-sm',
            isUser
              ? 'bg-surface-2 border border-border'
              : 'bg-gradient-to-br from-primary to-primary-dim border border-primary/20',
          )}
        >
          {isUser
            ? <User className="h-3.5 w-3.5 text-muted-foreground" />
            : <Sparkles className="h-3.5 w-3.5 text-primary-foreground" />}
        </div>

        <div className="flex-1 min-w-0 space-y-2.5">
          {/* Label */}
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.08em]">
              {isUser ? 'You' : 'Assistant'}
            </span>
            {isStreaming && (
              <span className="text-[10px] text-primary flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-primary pulse" />
                streaming
              </span>
            )}
          </div>

          {/* Thinking */}
          {message.thinking && (
            <ThinkingBlock text={message.thinking} defaultOpen={!!isStreaming} />
          )}

          {/* Image attachments */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <img
                  key={i}
                  src={img.src}
                  alt={img.alt ?? `attachment ${i + 1}`}
                  className="max-h-64 max-w-full rounded-md border border-border object-contain bg-surface-1"
                />
              ))}
            </div>
          )}

          {/* Text content */}
          {cleaned && (
            <div className={cn(isStreaming && !isUser && 'streaming-cursor')}>
              <Markdown content={cleaned} className="text-[14px] text-foreground" />
            </div>
          )}

          {/* Thinking loader (streaming, no content yet) */}
          {isStreaming && !text && images.length === 0 && (!message.toolCalls || message.toolCalls.length === 0) && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span className="italic">thinking...</span>
            </div>
          )}

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="space-y-1.5">
              {message.toolCalls.map(tc => (
                <ToolCallCard key={tc.id} tc={tc} compact={compact} isStreaming={!!isStreaming} />
              ))}
            </div>
          )}

          {/* SVG previews */}
          {svgs.length > 0 && (
            <div className="space-y-3 pt-1">
              {svgs.map((svg, i) => (
                <SvgPreview key={i} svg={svg} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Thinking toggle ───────────────────────────────────────────── */

function ThinkingBlock({ text, defaultOpen }: { text: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-purple hover:text-purple/80 transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Brain className="h-3 w-3" />
        <span className="font-medium">Reasoning</span>
      </button>
      {open && (
        <div className="mt-2 ml-1 pl-3 border-l-2 border-purple/20 text-[12px] text-muted-foreground italic whitespace-pre-wrap leading-relaxed">
          {text}
        </div>
      )}
    </div>
  )
}

/* ── Tool call card ────────────────────────────────────────────── */

interface ToolCallCardProps {
  tc: ToolCall
  compact: boolean
  isStreaming: boolean
}

function ToolCallCard({ tc, compact, isStreaming }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const running = tc.result === undefined && !tc.isError
  const hasResult = tc.result !== undefined
  const mcp = parseMcpToolName(tc.name)

  // During streaming, show a compact non-expandable row
  if (isStreaming) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md border text-[11px] transition-colors',
          mcp && 'border-l-2 border-l-cyan-500/50',
          tc.isError
            ? 'border-destructive/30 bg-destructive/5'
            : running
              ? 'border-status-running/25 bg-status-running/5'
              : 'border-border bg-surface-1/40',
        )}
      >
        <ToolIcon tc={tc} running={running} isMcp={!!mcp} />
        {mcp ? (
          <>
            <span className="text-[10px] text-cyan-400/70 mono">{mcp.serverName}</span>
            <span className="text-dim-foreground text-[10px] mono">/</span>
            <span className="font-semibold mono">{mcp.toolName}</span>
          </>
        ) : (
          <span className="font-semibold mono">{tc.name}</span>
        )}
        <span className="text-dim-foreground truncate font-mono text-[10px] flex-1">
          {tc.arguments.slice(0, 60)}
        </span>
        <StatusIcon tc={tc} running={running} hasResult={hasResult} />
      </div>
    )
  }

  // History: expandable card
  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden transition-all duration-200',
        mcp && 'border-l-2 border-l-cyan-500/50',
        tc.isError
          ? 'border-destructive/30 bg-destructive/5'
          : running
            ? 'border-status-running/25 bg-status-running/5'
            : 'border-border bg-surface-1/40 hover:bg-surface-1/70 hover:border-border-strong',
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-[11px]"
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 text-dim-foreground shrink-0" />
          : <ChevronRight className="h-3 w-3 text-dim-foreground shrink-0" />}
        <ToolIcon tc={tc} running={running} isMcp={!!mcp} />
        {mcp ? (
          <>
            <span className="text-[10px] text-cyan-400/70 mono">{mcp.serverName}</span>
            <span className="text-dim-foreground text-[10px] mono">/</span>
            <span className="font-semibold mono text-foreground">{mcp.toolName}</span>
          </>
        ) : (
          <span className="font-semibold mono text-foreground">{tc.name}</span>
        )}
        {!compact && tc.arguments && (
          <span className="text-dim-foreground truncate font-mono text-[10px] max-w-xs flex-1">
            {summarizeArgs(tc.arguments)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {tc.durationMs !== undefined && (
            <span className="text-dim-foreground text-[10px] mono tabular">
              {tc.durationMs < 1000 ? `${tc.durationMs}ms` : `${(tc.durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
          <StatusIcon tc={tc} running={running} hasResult={hasResult} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border divide-y divide-border bg-surface-0/40">
          {tc.arguments && (
            <div className="px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-[0.08em] text-dim-foreground mb-1.5 font-semibold">Input</div>
              <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap break-words max-h-48 overflow-y-auto mono leading-relaxed">
                {formatArgs(tc.arguments)}
              </pre>
            </div>
          )}
          {tc.result !== undefined && (
            <div className="px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-[0.08em] text-dim-foreground mb-1.5 font-semibold">Output</div>
              <ToolResultContent tc={tc} />
            </div>
          )}
          {running && (
            <div className="px-3 py-2.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="italic">Executing...</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Shared sub-components ─────────────────────────────────────── */

function ToolIcon({ tc, running, isMcp = false }: { tc: ToolCall; running: boolean; isMcp?: boolean }) {
  const Icon = isMcp ? Server : Terminal
  return (
    <div className={cn(
      'flex h-4 w-4 items-center justify-center rounded shrink-0',
      tc.isError ? 'bg-destructive/15 text-destructive' :
      isMcp ? 'bg-cyan-500/15 text-cyan-400' :
      running ? 'bg-status-running/15 text-status-running' :
      'bg-warning/15 text-warning',
    )}>
      <Icon className="h-2.5 w-2.5" />
    </div>
  )
}

function StatusIcon({ tc, running, hasResult }: { tc: ToolCall; running: boolean; hasResult: boolean }) {
  return (
    <>
      {running && <Loader2 className="h-3 w-3 text-status-running animate-spin shrink-0" />}
      {hasResult && !tc.isError && <CheckCircle2 className="h-3 w-3 text-status-done shrink-0" />}
      {tc.isError && <XCircle className="h-3 w-3 text-destructive shrink-0" />}
    </>
  )
}

/* ── Tool result rendering ─────────────────────────────────────── */

/** Map common file extensions to markdown language identifiers */
const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', html: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', md: 'markdown', mdx: 'mdx', graphql: 'graphql',
  swift: 'swift', kt: 'kotlin', scala: 'scala', r: 'r',
  lua: 'lua', php: 'php', pl: 'perl', ex: 'elixir', exs: 'elixir',
  zig: 'zig', nim: 'nim', dart: 'dart', vue: 'vue', svelte: 'svelte',
  dockerfile: 'dockerfile', makefile: 'makefile',
}

/** Get the base tool name, stripping any MCP prefix */
function baseToolName(name: string): string {
  const mcp = parseMcpToolName(name)
  return mcp ? mcp.toolName : name
}

/** Infer language from the file path in tool arguments */
function inferLanguage(args: string): string {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>
    const filePath = (parsed.path ?? parsed.file ?? '') as string
    if (!filePath) return ''
    const basename = filePath.split('/').pop() ?? ''
    // Handle dotfiles like "Dockerfile", "Makefile"
    const lower = basename.toLowerCase()
    if (lower === 'dockerfile') return 'dockerfile'
    if (lower === 'makefile') return 'makefile'
    const ext = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() ?? '' : ''
    return EXT_LANG_MAP[ext] ?? ext
  } catch {
    return ''
  }
}

/** Strip "N: " line-number prefixes from read-file output */
function stripLineNumbers(text: string): string {
  return text.replace(/^\d+: /gm, '')
}

/** Try to detect if a string is valid JSON (object or array) */
function detectJson(text: string): boolean {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try { JSON.parse(trimmed); return true } catch { return false }
}

/** Try to detect if a string looks like XML */
function detectXml(text: string): boolean {
  const trimmed = text.trimStart()
  return (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) && trimmed.includes('</') 
}

function HighlightedBlock({ content, language }: { content: string; language: string }) {
  const markdown = `\`\`\`${language}\n${content}\n\`\`\``
  return (
    <div className="max-h-64 overflow-y-auto text-[11px]">
      <Markdown content={markdown} />
    </div>
  )
}

function ToolResultContent({ tc }: { tc: ToolCall }) {
  const toolName = baseToolName(tc.name)
  const result = tc.result ?? ''

  if (tc.isError) {
    return (
      <pre className="text-[11px] whitespace-pre-wrap break-words max-h-64 overflow-y-auto mono leading-relaxed text-destructive">
        {result}
      </pre>
    )
  }

  if (toolName === 'Read') {
    const lang = inferLanguage(tc.arguments)
    return <HighlightedBlock content={stripLineNumbers(result)} language={lang} />
  }

  if (toolName === 'LS') {
    return <HighlightedBlock content={result} language="" />
  }

  // Auto-detect JSON
  if (detectJson(result)) {
    try {
      const formatted = JSON.stringify(JSON.parse(result), null, 2)
      return <HighlightedBlock content={formatted} language="json" />
    } catch { /* fall through */ }
  }

  // Auto-detect XML
  if (detectXml(result)) {
    return <HighlightedBlock content={result} language="xml" />
  }

  return (
    <pre className="text-[11px] whitespace-pre-wrap break-words max-h-64 overflow-y-auto mono leading-relaxed text-foreground/80">
      {result}
    </pre>
  )
}

/* ── Helpers ───────────────────────────────────────────────────── */

function formatArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    return args
  }
}

/** Parse MCP tool names in the format `mcp__<serverName>__<toolName>` (split on `__` delimiter) */
function parseMcpToolName(name: string): { serverName: string; toolName: string } | null {
  const parts = name.split('__')
  if (parts.length !== 3 || parts[0] !== 'mcp' || !parts[1] || !parts[2]) return null
  return { serverName: parts[1], toolName: parts[2] }
}

function summarizeArgs(args: string): string {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>
    const entries = Object.entries(parsed).slice(0, 2)
    return entries.map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v).slice(0, 30)}`).join(' ')
  } catch {
    return args.slice(0, 60)
  }
}
