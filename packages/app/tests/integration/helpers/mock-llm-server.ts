export type MockResponse =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'error'; status: number; message: string }

export interface RecordedRequest {
  path: string
  body: unknown
  provider: 'anthropic' | 'openai' | 'google' | 'unknown'
}

export interface MockLLMServer {
  port: number
  anthropicBaseURL: string
  openaiBaseURL: string
  googleBaseURL: string
  /** Queue responses — consumed in order per request */
  enqueue(responses: MockResponse[]): void
  /** All requests received since start or last reset */
  requests(): RecordedRequest[]
  /** Clear request log */
  resetRequests(): void
  stop(): Promise<void>
}

function sseAnthropicText(content: string, inputTokens = 10): string {
  const lines: string[] = []
  const send = (event: string, data: unknown) =>
    lines.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n`)

  send('message_start', { type: 'message_start', message: { usage: { input_tokens: inputTokens } } })
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } })
  send('content_block_stop', { type: 'content_block_stop', index: 0 })
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })
  send('message_stop', { type: 'message_stop' })

  return lines.join('\n') + '\n'
}

function sseAnthropicToolCall(name: string, args: Record<string, unknown>, inputTokens = 10): string {
  const lines: string[] = []
  const send = (event: string, data: unknown) =>
    lines.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n`)

  send('message_start', { type: 'message_start', message: { usage: { input_tokens: inputTokens } } })
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${name}`, name } })
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } })
  send('content_block_stop', { type: 'content_block_stop', index: 0 })
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } })
  send('message_stop', { type: 'message_stop' })

  return lines.join('\n') + '\n'
}

function sseOpenAICompletionsText(content: string): string {
  const id = 'chatcmpl-mock'
  const chunks = [
    JSON.stringify({ id, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] }),
    JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    '[DONE]',
  ]
  return chunks.map(c => `data: ${c}\n\n`).join('')
}

function sseOpenAICompletionsToolCall(name: string, args: Record<string, unknown>): string {
  const id = 'chatcmpl-mock'
  const callId = `call_${name}`
  const chunks = [
    JSON.stringify({ id, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: callId, type: 'function', function: { name, arguments: '' } }] }, finish_reason: null }] }),
    JSON.stringify({ id, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }, finish_reason: null }] }),
    JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 20 } }),
    '[DONE]',
  ]
  return chunks.map(c => `data: ${c}\n\n`).join('')
}

function sseOpenAIResponsesText(content: string): string {
  const respId = 'resp_mock'
  const itemId = 'item_0'
  const events = [
    { type: 'response.created', response: { id: respId, status: 'in_progress', output: [] }, sequence_number: 0 },
    { type: 'response.output_item.added', item: { type: 'message', id: itemId, role: 'assistant', content: [] }, output_index: 0, sequence_number: 1 },
    { type: 'response.content_part.added', item_id: itemId, content_index: 0, part: { type: 'output_text', text: '' }, output_index: 0, sequence_number: 2 },
    { type: 'response.output_text.delta', item_id: itemId, content_index: 0, output_index: 0, delta: content, sequence_number: 3 },
    { type: 'response.output_text.done', item_id: itemId, content_index: 0, output_index: 0, text: content, sequence_number: 4 },
    { type: 'response.content_part.done', item_id: itemId, content_index: 0, output_index: 0, part: { type: 'output_text', text: content }, sequence_number: 5 },
    { type: 'response.output_item.done', item: { type: 'message', id: itemId, role: 'assistant', content: [{ type: 'output_text', text: content }] }, output_index: 0, sequence_number: 6 },
    { type: 'response.completed', response: { id: respId, status: 'completed', output: [{ type: 'message', id: itemId, role: 'assistant', content: [{ type: 'output_text', text: content }] }], output_text: content, usage: { input_tokens: 10, output_tokens: 5 } }, sequence_number: 7 },
  ]
  return events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

function sseOpenAIResponsesToolCall(name: string, args: Record<string, unknown>): string {
  const respId = 'resp_mock'
  const itemId = 'item_0'
  const callId = `call_${name}`
  const argsStr = JSON.stringify(args)
  const events = [
    { type: 'response.created', response: { id: respId, status: 'in_progress', output: [] }, sequence_number: 0 },
    { type: 'response.output_item.added', item: { type: 'function_call', id: itemId, call_id: callId, name, arguments: '' }, item_id: itemId, output_index: 0, sequence_number: 1 },
    { type: 'response.function_call_arguments.delta', item_id: itemId, delta: argsStr, output_index: 0, sequence_number: 2 },
    { type: 'response.function_call_arguments.done', item_id: itemId, name, arguments: argsStr, output_index: 0, sequence_number: 3 },
    { type: 'response.output_item.done', item: { type: 'function_call', id: itemId, call_id: callId, name, arguments: argsStr }, output_index: 0, sequence_number: 4 },
    { type: 'response.completed', response: { id: respId, status: 'completed', output: [{ type: 'function_call', id: itemId, call_id: callId, name, arguments: argsStr }], output_text: '', usage: { input_tokens: 10, output_tokens: 20 } }, sequence_number: 5 },
  ]
  return events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

function sseGoogleText(content: string): string {
  const events = [
    { candidates: [{ content: { parts: [{ text: content }], role: 'model' }, index: 0 }] },
    { candidates: [{ content: { parts: [{ text: '' }], role: 'model' }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } },
  ]
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')
}

function sseGoogleToolCall(name: string, args: Record<string, unknown>): string {
  const event = { candidates: [{ content: { parts: [{ functionCall: { name, args } }], role: 'model' }, finishReason: 'STOP', index: 0 }] }
  return `data: ${JSON.stringify(event)}\n\n`
}

export async function startMockLLMServer(): Promise<MockLLMServer> {
  const queue: MockResponse[] = []
  const recorded: RecordedRequest[] = []

  const server = Bun.serve({
    port: 0, // random port
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      const path = url.pathname
      let body: unknown = null
      try { body = await req.json() } catch { /* no body */ }

      let provider: RecordedRequest['provider'] = 'unknown'
      const isResponsesAPI = path.includes('/responses')
      if (path.startsWith('/anthropic')) provider = 'anthropic'
      else if (path.startsWith('/openai') || path.includes('/chat/completions') || isResponsesAPI) provider = 'openai'
      else if (path.includes('generateContent')) provider = 'google'

      recorded.push({ path, body, provider })

      const response = queue.shift()
      if (!response) {
        return new Response(JSON.stringify({ error: 'No mock response queued' }), { status: 500 })
      }

      if (response.type === 'error') {
        return new Response(JSON.stringify({ error: response.message }), { status: response.status })
      }

      const isStreaming = (body as any)?.stream === true

      // Estimate input tokens from request body size (more realistic than hardcoded 10)
      const inputTokens = body ? Math.ceil(JSON.stringify(body).length / 4) : 10

      // For non-streaming Anthropic requests (e.g. compaction via provider.chat()), return JSON
      if (provider === 'anthropic' && !isStreaming) {
        const content = response.type === 'text'
          ? [{ type: 'text', text: response.content }]
          : [{ type: 'tool_use', id: `toolu_${(response as any).name}`, name: (response as any).name, input: (response as any).args }]
        return new Response(JSON.stringify({
          id: 'msg_mock', type: 'message', role: 'assistant', content,
          model: 'claude-mock',
          stop_reason: response.type === 'text' ? 'end_turn' : 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: 5 },
        }), { headers: { 'Content-Type': 'application/json' } })
      }

      let sseBody: string
      if (provider === 'anthropic') {
        sseBody = response.type === 'text'
          ? sseAnthropicText(response.content, inputTokens)
          : sseAnthropicToolCall((response as any).name, (response as any).args, inputTokens)
      } else if (provider === 'openai' && isResponsesAPI) {
        sseBody = response.type === 'text'
          ? sseOpenAIResponsesText(response.content)
          : sseOpenAIResponsesToolCall((response as any).name, (response as any).args)
      } else if (provider === 'openai') {
        sseBody = response.type === 'text'
          ? sseOpenAICompletionsText(response.content)
          : sseOpenAICompletionsToolCall((response as any).name, (response as any).args)
      } else {
        // Google
        sseBody = response.type === 'text'
          ? sseGoogleText(response.content)
          : sseGoogleToolCall((response as any).name, (response as any).args)
      }

      return new Response(sseBody, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    },
  })

  const port = server.port as number
  const base = `http://127.0.0.1:${port}`

  return {
    port,
    anthropicBaseURL: `${base}/anthropic`,
    openaiBaseURL: `${base}/openai`,
    googleBaseURL: `${base}/google`,
    enqueue(responses: MockResponse[]) { queue.push(...responses) },
    requests() { return [...recorded] },
    resetRequests() { recorded.length = 0 },
    async stop() { await server.stop(true) },
  }
}
