import { useState, useRef, useEffect } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ArrowUp, GitBranch, Sliders, Square, Sparkles, X, ImageIcon, Paperclip } from 'lucide-react'
import type { ProviderInfo, CreateSessionOptions, ImageAttachment } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ChatComposerProps {
  onSubmit: (message: string, options?: CreateSessionOptions) => void
  placeholder?: string
  disabled?: boolean
  running?: boolean
  onStop?: () => void
  showOptions?: boolean
  providers?: ProviderInfo[]
  currentProvider?: string
  currentModel?: string
  autoFocus?: boolean
}

interface PendingAttachment extends ImageAttachment {
  /** Object URL for preview thumbnail */
  previewUrl: string
  id: string
}

export function ChatComposer({
  onSubmit,
  placeholder = 'Type a message...',
  disabled = false,
  running = false,
  onStop,
  showOptions = false,
  providers = [],
  currentProvider,
  currentModel,
  autoFocus = false,
}: ChatComposerProps) {
  const [value, setValue] = useState('')
  const [worktreeEnabled, setWorktreeEnabled] = useState(false)
  const [providerOverride, setProviderOverride] = useState<string | undefined>()
  const [modelOverride, setModelOverride] = useState<string | undefined>()
  const [focused, setFocused] = useState(false)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => { attachments.forEach(a => URL.revokeObjectURL(a.previewUrl)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addImageFile = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) return
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    const base64 = btoa(binary)
    const previewUrl = URL.createObjectURL(file)
    setAttachments(prev => [...prev, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      data: base64,
      mimeType: file.type,
      name: file.name,
      previewUrl,
    }])
  }

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const found = prev.find(a => a.id === id)
      if (found) URL.revokeObjectURL(found.previewUrl)
      return prev.filter(a => a.id !== id)
    })
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    // Synchronously collect image files BEFORE any await — React's synthetic
    // event is pooled and `preventDefault()` after await would be a no-op.
    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    // Process async after preventing default text paste
    void Promise.all(imageFiles.map(f => addImageFile(f)))
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer?.files
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file) await addImageFile(file)
    }
  }

  const handleSubmit = () => {
    const trimmed = value.trim()
    if ((!trimmed && attachments.length === 0) || disabled) return
    const options: CreateSessionOptions = {}
    if (worktreeEnabled) options.worktree = true
    if (providerOverride) options.provider = providerOverride
    if (modelOverride) options.model = modelOverride
    if (attachments.length > 0) {
      options.attachments = attachments.map(a => ({ data: a.data, mimeType: a.mimeType, name: a.name }))
    }
    onSubmit(trimmed || '(image)', Object.keys(options).length > 0 ? options : undefined)
    setValue('')
    attachments.forEach(a => URL.revokeObjectURL(a.previewUrl))
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const activeProvider = providerOverride ?? currentProvider
  const availableModels = providers.find(p => p.name === activeProvider)?.models ?? []
  const hasOverrides = providerOverride || modelOverride
  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled

  return (
    <TooltipProvider>
      <div className="px-6 py-4 border-t border-border glass-strong">
        <div
          className={cn(
            'relative rounded-xl border bg-surface-1/60 transition-all duration-200 max-w-3xl mx-auto',
            focused
              ? 'border-primary/40 shadow-[0_0_0_3px_oklch(0.68_0.18_265_/_0.10),0_8px_24px_-8px_oklch(0_0_0_/_0.4)]'
              : 'border-border hover:border-border-strong',
            dragOver && 'border-primary ring-2 ring-primary/30 bg-primary/5'
          )}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map(att => (
                <div
                  key={att.id}
                  className="group relative flex items-center gap-2 pl-1 pr-2 py-1 rounded-md border border-border bg-surface-2 max-w-xs"
                >
                  <img
                    src={att.previewUrl}
                    alt={att.name ?? 'pasted'}
                    className="h-9 w-9 rounded object-cover"
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[0.875rem] truncate text-foreground">{att.name ?? 'pasted image'}</span>
                    <span className="text-[0.6875rem] text-dim-foreground mono uppercase">{att.mimeType.replace('image/', '')}</span>
                  </div>
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {dragOver && attachments.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none rounded-xl bg-primary/5">
              <div className="flex items-center gap-2 text-primary text-[0.9375rem] font-medium">
                <ImageIcon className="h-4 w-4" />
                Drop image to attach
              </div>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => { setValue(e.target.value); handleInput() }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className={cn(
              'w-full bg-transparent px-4 pt-3 pb-1.5 text-[1rem] resize-none outline-none leading-[1.55]',
              'placeholder:text-dim-foreground',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = e.target.files
              if (!files) return
              for (let i = 0; i < files.length; i++) {
                const f = files[i]
                if (f) await addImageFile(f)
              }
              e.target.value = ''
            }}
          />

          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                  >
                    <Paperclip className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Attach image (or paste)</TooltipContent>
              </Tooltip>

              {showOptions && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setWorktreeEnabled(!worktreeEnabled)}
                        className={cn(
                          'flex items-center gap-1 h-7 px-2 rounded-md text-[0.875rem] transition-all',
                          worktreeEnabled
                            ? 'text-success bg-success/10 border border-success/25'
                            : 'text-muted-foreground hover:text-foreground hover:bg-surface-2 border border-transparent'
                        )}
                      >
                        <GitBranch className="h-3 w-3" />
                        {worktreeEnabled && <span className="font-medium">worktree</span>}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {worktreeEnabled ? 'Will run in isolated git worktree' : 'Enable git worktree isolation'}
                    </TooltipContent>
                  </Tooltip>

                  {providers.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            'flex items-center gap-1 h-7 px-2 rounded-md text-[0.875rem] transition-all',
                            hasOverrides
                              ? 'text-primary bg-primary/10 border border-primary/25'
                              : 'text-muted-foreground hover:text-foreground hover:bg-surface-2 border border-transparent'
                          )}
                        >
                          <Sliders className="h-3 w-3" />
                          {hasOverrides && (
                            <span className="font-medium mono">
                              {providerOverride ?? currentProvider}/{(modelOverride ?? currentModel ?? '').split('-').slice(0, 2).join('-')}
                            </span>
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80" align="start" sideOffset={8}>
                        <div className="space-y-3">
                          <div>
                            <div className="text-[0.9375rem] font-semibold mb-0.5">Session overrides</div>
                            <div className="text-[0.8125rem] text-muted-foreground">Use a different model just for this session</div>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Provider</Label>
                            <Select
                              value={providerOverride ?? '__current'}
                              onValueChange={(v) => {
                                setProviderOverride(v === '__current' ? undefined : v)
                                setModelOverride(undefined)
                              }}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__current">Default ({currentProvider})</SelectItem>
                                {providers.filter(p => p.hasCredentials).map(p => (
                                  <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Model</Label>
                            <Select
                              value={modelOverride ?? '__current'}
                              onValueChange={(v) => setModelOverride(v === '__current' ? undefined : v)}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__current">Default ({currentModel})</SelectItem>
                                {availableModels.map(m => (
                                  <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <Label htmlFor="wt-popover">Git worktree</Label>
                            <Switch id="wt-popover" checked={worktreeEnabled} onCheckedChange={setWorktreeEnabled} />
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="text-[0.8125rem] text-dim-foreground hidden sm:flex items-center gap-1">
                <kbd>↵</kbd>
                <span>send</span>
                <span className="opacity-50">·</span>
                <kbd>⇧↵</kbd>
                <span>new line</span>
              </div>
              {running && onStop ? (
                <button
                  onClick={onStop}
                  className="flex items-center justify-center h-7 w-7 rounded-md bg-warning/15 text-warning hover:bg-warning/25 transition-colors"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!canSend}
                  className={cn(
                    'flex items-center justify-center h-7 w-7 rounded-md transition-all',
                    canSend
                      ? 'gradient-primary text-primary-foreground shadow-sm hover:opacity-90 hover:scale-105'
                      : 'bg-surface-2 text-dim-foreground cursor-not-allowed'
                  )}
                >
                  {canSend ? <ArrowUp className="h-3.5 w-3.5" /> : <Sparkles className="h-3 w-3" />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
