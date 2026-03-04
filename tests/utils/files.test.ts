import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { fileToContentPart } from '../../src/utils/files'
import { mkdirSync, writeFileSync, rmSync } from 'fs'

const TEST_DIR = '/tmp/ra-files-test'

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }))
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }))

describe('fileToContentPart', () => {
  it('returns image content part for .png file', async () => {
    const p = `${TEST_DIR}/test.png`
    // Write a minimal 1x1 PNG
    const pngData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    writeFileSync(p, pngData)

    const part = await fileToContentPart(p)
    expect(part.type).toBe('image')
    if (part.type === 'image') {
      expect(part.source.type).toBe('base64')
      if (part.source.type === 'base64') {
        expect(part.source.mediaType).toBe('image/png')
        expect(part.source.data).toBeTruthy()
      }
    }
  })

  it('returns image content part for .jpg file', async () => {
    const p = `${TEST_DIR}/test.jpg`
    writeFileSync(p, Buffer.from([0xFF, 0xD8, 0xFF]))

    const part = await fileToContentPart(p)
    expect(part.type).toBe('image')
  })

  it('returns file content part for .txt file', async () => {
    const p = `${TEST_DIR}/test.txt`
    writeFileSync(p, 'hello world')

    const part = await fileToContentPart(p)
    expect(part.type).toBe('file')
    if (part.type === 'file') {
      expect(part.mimeType).toBe('text/plain')
      expect(part.data).toBeDefined()
    }
  })

  it('returns file content part for .json file', async () => {
    const p = `${TEST_DIR}/test.json`
    writeFileSync(p, '{"key": "value"}')

    const part = await fileToContentPart(p)
    expect(part.type).toBe('file')
    if (part.type === 'file') {
      expect(part.mimeType).toBe('application/json')
    }
  })

  it('returns file content part for .pdf file', async () => {
    const p = `${TEST_DIR}/test.pdf`
    writeFileSync(p, '%PDF-1.4 fake pdf content')

    const part = await fileToContentPart(p)
    expect(part.type).toBe('file')
    if (part.type === 'file') {
      expect(part.mimeType).toBe('application/pdf')
    }
  })

  it('returns file content part for unknown extension', async () => {
    const p = `${TEST_DIR}/test.xyz`
    writeFileSync(p, 'binary data')

    const part = await fileToContentPart(p)
    expect(part.type).toBe('file')
    if (part.type === 'file') {
      expect(part.mimeType).toBe('application/octet-stream')
    }
  })

  it('base64 encodes image data correctly', async () => {
    const p = `${TEST_DIR}/test.gif`
    const gifBytes = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    writeFileSync(p, gifBytes)

    const part = await fileToContentPart(p)
    expect(part.type).toBe('image')
    if (part.type === 'image' && part.source.type === 'base64') {
      const decoded = Buffer.from(part.source.data, 'base64')
      expect(decoded).toEqual(gifBytes)
    }
  })
})
