'use strict'

const { once } = require('events')
const { stat, readFile } = require('fs/promises')
const { join } = require('path')
const { test, beforeEach } = require('tap')
const { format, startOfHour } = require('date-fns')

const { buildStream, cleanAndCreateFolder, sleep } = require('./utils')

const logFolder = join('logs', 'date-format-option', 'roll')

beforeEach(() => cleanAndCreateFolder(logFolder))

test('rotate file with date format based on frequency', async ({ ok, rejects }) => {
  const file = join(logFolder, 'log')
  const stream = await buildStream({ frequency: 'hourly', file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  stream.end()

  const fileName = `${file}.${format(new Date(), 'yyyy-MM-dd-hh')}`
  const content = await readFile(`${fileName}.1`, 'utf8')
  ok(content.includes('#1'), 'first file contains first log')
  ok(content.includes('#2'), 'first file contains second log')
  rejects(stat(`${fileName}.2`), 'no other files created')
})

test('rotate file based on custom time and date format', async ({ ok, notOk, rejects }) => {
  const file = join(logFolder, 'log')
  await sleep(100 - Date.now() % 100)
  const fileName = `${file}.${format(new Date(), 'yyyy-MM-dd-hh')}`
  const stream = await buildStream({ frequency: 100, file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await sleep(110)
  stream.write('logged message #3\n')
  stream.write('logged message #4\n')
  await sleep(110)
  stream.end()
  await stat(`${fileName}.1`)
  let content = await readFile(`${fileName}.1`, 'utf8')
  ok(content.includes('#1'), 'first file contains first log')
  ok(content.includes('#2'), 'first file contains second log')
  notOk(content.includes('#3'), 'first file does not contains third log')
  await stat(`${fileName}.2`)
  content = await readFile(`${fileName}.2`, 'utf8')
  ok(content.includes('#3'), 'first file contains third log')
  ok(content.includes('#4'), 'first file contains fourth log')
  notOk(content.includes('#2'), 'first file does not contains second log')
  await stat(`${fileName}.3`)
  rejects(stat(`${fileName}.4`), 'no other files created')
})

test('rotate file based on size and date format', async ({ ok, rejects }) => {
  const file = join(logFolder, 'log')
  const fileWithDate = `${file}.${format(startOfHour(new Date()).getTime(), 'yyyy-MM-dd-hh')}`
  const size = 20
  const stream = await buildStream({ frequency: 'hourly', size: `${size}b`, file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await once(stream, 'ready')
  stream.write('logged message #3\n')
  stream.end()
  let stats = await stat(`${fileWithDate}.1`)
  ok(
    size <= stats.size && stats.size <= size * 2,
    `first file size: ${size} <= ${stats.size} <= ${size * 2}`
  )
  stats = await stat(`${fileWithDate}.2`)
  ok(stats.size <= size, `second file size: ${stats.size} <= ${size}`)
  rejects(stat(`${fileWithDate}.3`), 'no other files created')
})

test('rotate file based on size and date format with custom frequency', async ({ ok, rejects }) => {
  const file = join(logFolder, 'log')
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

  let stats = await stat(`${fileWithDate}.1`)
  ok(
    size <= stats.size && stats.size <= size * 2,
    `first file size: ${size} <= ${stats.size} <= ${size * 2}`
  )
  stats = await stat(`${fileWithDate}.2`)
  ok(stats.size <= size, `second file size: ${stats.size} <= ${size}`)
  stats = await stat(`${fileWithDate}.3`)
  const content = await readFile(`${fileWithDate}.3`, 'utf8')
  ok(content.includes('#4'), 'Rotated file should have the log')
  rejects(stat(`${file}.4`), 'no other files created')
})

test('rotate file based on size and date format without frequency', async ({ ok, rejects }) => {
  const file = join(logFolder, 'log')
  const size = 20
  const stream = await buildStream({ size: `${size}b`, file, dateFormat: 'yyyy-MM-dd-hh' })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await once(stream, 'ready')
  stream.write('logged message #3\n')
  stream.end()
  let stats = await stat(`${file}.1`)
  ok(
    size <= stats.size && stats.size <= size * 2,
    `first file size: ${size} <= ${stats.size} <= ${size * 2}`
  )
  stats = await stat(`${file}.2`)
  ok(stats.size <= size, `second file size: ${stats.size} <= ${size}`)
  rejects(stat(`${file}.3`), 'no other files created')
})

test('throw on invalid date format', async ({ rejects }) => {
  rejects(
    buildStream({ file: join(logFolder, 'log'), dateFormat: 'yyyy%MM%dd' }),
    {
      message: 'yyyy%MM%dd contains invalid characters'
    },
    'throws on invalid date format'
  )
})
