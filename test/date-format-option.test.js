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

  // Synchronize to rotation boundary like the original tap version
  await sleep(100 - Date.now() % 100)

  // Calculate filename AFTER synchronization, using the same format as the original test
  const fileName = `${file}.${format(new Date(), 'yyyy-MM-dd-hh')}`

  const stream = await buildStream({ frequency: 100, file, dateFormat: 'yyyy-MM-dd-hh' })

  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await sleep(110)
  stream.write('logged message #3\n')
  stream.write('logged message #4\n')
  await sleep(110)
  stream.end()
  await once(stream, 'close')

  // Wait for files to be created and rotation to complete
  await waitForFile(`${fileName}.1.log`)
  await waitForFile(`${fileName}.2.log`)
  await waitForFile(`${fileName}.3.log`)

  // Now check contents with additional timing buffer for file system consistency
  await sleep(50) // Small buffer for file system flush on slower platforms

  let content = await readFile(`${fileName}.1.log`, 'utf8')
  assert.ok(content.includes('#1'), 'first file contains first log')
  assert.ok(content.includes('#2'), 'first file contains second log')
  assert.ok(!content.includes('#3'), 'first file does not contains third log')

  content = await readFile(`${fileName}.2.log`, 'utf8')
  assert.ok(content.includes('#3'), 'second file contains third log')
  assert.ok(content.includes('#4'), 'second file contains fourth log')
  assert.ok(!content.includes('#2'), 'second file does not contains second log')

  await assert.rejects(stat(`${fileName}.4.log`), 'no other files created')
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
