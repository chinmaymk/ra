import { cn } from '@/lib/utils'
import type { SessionStatus } from '@/lib/types'

const COLORS: Record<SessionStatus, string> = {
  'running': 'bg-status-running',
  'needs-input': 'bg-status-waiting',
  'error': 'bg-status-error',
  'done': 'bg-status-done',
  'idle': 'bg-status-idle',
}

const LABELS: Record<SessionStatus, string> = {
  'running': 'Running',
  'needs-input': 'Needs input',
  'error': 'Error',
  'done': 'Done',
  'idle': 'Idle',
}

export function StatusDot({
  status,
  size = 'md',
  animated = true,
}: {
  status: SessionStatus
  size?: 'sm' | 'md' | 'lg'
  animated?: boolean
}) {
  const sizeCls =
    size === 'sm' ? 'h-1.5 w-1.5' :
    size === 'lg' ? 'h-2.5 w-2.5' :
    'h-2 w-2'

  const showRing = animated && (status === 'running' || status === 'needs-input')

  return (
    <span className="relative inline-flex shrink-0" title={LABELS[status]}>
      {showRing && (
        <span className={cn(
          'absolute inline-flex h-full w-full rounded-full opacity-60',
          COLORS[status],
          'pulse-ring'
        )} />
      )}
      <span className={cn(
        'relative inline-flex rounded-full',
        sizeCls,
        COLORS[status],
        animated && status === 'running' && 'shadow-[0_0_8px_oklch(0.72_0.16_240/0.6)]',
        animated && status === 'needs-input' && 'shadow-[0_0_8px_oklch(0.70_0.21_25/0.6)]'
      )} />
    </span>
  )
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const className = {
    'running': 'bg-status-running/10 text-status-running border-status-running/25',
    'needs-input': 'bg-status-waiting/10 text-status-waiting border-status-waiting/25',
    'error': 'bg-status-error/10 text-status-error border-status-error/25',
    'done': 'bg-status-done/10 text-status-done border-status-done/25',
    'idle': 'bg-surface-2 text-dim-foreground border-border',
    'queued': 'bg-status-queued/10 text-status-queued border-status-queued/25',
  }[status]

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-md border px-1.5 h-[18px] text-[0.6875rem] font-semibold uppercase tracking-[0.06em]',
      className
    )}>
      <StatusDot status={status} size="sm" animated={false} />
      {LABELS[status]}
    </span>
  )
}
