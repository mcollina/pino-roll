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
  waitForFile,
  waitForCondition
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

  const fileName = `${file}.${format(new Date(), 'yyyy-MM-dd-hh')}`
  const content = await readFile(`${fileName}.1.log`, 'utf8')
  assert.ok(content.includes('#1'), 'first file contains first log')
  assert.ok(content.includes('#2'), 'first file contains second log')
  await assert.rejects(stat(`${fileName}.2`), 'no other files created')
})

it('rotate file based on custom time and date format', async () => {
  const file = join(logFolder, 'log')
  const frequency = 100

  // Calculate the date format using the same logic as pino-roll
  const { parseFrequency, parseDate } = require('../lib/utils')
  const frequencySpec = parseFrequency(frequency)
  const dateStr = parseDate('yyyy-MM-dd-HH', frequencySpec, true)
  const fileName = `${file}.${dateStr}`

  const stream = await buildStream({ frequency, file, dateFormat: 'yyyy-MM-dd-HH' })

  // Write first batch of messages
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')

  // Wait for the first file to be created with our content
  await waitForFile(`${fileName}.1.log`, { timeout: 1000 })
  await waitForCondition(
    async () => {
      try {
        const content = await readFile(`${fileName}.1.log`, 'utf8')
        return content.includes('logged message #1')
      } catch (error) {
        return false
      }
    },
    { timeout: 1000, description: 'first file to contain initial messages' }
  )

  // Wait for rotation and write new messages
  await sleep(frequency + 10)
  stream.write('logged message #3\n')

  // Wait for rotation to occur (second file created)
  await waitForCondition(
    async () => {
      try {
        await stat(`${fileName}.2.log`)
        return true
      } catch (error) {
        return false
      }
    },
    { timeout: 3000, interval: 50, description: 'second log file to be created' }
  )

  stream.write('logged message #4\n')

  // Give time for final writes
  await sleep(50)

  stream.end()

  // Wait for stream to finish
  await sleep(50)

  // Find all dated log files
  const logFiles = []
  for (let i = 1; i <= 10; i++) {
    try {
      await stat(`${fileName}.${i}.log`)
      logFiles.push(i)
    } catch (error) {
      break
    }
  }

  assert.ok(logFiles.length >= 2, `Should have at least 2 log files, got ${logFiles.length}`)

  // Verify that messages are properly separated
  let found1and2 = false
  let found3or4 = false
  let file1and2Number = null

  for (const fileNum of logFiles) {
    const content = await readFile(`${fileName}.${fileNum}.log`, 'utf8')
    if (content.includes('#1') && content.includes('#2')) {
      found1and2 = true
      file1and2Number = fileNum
    }
    if (content.includes('#3') || content.includes('#4')) {
      found3or4 = true
      // Messages 3 and 4 should be in a different file than 1 and 2
      if (file1and2Number !== null) {
        assert.notStrictEqual(fileNum, file1and2Number,
          'Messages #3/#4 should be in a different file than #1/#2')
      }
    }
  }

  assert.ok(found1and2, 'Should find a file with messages #1 and #2')
  assert.ok(found3or4, 'Should find file(s) with messages #3 or #4')
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
