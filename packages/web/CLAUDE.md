# packages/web

`ra-web` — the React + Vite dashboard served by `ra web`. Not published; built into `dist/` and statically served by `WebServer` in `packages/app/src/interfaces/web.ts`.

## Stack

- React 19 + TypeScript, bundled by Vite
- Tailwind v4 (`@tailwindcss/vite`) + Radix UI primitives + shadcn-style components in `src/components/ui`
- `lucide-react` icons, `react-markdown` + `highlight.js` for assistant output, `sonner` for toasts, `cmdk` for the command palette

## Build

```bash
cd packages/web && bun install && bun run build   # → packages/web/dist
bun run dev                                        # Vite dev server, proxies /api to ra web
```

The app binary looks for a pre-built `packages/web/dist` at runtime (see `launchWeb` in `packages/app/src/index.ts`). If it's missing, `ra web` logs a hint to build it or run Vite dev.

## Layout

```
src/
  App.tsx              # top-level view router (agents / queue / detail / config / tools / ...)
  main.tsx             # React entry
  components/
    layout/Sidebar.tsx # persistent nav + session list
    session/           # message rendering, tool call cards, composer wiring
    ui/                # shadcn-style primitives
    ChatComposer.tsx   # textarea + attachment + send
    CommandPalette.tsx # Cmd+K palette
    Markdown.tsx       # streamed markdown + code highlighting
  pages/
    AgentsView.tsx     # dashboard home: sessions + new-session form
    SessionDetail.tsx  # live conversation view for one session
    QueueView.tsx      # "needs-input" inbox (Cmd+I)
    ConfigPage.tsx     # /api/config editor
    ToolsPage.tsx      # /api/tools browser
    MiddlewarePage.tsx # /api/middleware browser
    PromptsPage.tsx    # skills / prompts browser
    KnowledgePage.tsx  # knowledge base browser
    TerminalPage.tsx   # /api/terminal interactive shell
  hooks/
    useSessionList.ts  # polls /api/sessions, derives needs-input queue
    useSession.ts      # subscribes to /api/sessions/:id/events SSE stream
    useKeyboardShortcut.ts
    useTheme.ts
  lib/
    api.ts             # typed fetch wrapper for all /api/* endpoints
    types.ts           # SessionInfo, Message, ToolInfo, ... (mirrors backend)
    resolveMessages.ts # merges persisted + streaming deltas into a stable timeline
    utils.ts
```

## Talking to the backend

Every network call goes through `lib/api.ts`, which targets `/api/*` relative to the page origin. In dev, Vite proxies to the local `ra web` server; in prod, the same origin serves both the SPA and the API. The route table lives in `packages/app/src/interfaces/web.ts` — keep `lib/types.ts` in sync with `SessionManager` and the `/api/*` handlers there.

Live session updates use SSE via `hooks/useSession.ts` subscribing to `/api/sessions/:id/events`. The composer posts to `/api/sessions/:id/messages`; stop/delete hit their respective endpoints. Terminal pages use `/api/terminal/:id/stream` (SSE) + `/stdin` + `/kill`.

## Conventions

- Named exports, no default exports (matches the rest of the monorepo).
- `@/` path alias → `src/` (configured in `tsconfig.json` + `vite.config.ts`).
- Tailwind utility-first; prefer composing existing `components/ui` primitives over hand-rolled markup.
- Keep view state in `App.tsx`'s discriminated `View` union; pages are dumb and take callbacks.
- When adding a new page: register it in the `View` union + `NavTarget`, add a `Sidebar` entry, and wire it into the `App.tsx` switch.
