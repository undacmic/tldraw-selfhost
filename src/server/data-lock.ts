import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

/** Fail closed: a crashed server's lock must be removed by an administrator, never guessed stale. */
export function acquireDataLock(directory: string) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, '.server-lock')
  try {
    mkdirSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Data directory is locked: ${path}. Stop the other server first. After a crash, remove this lock only after verifying no server is using this directory.`)
    }
    throw error
  }
  try {
    writeFileSync(join(path, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }))
  } catch (error) {
    rmSync(path, { recursive: true, force: true })
    throw error
  }
  let released = false
  return () => {
    if (released) return
    rmSync(path, { recursive: true, force: true })
    released = true
  }
}
