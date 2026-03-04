import { describe, it, expect } from 'bun:test'
import { getMimeType } from '../../src/utils/mime'

describe('getMimeType', () => {
  it('returns image/png for .png', () => {
    expect(getMimeType('photo.png')).toBe('image/png')
  })

  it('returns image/jpeg for .jpg', () => {
    expect(getMimeType('photo.jpg')).toBe('image/jpeg')
  })

  it('returns image/jpeg for .jpeg', () => {
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg')
  })

  it('returns image/gif for .gif', () => {
    expect(getMimeType('anim.gif')).toBe('image/gif')
  })

  it('returns image/webp for .webp', () => {
    expect(getMimeType('img.webp')).toBe('image/webp')
  })

  it('returns application/pdf for .pdf', () => {
    expect(getMimeType('doc.pdf')).toBe('application/pdf')
  })

  it('returns text/plain for .txt', () => {
    expect(getMimeType('readme.txt')).toBe('text/plain')
  })

  it('returns text/markdown for .md', () => {
    expect(getMimeType('README.md')).toBe('text/markdown')
  })

  it('returns application/json for .json', () => {
    expect(getMimeType('config.json')).toBe('application/json')
  })

  it('returns text/html for .html', () => {
    expect(getMimeType('index.html')).toBe('text/html')
  })

  it('returns text/csv for .csv', () => {
    expect(getMimeType('data.csv')).toBe('text/csv')
  })

  it('returns application/octet-stream for unknown extension', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream')
  })

  it('handles uppercase extensions via toLowerCase', () => {
    expect(getMimeType('PHOTO.PNG')).toBe('image/png')
  })

  it('handles paths with multiple dots', () => {
    expect(getMimeType('/path/to/file.backup.json')).toBe('application/json')
  })

  it('returns octet-stream for file with no extension', () => {
    expect(getMimeType('Makefile')).toBe('application/octet-stream')
  })
})
