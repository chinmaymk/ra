export const tmpdir = (name: string) => `${process.env.TMPDIR ?? '/tmp'}/${name}`
