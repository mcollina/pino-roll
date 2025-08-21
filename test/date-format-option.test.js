'use strict'

const { once } = require('events')
const { stat, readFile } = require('fs/promises')
const { join } = require('path')
const { it, beforeEach } = require('node:test')
const assert = require('node:assert')
const { format } = require('date-fns')

const {
  buildStream,
  createTempTestDir,
  sleep,
  waitForFile
} = require('./utils')

let logFolder

beforeEach(() => {
  logFolder = createTempTestDir()
})

it('rotate file with date format based on frequency', async () => {
  const file = join(logFolder, 'log')
  const stream = await buildStream({ frequency: 'hourly', file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  stream.end()
  await once(stream, 'close')

  const fileName = `${file}.${format(new Date(), 'yyyy-MM-dd-hh')}`
  const content = await readFile(`${fileName}.1.log`, 'utf8')
  assert.ok(content.includes('#1'), 'first file contains first log')
  assert.ok(content.includes('#2'), 'first file contains second log')
  await assert.rejects(stat(`${fileName}.2`), 'no other files created')
})

it('rotate file based on custom time and date format', async () => {
  const file = join(logFolder, 'log')
  console.log(`[DEBUG] Test starting, platform: ${process.platform}, CI: ${process.env.CI}, folder: ${logFolder}`)

  // Synchronize to rotation boundary like the original tap version
  const now = Date.now()
  const syncDelay = 100 - (now % 100)
  console.log(`[DEBUG] Synchronizing: now=${now}, syncDelay=${syncDelay}ms`)
  await sleep(syncDelay)

  // Calculate filename AFTER synchronization, using the same format as the original test
  const currentDate = new Date()
  const fileName = `${file}.${format(currentDate, 'yyyy-MM-dd-hh')}`
  console.log(`[DEBUG] Filename pattern: ${fileName}, date: ${currentDate.toISOString()}`)

  const stream = await buildStream({ frequency: 100, file, dateFormat: 'yyyy-MM-dd-hh' })
  console.log('[DEBUG] Stream created with frequency: 100ms')

  console.log('[DEBUG] Writing messages #1 and #2')
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')

  console.log('[DEBUG] Sleeping 110ms for rotation')
  await sleep(110)

  console.log('[DEBUG] Writing messages #3 and #4')
  stream.write('logged message #3\n')
  stream.write('logged message #4\n')

  console.log('[DEBUG] Sleeping 110ms for second rotation')
  await sleep(110)

  console.log('[DEBUG] Ending stream')
  stream.end()
  await once(stream, 'close')
  console.log('[DEBUG] Stream closed')

  // Wait for files to be created and rotation to complete
  console.log(`[DEBUG] Waiting for file: ${fileName}.1.log`)
  await waitForFile(`${fileName}.1.log`)
  console.log(`[DEBUG] File found: ${fileName}.1.log`)

  console.log(`[DEBUG] Waiting for file: ${fileName}.2.log`)
  await waitForFile(`${fileName}.2.log`)
  console.log(`[DEBUG] File found: ${fileName}.2.log`)

  console.log(`[DEBUG] Waiting for file: ${fileName}.3.log`)
  await waitForFile(`${fileName}.3.log`)
  console.log(`[DEBUG] File found: ${fileName}.3.log`)

  // Now check contents with additional timing buffer for file system consistency
  console.log('[DEBUG] Sleeping 50ms for file system flush')
  await sleep(50) // Small buffer for file system flush on slower platforms

  console.log(`[DEBUG] Reading ${fileName}.1.log`)
  let content = await readFile(`${fileName}.1.log`, 'utf8')
  console.log(`[DEBUG] File 1 content (${content.length} bytes): "${content.replace(/\n/g, '\\n')}"`)
  assert.ok(content.includes('#1'), 'first file contains first log')
  assert.ok(content.includes('#2'), 'first file contains second log')
  assert.ok(!content.includes('#3'), 'first file does not contains third log')

  console.log(`[DEBUG] Reading ${fileName}.2.log`)
  content = await readFile(`${fileName}.2.log`, 'utf8')
  console.log(`[DEBUG] File 2 content (${content.length} bytes): "${content.replace(/\n/g, '\\n')}"`)
  assert.ok(content.includes('#3'), 'second file contains third log')
  assert.ok(content.includes('#4'), 'second file contains fourth log')
  assert.ok(!content.includes('#2'), 'second file does not contains second log')

  console.log(`[DEBUG] Checking that ${fileName}.4.log does not exist`)
  await assert.rejects(stat(`${fileName}.4.log`), 'no other files created')
  console.log('[DEBUG] Test completed successfully')
})

it('rotate file based on size and date format', async () => {
  const file = join(logFolder, 'log')
  const { startOfHour } = require('date-fns')
  const fileWithDate = `${file}.${format(startOfHour(new Date()), 'yyyy-MM-dd-hh')}`
  const size = 20
  const stream = await buildStream({ frequency: 'hourly', size: `${size}b`, file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await once(stream, 'ready')
  stream.write('logged message #3\n')
  stream.end()
  await once(stream, 'close')
  let stats = await stat(`${fileWithDate}.1.log`)
  assert.ok(
    size <= stats.size && stats.size <= size * 2,
    `first file size: ${size} <= ${stats.size} <= ${size * 2}`
  )
  stats = await stat(`${fileWithDate}.2.log`)
  assert.ok(stats.size <= size, `second file size: ${stats.size} <= ${size}`)
  await assert.rejects(stat(`${fileWithDate}.3.log`), 'no other files created')
})

it('rotate file based on size and date format with custom frequency', async () => {
  const file = join(logFolder, 'log')
  const { startOfHour } = require('date-fns')
  const fileWithDate = `${file}.${format(startOfHour(new Date()).getTime(), 'yyyy-MM-dd-hh')}`
  const size = 20
  const stream = await buildStream({ frequency: 1000, size: `${size}b`, file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await once(stream, 'ready')
  stream.write('logged message #3\n')
  await sleep(1010)
  stream.write('logged message #4\n')

  // Add delay for macOS/Windows filesystem timing
  if (process.platform === 'darwin' || process.platform === 'win32') {
    await sleep(100)
  }

  stream.end()
  await once(stream, 'close')

  let stats = await stat(`${fileWithDate}.1.log`)
  assert.ok(
    size <= stats.size && stats.size <= size * 2,
    `first file size: ${size} <= ${stats.size} <= ${size * 2}`
  )
  stats = await stat(`${fileWithDate}.2.log`)
  assert.ok(stats.size <= size, `second file size: ${stats.size} <= ${size}`)
  stats = await stat(`${fileWithDate}.3.log`)
  const content = await readFile(`${fileWithDate}.3.log`, 'utf8')
  assert.ok(content.includes('#4'), 'Rotated file should have the log')
  await assert.rejects(stat(`${fileWithDate}.4.log`), 'no other files created')
})

it('rotate file based on size and date format without frequency', async () => {
  const file = join(logFolder, 'log')
  const size = 20
  const stream = await buildStream({ size: `${size}b`, file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await once(stream, 'ready')
  stream.write('logged message #3\n')
  stream.end()
  await once(stream, 'close')
  let stats = await stat(`${file}.1.log`)
  assert.ok(
    size <= stats.size && stats.size <= size * 2,
    `first file size: ${size} <= ${stats.size} <= ${size * 2}`
  )
  stats = await stat(`${file}.2.log`)
  assert.ok(stats.size <= size, `second file size: ${stats.size} <= ${size}`)
  await assert.rejects(stat(`${file}.3.log`), 'no other files created')
})

it('throw on invalid date format', async () => {
  await assert.rejects(
    buildStream({ file: join(logFolder, 'log'), dateFormat: 'yyyy%MM%dd' }),
    {
      message: 'yyyy%MM%dd contains invalid characters'
    },
    'throws on invalid date format'
  )
})
