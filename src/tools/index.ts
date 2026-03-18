import type { ToolRegistry } from '../agent/tool-registry'
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

export function registerBuiltinTools(registry: ToolRegistry): void {
  // Filesystem
  registry.register(readFileTool())
  registry.register(writeFileTool())
  registry.register(updateFileTool())
  registry.register(appendFileTool())
  registry.register(listDirectoryTool())
  registry.register(searchFilesTool())
  registry.register(globFilesTool())
  registry.register(moveFileTool())
  registry.register(copyFileTool())
  registry.register(deleteFileTool())

  // Shell — platform-specific
  if (process.platform === 'win32') {
    registry.register(executePowershellTool())
  } else {
    registry.register(executeBashTool())
  }

  // Network
  registry.register(webFetchTool())
}
