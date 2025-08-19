'use strict'

const { once } = require('events')
const { stat, readFile } = require('fs/promises')
const { join } = require('path')
const { tmpdir } = require('os')
const { it, beforeEach } = require('node:test')
const assert = require('node:assert')
const { format } = require('date-fns')

const { buildStream, cleanAndCreateFolder, sleep } = require('./utils')

const logFolder = join(tmpdir(), 'pino-roll-tests', 'date-format-option', 'roll')

beforeEach(() => cleanAndCreateFolder(logFolder))

it('rotate file with date format based on frequency', async () => {
  const file = join(logFolder, 'log')
  const stream = await buildStream({ frequency: 'hourly', file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  stream.end()

  const fileName = `${file}.${format(new Date(), 'yyyy-MM-dd-hh')}`
  const content = await readFile(`${fileName}.1.log`, 'utf8')
  assert.ok(content.includes('#1'), 'first file contains first log')
  assert.ok(content.includes('#2'), 'first file contains second log')
  await assert.rejects(stat(`${fileName}.2`), 'no other files created')
})

it('rotate file based on custom time and date format', async () => {
  const file = join(logFolder, 'log')
  await sleep(100 - Date.now() % 100)
  // Calculate the date format using the same logic as pino-roll
  const { parseFrequency, parseDate } = require('../lib/utils')
  const frequencySpec = parseFrequency(100)
  const dateStr = parseDate('yyyy-MM-dd-HH', frequencySpec, true)
  const fileName = `${file}.${dateStr}`
  const stream = await buildStream({ frequency: 100, file, dateFormat: 'yyyy-MM-dd-HH' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await sleep(110)
  stream.write('logged message #3\n')
  stream.write('logged message #4\n')
  await sleep(110)
  stream.end()
  await stat(`${fileName}.1.log`)
  let content = await readFile(`${fileName}.1.log`, 'utf8')
  assert.ok(content.includes('#1'), 'first file contains first log')
  assert.ok(content.includes('#2'), 'first file contains second log')
  assert.ok(!content.includes('#3'), 'first file does not contain third log')
  await stat(`${fileName}.2.log`)
  content = await readFile(`${fileName}.2.log`, 'utf8')
  assert.ok(content.includes('#3'), 'second file contains third log')
  assert.ok(content.includes('#4'), 'second file contains fourth log')
  assert.ok(!content.includes('#2'), 'second file does not contain second log')
  await stat(`${fileName}.3.log`)
  await assert.rejects(stat(`${fileName}.4.log`), 'no other files created')
})

it('rotate file based on size and date format', async () => {
  const file = join(logFolder, 'log')
  // Calculate the date format using the same logic as pino-roll
  const { parseFrequency, parseDate } = require('../lib/utils')
  const frequencySpec = parseFrequency('hourly')
  const dateStr = parseDate('yyyy-MM-dd-hh', frequencySpec, true)
  const fileWithDate = `${file}.${dateStr}`
  const size = 20
  const stream = await buildStream({ frequency: 'hourly', size: `${size}b`, file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await once(stream, 'ready')
  stream.write('logged message #3\n')
  stream.end()
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
  // Calculate the date format using the same logic as pino-roll
  const { parseFrequency, parseDate } = require('../lib/utils')
  const frequencySpec = parseFrequency(1000)
  const dateStr = parseDate('yyyy-MM-dd-hh', frequencySpec, true)
  const fileWithDate = `${file}.${dateStr}`
  const size = 20
  const stream = await buildStream({ frequency: 1000, size: `${size}b`, file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await once(stream, 'ready')
  stream.write('logged message #3\n')
  await sleep(1010)
  stream.write('logged message #4\n')
  stream.end()

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
