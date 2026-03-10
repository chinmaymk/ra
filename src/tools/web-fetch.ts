import type { ITool } from '../providers/types'

export function webFetchTool(): ITool {
  return {
    name: 'web_fetch',
    description:
      'Make an HTTP request. Returns JSON: {"status": number, "headers": {}, "body": "response text"}.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to request' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'Request headers, e.g. {"Authorization": "Bearer token"}' },
        body: { type: 'string', description: 'Request body string' },
      },
      required: ['url'],
    },
    async execute(input: unknown) {
      const { url, method = 'GET', headers, body } = input as {
        url: string; method?: string; headers?: Record<string, string>; body?: string
      }
      const resp = await fetch(url, {
        method,
        headers,
        body: body ?? undefined,
      })
      const respBody = await resp.text()
      const respHeaders: Record<string, string> = {}
      resp.headers.forEach((v, k) => { respHeaders[k] = v })
      return JSON.stringify({ status: resp.status, headers: respHeaders, body: respBody })
    },
  }
}
