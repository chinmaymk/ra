import { formatTokens } from '@/lib/utils'

interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  thinkingTokens: number
}

type Provider = 'anthropic' | 'openai'

interface CostDisplayProps {
  provider: string
  tokenUsage: TokenUsage
}

const PRICING: Record<Provider, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  anthropic: {
    input: 3,
    output: 15,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  openai: {
    input: 2.50,
    output: 10.00,
    cacheRead: 1.25,
    cacheWrite: 2.50,
  },
}

function computeCost(tokens: number, pricePerMillion: number): number {
  return (tokens / 1_000_000) * pricePerMillion
}

function formatCost(cost: number): string {
  if (cost < 0.005) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(3)}`
}

export function CostDisplay({ provider, tokenUsage }: CostDisplayProps) {
  const pricing = PRICING[provider as Provider]

  if (!pricing) {
    return (
      <div className="text-[11px] text-muted-foreground px-1">
        Cost data unavailable for provider <span className="mono">{provider}</span>
      </div>
    )
  }

  const inputCost = computeCost(tokenUsage.inputTokens, pricing.input)
  const outputCost = computeCost(tokenUsage.outputTokens, pricing.output)
  const cacheReadCost = computeCost(tokenUsage.cacheReadTokens, pricing.cacheRead)
  const cacheWriteCost = computeCost(tokenUsage.cacheCreationTokens, pricing.cacheWrite)
  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost

  return (
    <div className="space-y-4">
      {/* Total */}
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground">
          Total cost
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold mono tabular tracking-tight gradient-text">
            {formatCost(totalCost)}
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="space-y-2">
        <div className="text-[9px] uppercase tracking-[0.08em] font-semibold text-dim-foreground">Breakdown</div>
        <CostRow label="Input" tokens={tokenUsage.inputTokens} rate={pricing.input} cost={inputCost} />
        <CostRow label="Output" tokens={tokenUsage.outputTokens} rate={pricing.output} cost={outputCost} />
        <CostRow label="Cache reads" tokens={tokenUsage.cacheReadTokens} rate={pricing.cacheRead} cost={cacheReadCost} />
        <CostRow label="Cache writes" tokens={tokenUsage.cacheCreationTokens} rate={pricing.cacheWrite} cost={cacheWriteCost} />
      </div>

      {/* Rates */}
      <div className="space-y-2">
        <div className="text-[9px] uppercase tracking-[0.08em] font-semibold text-dim-foreground">
          Rates <span className="normal-case opacity-60">({provider})</span>
        </div>
        <div className="space-y-1">
          <RateRow label="Input" rate={pricing.input} />
          <RateRow label="Output" rate={pricing.output} />
          <RateRow label="Cache reads" rate={pricing.cacheRead} />
          <RateRow label="Cache writes" rate={pricing.cacheWrite} />
        </div>
      </div>
    </div>
  )
}

function CostRow({ label, tokens, cost }: { label: string; tokens: number; rate: number; cost: number }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>{label}</span>
        <span className="text-[9px] text-dim-foreground mono">{formatTokens(tokens)}</span>
      </div>
      <span className="mono tabular text-foreground">{formatCost(cost)}</span>
    </div>
  )
}

function RateRow({ label, rate }: { label: string; rate: number }) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="mono tabular text-dim-foreground">${rate.toFixed(2)}/M</span>
    </div>
  )
}
