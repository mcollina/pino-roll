import { once } from 'node:events'
import { mkdir, rm, stat, readFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import pinoRoll, { type PinoRollOptions } from '../src/pino-roll.ts'
import { type SonicBoom } from 'sonic-boom'

export async function buildStream (
  options: PinoRollOptions
): Promise<SonicBoom> {
  const stream = await pinoRoll(options)
  await once(stream, 'ready')
  return stream
}

export async function cleanAndCreateFolder (path: string): Promise<void> {
  await rm(path, { force: true, recursive: true })
  await mkdir(path, { recursive: true })
}

export function createTempTestDir (prefix = 'pino-roll-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export interface WaitOptions {
  timeout?: number;
  interval?: number;
  description?: string;
}

/**
 * Wait for a specific file to exist
 * @param filePath - Path to the file
 * @param options - Options
 * @param options.timeout - Max time to wait in ms (default: 5000)
 * @param options.interval - Check interval in ms (default: 10)
 */
export async function waitForFile (
  filePath: string,
  { timeout = 5000, interval = 10 }: WaitOptions = {}
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      await stat(filePath)
      return // File exists
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error // Unexpected error
      }
    }
    await sleep(interval)
  }

  throw new Error(`File ${filePath} did not appear within ${timeout}ms`)
}

/**
 * Wait for a condition to be true
 * @param condition - Function that returns true when condition is met
 * @param options - Options
 * @param options.timeout - Max time to wait in ms (default: 5000)
 * @param options.interval - Check interval in ms (default: 200)
 * @param options.description - Description for error messages
 */
export async function waitForCondition<T> (
  condition: () => Promise<T> | T,
  {
    timeout = 5000,
    interval = 50,
    description = 'condition',
  }: WaitOptions = {}
): Promise<T | void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const result = await condition()
      if (result) return result
    } catch (error) {
      // Ignore errors during condition checking and continue polling
    }
    await sleep(interval)
  }

  throw new Error(`${description} was not met within ${timeout}ms`)
}

/**
 * Wait for a specific number of log files to be created
 * @param baseFile - Base file path (e.g., '/path/to/log')
 * @param expectedCount - Expected number of .X.log files
 * @param options - Options for waiting
 */
export async function waitForLogFiles (
  baseFile: string,
  expectedCount: number,
  options: WaitOptions = {}
): Promise<void | boolean> {
  return waitForCondition(
    async () => {
      try {
        const files = []
        for (let i = 1; i <= expectedCount; i++) {
          await stat(`${baseFile}.${i}.log`)
          files.push(i)
        }
        return files.length === expectedCount
      } catch (error) {
        return false
      }
    },
    { ...options, description: `${expectedCount} log files to be created` }
  )
}

/**
 * Wait for a specific number of log files with date format to be created
 * @param baseFile - Base file path
 * @param dateStr - Date string used in filename
 * @param expectedCount - Expected number of files
 * @param options - Options for waiting
 */
export async function waitForDateLogFiles (
  baseFile: string,
  dateStr: string,
  expectedCount: number,
  options: WaitOptions = {}
): Promise<void | boolean> {
  return waitForCondition(
    async () => {
      try {
        const files = []
        for (let i = 1; i <= expectedCount; i++) {
          await stat(`${baseFile}.${dateStr}.${i}.log`)
          files.push(i)
        }
        return files.length === expectedCount
      } catch (error) {
        return false
      }
    },
    {
      ...options,
      description: `${expectedCount} dated log files to be created`,
    }
  )
}

/**
 * Synchronize with the rotation schedule by waiting for the next boundary
 * @param frequency - Frequency in milliseconds
 * @param buffer - Extra buffer time in ms (default: 10)
 */
export async function syncWithRotation (
  frequency: number,
  buffer = 10
): Promise<void> {
  const now = Date.now()
  const nextBoundary = now - (now % frequency) + frequency
  const waitTime = nextBoundary - now + buffer

  if (waitTime > 0) {
    await sleep(waitTime)
  }
}

/**
 * Wait for a rotation to complete by checking file creation and content stability
 * @param baseFile - Base file path
 * @param fileNumber - File number to check
 * @param expectedContent - Content that should be in the file
 * @param options - Options
 */
export async function waitForRotationComplete (
  baseFile: string,
  fileNumber: number,
  expectedContent: string,
  options: WaitOptions = {}
): Promise<void | boolean> {
  const filePath = `${baseFile}.${fileNumber}.log`

  // First wait for the file to exist
  await waitForFile(filePath, options)

  // Then wait for the content to be stable (file has expected content)
  return waitForCondition(
    async () => {
      try {
        const content = await readFile(filePath, 'utf8')
        return content.includes(expectedContent)
      } catch (error) {
        return false
      }
    },
    { ...options, description: `file ${filePath} to contain expected content` }
  )
}

export { sleep }
