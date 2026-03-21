import type { ToolRegistry, ITool } from '@chinmaymk/ra'
import type { ToolsConfig } from '../config/types'
import { readFileTool } from './read-file'
import { writeFileTool } from './write-file'
import { updateFileTool } from './update-file'
import { appendFileTool } from './append-file'
import { listDirectoryTool } from './list-directory'
import { searchFilesTool } from './search-files'
import { globFilesTool } from './glob-files'
import { moveFileTool } from './move-file'
import { copyFileTool } from './copy-file'
import { deleteFileTool } from './delete-file'
import { executeBashTool, executePowershellTool } from './shell-exec'
import { webFetchTool } from './web-fetch'
import { subagentTool, type SubagentToolOptions } from './subagent'

export { subagentTool, type SubagentToolOptions } from './subagent'
export { managedAgentTools, type ManagedAgentOptions } from './managed-agents'

/** Conditionally register a tool if enabled in config. */
function maybeRegister(registry: ToolRegistry, tool: ITool, config: ToolsConfig): void {
  if (config.overrides[tool.name]?.enabled === false || !config.builtin) return
  registry.register(tool)
}

export function registerBuiltinTools(registry: ToolRegistry, config?: ToolsConfig): void {
  const cfg: ToolsConfig = config ?? { builtin: true, overrides: {} }

  // Filesystem — file tools accept optional rootDir constraint
  const fsNames = ['Read', 'Write', 'Edit', 'AppendFile', 'LS', 'Grep', 'Glob', 'MoveFile', 'CopyFile', 'DeleteFile'] as const
  const fsFactories: Record<string, (opts: { rootDir?: string }) => ITool> = {
    Read:       (o) => readFileTool(o),
    Write:      (o) => writeFileTool(o),
    Edit:       (o) => updateFileTool(o),
    AppendFile: (o) => appendFileTool(o),
    LS:         (o) => listDirectoryTool(o),
    Grep:       (o) => searchFilesTool(o),
    Glob:       (o) => globFilesTool(o),
    MoveFile:   (o) => moveFileTool(o),
    CopyFile:   (o) => copyFileTool(o),
    DeleteFile: (o) => deleteFileTool(o),
  }

  for (const name of fsNames) {
    const rootDir = cfg.overrides[name]?.rootDir as string | undefined
    maybeRegister(registry, fsFactories[name]!(rootDir ? { rootDir } : {}), cfg)
  }

  // Shell — platform-specific
  if (process.platform === 'win32') {
    maybeRegister(registry, executePowershellTool(), cfg)
  } else {
    maybeRegister(registry, executeBashTool(), cfg)
  }

  // Network
  maybeRegister(registry, webFetchTool(), cfg)
}
