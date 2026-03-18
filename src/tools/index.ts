import type { ToolRegistry } from '../agent/tool-registry'
import type { ToolsConfig, ToolSettings } from '../config/types'
import type { ITool } from '../providers/types'
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

/** Check whether a tool is enabled given the tools config. */
function isEnabled(toolName: string, config: ToolsConfig): boolean {
  const override = config.overrides[toolName]
  if (override?.enabled === false) return false
  return config.builtin
}

/** Get per-tool settings (empty object when no overrides). */
function settingsFor(toolName: string, config: ToolsConfig): ToolSettings {
  return config.overrides[toolName] ?? {}
}

/** Conditionally register a tool if enabled. */
function maybeRegister(registry: ToolRegistry, tool: ITool, config: ToolsConfig): void {
  if (isEnabled(tool.name, config)) registry.register(tool)
}

/** Extract rootDir from tool settings (shared across filesystem tools). */
function rootDirFrom(s: ToolSettings): { rootDir?: string } {
  const rootDir = s.rootDir as string | undefined
  return rootDir ? { rootDir } : {}
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
    const settings = settingsFor(name, cfg)
    maybeRegister(registry, fsFactories[name]!(rootDirFrom(settings)), cfg)
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
