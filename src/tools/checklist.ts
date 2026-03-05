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
      const base = 'Track tasks with a checklist. ' +
        'Actions: "add" (item text), "check"/"uncheck"/"remove" (by 0-based index), "list" (show all).'
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
        action: { type: 'string', enum: ['add', 'check', 'uncheck', 'remove', 'list'], description: 'The action to perform' },
        item: { type: 'string', description: 'Item text (for "add" action)' },
        index: { type: 'number', description: 'Item index, 0-based (for "check", "uncheck", "remove" actions)' },
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
