import type { IMessage } from './types'

export function extractSystemMessages(messages: IMessage[]): { system: string | undefined; filtered: IMessage[] } {
  const systemParts: string[] = []
  const filtered: IMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join(''))
    } else {
      filtered.push(msg)
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n') : undefined,
    filtered,
  }
}
