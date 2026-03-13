import { describe, it, expect } from 'bun:test'
import { parseArgs } from '../../src/interfaces/parse-args'

function dev(...args: string[]): string[] {
  return ['bun', 'src/index.ts', ...args]
}

function bin(...args: string[]): string[] {
  return ['/usr/local/bin/ra', ...args]
}

describe('parseArgs — bundle subcommand', () => {
  it('parses ra bundle --output ./my-agent', () => {
    const result = parseArgs(dev('bundle', '--output', './my-agent'))
    expect(result.meta.bundleCommand).toBeDefined()
    expect(result.meta.bundleCommand!.output).toBe('./my-agent')
  })

  it('parses -o shorthand', () => {
    const result = parseArgs(dev('bundle', '-o', './my-agent'))
    expect(result.meta.bundleCommand!.output).toBe('./my-agent')
  })

  it('parses --config flag', () => {
    const result = parseArgs(dev('bundle', '-o', './agent', '--config', './ra.config.yaml'))
    expect(result.meta.bundleCommand!.output).toBe('./agent')
    expect(result.meta.bundleCommand!.configPath).toBe('./ra.config.yaml')
  })

  it('parses --name flag', () => {
    const result = parseArgs(dev('bundle', '-o', './agent', '--name', 'review-bot'))
    expect(result.meta.bundleCommand!.output).toBe('./agent')
    expect(result.meta.bundleCommand!.name).toBe('review-bot')
  })

  it('sets help when --output is missing', () => {
    const result = parseArgs(dev('bundle'))
    expect(result.meta.help).toBe(true)
    expect(result.meta.bundleCommand).toBeDefined()
  })

  it('sets help with bundle --help', () => {
    const result = parseArgs(dev('bundle', '--help'))
    expect(result.meta.help).toBe(true)
  })

  it('works from compiled binary', () => {
    const result = parseArgs(bin('bundle', '-o', './my-agent'))
    expect(result.meta.bundleCommand!.output).toBe('./my-agent')
  })
})
