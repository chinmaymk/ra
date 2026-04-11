import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { cn } from '@/lib/utils'
import { Check, Copy } from 'lucide-react'
import type { Components } from 'react-markdown'

interface MarkdownProps {
  content: string
  className?: string
}

function CopyButton({ text }: { text: string }) {
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
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

const components: Components = {
  pre({ children, ...props }) {
    // Extract the raw text from the code block for copy button
    let rawText = ''
    let language = ''

    // children is the <code> element
    const codeChild = Array.isArray(children) ? children[0] : children
    if (codeChild && typeof codeChild === 'object' && 'props' in codeChild) {
      const codeProps = codeChild.props as { children?: React.ReactNode; className?: string }
      // Extract language from className like "hljs language-typescript"
      const classNames = codeProps.className?.split(' ') ?? []
      const langClass = classNames.find(c => c.startsWith('language-'))
      language = langClass?.replace('language-', '') ?? ''

      // Get raw text
      const extractText = (node: React.ReactNode): string => {
        if (typeof node === 'string') return node
        if (Array.isArray(node)) return node.map(extractText).join('')
        if (node && typeof node === 'object' && 'props' in node) {
          return extractText((node.props as { children?: React.ReactNode }).children ?? '')
        }
        return ''
      }
      rawText = extractText(codeProps.children)
    }

    return (
      <div className="group/code relative my-3 rounded-lg border border-border overflow-hidden bg-surface-0/60">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface-1/40">
          <span className="text-[0.8125rem] mono text-dim-foreground uppercase tracking-wider">
            {language || 'code'}
          </span>
          <CopyButton text={rawText} />
        </div>
        <pre {...props} className="!bg-transparent !m-0 !rounded-none !border-0 px-4 py-3 overflow-x-auto">
          {children}
        </pre>
      </div>
    )
  },

  code({ children, className, ...props }) {
    // Inline code (no language class from highlight)
    const isBlock = className?.includes('hljs') || className?.includes('language-')
    if (isBlock) {
      return <code className={className} {...props}>{children}</code>
    }
    return (
      <code className="px-1.5 py-0.5 rounded-md bg-surface-2 border border-border text-[0.9em] mono text-primary-bright" {...props}>
        {children}
      </code>
    )
  },

  a({ children, href, ...props }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary-bright underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors"
        {...props}
      >
        {children}
      </a>
    )
  },

  table({ children, ...props }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[1rem]" {...props}>{children}</table>
      </div>
    )
  },

  thead({ children, ...props }) {
    return <thead className="bg-surface-1/60 border-b border-border" {...props}>{children}</thead>
  },

  th({ children, ...props }) {
    return (
      <th className="px-3 py-2 text-left text-[0.875rem] font-semibold uppercase tracking-wider text-muted-foreground" {...props}>
        {children}
      </th>
    )
  },

  td({ children, ...props }) {
    return <td className="px-3 py-2 border-t border-border" {...props}>{children}</td>
  },

  blockquote({ children, ...props }) {
    return (
      <blockquote className="my-3 pl-4 border-l-2 border-primary/30 text-muted-foreground italic" {...props}>
        {children}
      </blockquote>
    )
  },

  hr({ ...props }) {
    return <hr className="my-5 border-border" {...props} />
  },

  img({ src, alt, ...props }) {
    return (
      <img
        src={src}
        alt={alt}
        className="my-3 max-w-full rounded-lg border border-border"
        loading="lazy"
        {...props}
      />
    )
  },

  ul({ children, className, ...props }) {
    const isTaskList = className?.includes('contains-task-list')
    return (
      <ul
        className={cn(
          'my-2 pl-6',
          isTaskList ? 'list-none !pl-2 space-y-1' : 'list-disc space-y-1 marker:text-dim-foreground'
        )}
        {...props}
      >
        {children}
      </ul>
    )
  },

  ol({ children, className, ...props }) {
    const isTaskList = className?.includes('contains-task-list')
    return (
      <ol
        className={cn(
          'my-2 pl-6',
          isTaskList ? 'list-none !pl-2 space-y-1' : 'list-decimal space-y-1 marker:text-dim-foreground'
        )}
        {...props}
      >
        {children}
      </ol>
    )
  },

  li({ children, className, ...props }) {
    const isTask = className?.includes('task-list-item')
    return (
      <li
        className={cn(
          'leading-relaxed',
          isTask && 'flex items-start gap-1 list-none'
        )}
        {...props}
      >
        {children}
      </li>
    )
  },

  input({ checked, ...props }) {
    return (
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="mr-2 h-3.5 w-3.5 rounded border-border accent-primary"
        {...props}
      />
    )
  },
}

export const Markdown = memo(function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn('markdown-prose', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
