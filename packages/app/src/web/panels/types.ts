import type { Logger } from '@chinmaymk/ra'
import type { ManagedSession, SessionManager } from '../session-manager'

/**
 * Context for a web panel HTTP handler. Panel modules run only in ra-app (Bun).
 */
export interface WebPanelRequestContext {
  session: ManagedSession
  sessions: SessionManager
  /** Path after `/api/sessions/:id/panels/:panelId`, starts with `/` or empty */
  subpath: string
  logger: Logger
}

/**
 * A web panel: metadata plus optional HTTP handling under the session panels API.
 * Default-export from a panel file listed in `agent.web.panels`.
 */
export interface WebPanelDefinition {
  id: string
  title: string
  /** `builtin` | absolute path to the loaded module */
  source: string
  /**
   * Handle HTTP for this panel. Return null to fall through to 404.
   * Only methods the panel supports need to return a Response.
   */
  handleRequest?(req: Request, ctx: WebPanelRequestContext): Promise<Response | null>
}
