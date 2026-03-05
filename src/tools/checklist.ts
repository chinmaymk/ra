import type { ITool } from '../providers/types'

interface ChecklistItem {
  text: string
  checked: boolean
}

export function checklistTool(): ITool {
  const items: ChecklistItem[] = []

  const remaining = () => items.filter(i => !i.checked).length

  return {
    name: 'checklist',
    get description() {
      const base = 'Manage a task checklist. Actions: "add" (requires item), "check"/"uncheck"/"remove" (require index), "list".'
      if (items.length === 0) return base
      const unchecked = items
        .map((it, i) => ({ ...it, i }))
        .filter(it => !it.checked)
        .map(it => `${it.i}: ${it.text}`)
        .join(', ')
      return `${base} Remaining (${remaining()}/${items.length}): ${unchecked}`
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'check', 'uncheck', 'remove', 'list'], description: 'Action to perform' },
        item: { type: 'string', description: 'Task text (required for "add")' },
        index: { type: 'number', description: '0-based item index (required for "check", "uncheck", "remove")' },
      },
      required: ['action'],
    },
    async execute(input: unknown) {
      const { action, item, index } = input as {
        action: string; item?: string; index?: number
      }

      switch (action) {
        case 'add': {
          if (!item) throw new Error('Item text is required for "add" action')
          items.push({ text: item, checked: false })
          return `Added: ${item} | ${remaining()} remaining`
        }
        case 'check': {
          if (index === undefined || index < 0 || index >= items.length) throw new Error(`Invalid index: ${index}`)
          items[index]!.checked = true
          return `Checked: ${items[index]!.text} | ${remaining()} remaining`
        }
        case 'uncheck': {
          if (index === undefined || index < 0 || index >= items.length) throw new Error(`Invalid index: ${index}`)
          items[index]!.checked = false
          return `Unchecked: ${items[index]!.text} | ${remaining()} remaining`
        }
        case 'remove': {
          if (index === undefined || index < 0 || index >= items.length) throw new Error(`Invalid index: ${index}`)
          const removed = items.splice(index, 1)[0]!
          return `Removed: ${removed.text} | ${remaining()} remaining`
        }
        case 'list': {
          if (items.length === 0) return 'Checklist is empty.'
          const lines = items.map((it, i) => `${i}: ${it.checked ? '[x]' : '[ ]'} ${it.text}`)
          return `${lines.join('\n')}\n${remaining()} of ${items.length} remaining`
        }
        default:
          throw new Error(`Unknown action: ${action}`)
      }
    },
  }
}
