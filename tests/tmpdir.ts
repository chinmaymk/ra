import { tmpdir as osTmpdir } from 'os'

export const tmpdir = (name: string) => `${osTmpdir()}/${name}`
