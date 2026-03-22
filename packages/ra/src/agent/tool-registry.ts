import type { ITool, ToolExecuteOptions } from '../providers/types'

export class ToolRegistry {
  private tools = new Map<string, ITool>()

  register(tool: ITool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ITool | undefined {
    return this.tools.get(name)
  }

  all(): ITool[] {
    return Array.from(this.tools.values())
  }

  async execute(name: string, input: unknown, options?: ToolExecuteOptions): Promise<unknown> {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`Tool not found: ${name}`)
    }
    return tool.execute(input, options)
  }
}
