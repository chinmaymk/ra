export const description = 'A tool defined with named exports'

export const parameters = {
  query: { type: 'string' as const, description: 'Search query' },
  limit: { type: 'number' as const, description: 'Max results', optional: true },
}

export default async function search(input: unknown) {
  const { query, limit } = input as { query: string; limit?: number }
  return `query=${query}, limit=${limit ?? 'none'}`
}
