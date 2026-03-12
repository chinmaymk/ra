export interface RouteResult {
  agentName: string
  message: string
}

export interface RouteError {
  error: string
}

export function isRouteError(r: RouteResult | RouteError): r is RouteError {
  return 'error' in r
}

export function parseRoute(
  input: string,
  agentNames: string[],
  defaultAgent: string | undefined,
): RouteResult | RouteError {
  const trimmed = input.trim()

  // Check for /agentName prefix
  if (trimmed.startsWith('/')) {
    const spaceIdx = trimmed.indexOf(' ')
    const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)
    const message = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim()

    if (agentNames.includes(name)) {
      if (!message) {
        return { error: `No message provided for agent "${name}". Usage: /${name} <message>` }
      }
      return { agentName: name, message }
    }

    // Unknown agent name
    return {
      error: `Unknown agent "${name}". Available agents: ${agentNames.join(', ')}`,
    }
  }

  // No prefix — route to default agent
  if (!defaultAgent) {
    return {
      error: `No default agent configured. Prefix your message with an agent name: ${agentNames.map(n => `/${n}`).join(', ')}`,
    }
  }

  return { agentName: defaultAgent, message: trimmed }
}
