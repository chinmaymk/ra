async function fetchUrl(input: unknown) {
  const { url } = input as { url: string }
  return `fetched: ${url}`
}

export default {
  description: 'Tool whose name is inferred from the execute function name',
  inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  execute: fetchUrl,
}
