'use strict'

const { once } = require('events')
const { mkdir, rm, stat } = require('fs/promises')
const { mkdtempSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')
const { promisify } = require('util')
const build = require('..')

async function buildStream (options) {
  const stream = await build(options)
  await once(stream, 'ready')
  return stream
}

async function cleanAndCreateFolder (path) {
  await rm(path, { force: true, recursive: true })
  await mkdir(path, { force: true, recursive: true })
}

function createTempTestDir (prefix = 'pino-roll-test-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Wait for a specific file to exist
 * @param {string} filePath - Path to the file
 * @param {object} options - Options
 * @param {number} options.timeout - Max time to wait in ms (default: 5000)
 * @param {number} options.interval - Check interval in ms (default: 10)
 */
async function waitForFile (filePath, { timeout = 5000, interval = 10 } = {}) {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      await stat(filePath)
      return // File exists
    } catch (error) {
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
 * @param {function} condition - Function that returns true when condition is met
 * @param {object} options - Options
 * @param {number} options.timeout - Max time to wait in ms (default: 5000)
 * @param {number} options.interval - Check interval in ms (default: 200)
 * @param {string} options.description - Description for error messages
 */
async function waitForCondition (condition, { timeout = 5000, interval = 200, description = 'condition' } = {}) {
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
 * @param {string} baseFile - Base file path (e.g., '/path/to/log')
 * @param {number} expectedCount - Expected number of .X.log files
 * @param {object} options - Options for waiting
 */
async function waitForLogFiles (baseFile, expectedCount, options = {}) {
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
 * @param {string} baseFile - Base file path
 * @param {string} dateStr - Date string used in filename
 * @param {number} expectedCount - Expected number of files
 * @param {object} options - Options for waiting
 */
async function waitForDateLogFiles (baseFile, dateStr, expectedCount, options = {}) {
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
    { ...options, description: `${expectedCount} dated log files to be created` }
  )
}

/**
 * Synchronize with the rotation schedule by waiting for the next boundary
 * @param {number} frequency - Frequency in milliseconds
 * @param {number} buffer - Extra buffer time in ms (default: 10)
 */
async function syncWithRotation (frequency, buffer = 10) {
  const now = Date.now()
  const nextBoundary = now - (now % frequency) + frequency
  const waitTime = nextBoundary - now + buffer

  if (waitTime > 0) {
    await sleep(waitTime)
  }
}

/**
 * Wait for a rotation to complete by checking file creation and content stability
 * @param {string} baseFile - Base file path
 * @param {number} fileNumber - File number to check
 * @param {string} expectedContent - Content that should be in the file
 * @param {object} options - Options
 */
async function waitForRotationComplete (baseFile, fileNumber, expectedContent, options = {}) {
  const filePath = `${baseFile}.${fileNumber}.log`

  // First wait for the file to exist
  await waitForFile(filePath, options)

  // Then wait for the content to be stable (file has expected content)
  return waitForCondition(
    async () => {
      try {
        const { readFile } = require('fs/promises')
        const content = await readFile(filePath, 'utf8')
        return content.includes(expectedContent)
      } catch (error) {
        return false
      }
    },
    { ...options, description: `file ${filePath} to contain expected content` }
  )
}

const sleep = promisify(setTimeout)

module.exports = {
  buildStream,
  cleanAndCreateFolder,
  createTempTestDir,
  sleep,
  waitForFile,
  waitForCondition,
  waitForLogFiles,
  waitForDateLogFiles,
  syncWithRotation,
  waitForRotationComplete
}
