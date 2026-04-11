import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface SvgPreviewProps {
  svg: string
}

function CopySvgButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded text-[0.8125rem] font-medium text-dim-foreground hover:text-foreground hover:bg-surface-3 transition-colors"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-success" />
          <span className="text-success">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>Copy SVG</span>
        </>
      )}
    </button>
  )
}

export function SvgPreview({ svg }: SvgPreviewProps) {
  return (
    <div className="rounded-lg border border-border overflow-hidden bg-surface-0/60">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface-1/40">
        <span className="text-[0.8125rem] mono text-dim-foreground uppercase tracking-wider">
          SVG
        </span>
        <CopySvgButton text={svg} />
      </div>
      <div className="flex items-center justify-center p-4">
        <div
          className="w-[400px] h-[400px] bg-white rounded-md flex items-center justify-center overflow-hidden"
          dangerouslySetInnerHTML={{ __html: svg.replace(/<svg/, '<svg style="max-width:100%;max-height:100%;width:100%;height:100%"') }}
        />
      </div>
    </div>
  )
}
