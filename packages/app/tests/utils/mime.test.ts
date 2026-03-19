import { describe, it, expect } from 'bun:test'
import { getMimeType } from '../../src/utils/mime'

describe('getMimeType', () => {
  it.each([
    ['photo.png',         'image/png'],
    ['photo.jpg',         'image/jpeg'],
    ['photo.jpeg',        'image/jpeg'],
    ['anim.gif',          'image/gif'],
    ['img.webp',          'image/webp'],
    ['doc.pdf',           'application/pdf'],
    ['readme.txt',        'text/plain'],
    ['README.md',         'text/markdown'],
    ['config.json',       'application/json'],
    ['index.html',        'text/html'],
    ['data.csv',          'text/csv'],
  ])('returns correct MIME type for %s', (filename, expected) => {
    expect(getMimeType(filename)).toBe(expected)
  })

  it('returns octet-stream for unknown and missing extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream')
    expect(getMimeType('Makefile')).toBe('application/octet-stream')
  })

  it('handles uppercase extensions and multiple dots', () => {
    expect(getMimeType('PHOTO.PNG')).toBe('image/png')
    expect(getMimeType('/path/to/file.backup.json')).toBe('application/json')
  })
})
