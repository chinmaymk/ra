import type { ITool } from '../providers/types'

export function webFetchTool(): ITool {
  return {
    name: 'web_fetch',
    description:
      'Make an HTTP request to a URL and return the response. ' +
      'Returns a JSON object with `status` (HTTP status code), `headers` (response headers), and `body` (response body as text). ' +
      'Supports GET, POST, PUT, PATCH, DELETE methods. Default method is GET. ' +
      'Use `headers` to set request headers (e.g. Authorization, Content-Type). ' +
      'Use `body` to send a request body (for POST/PUT/PATCH).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        method: { type: 'string', description: 'HTTP method: GET, POST, PUT, PATCH, DELETE. Default: GET.' },
        headers: { type: 'object', description: 'Request headers as key-value pairs. Optional.' },
        body: { type: 'string', description: 'Request body string. Optional.' },
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
