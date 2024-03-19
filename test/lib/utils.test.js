'use strict'

const { addDays, addHours, startOfDay, startOfHour } = require('date-fns')
const { writeFile, rm, stat } = require('fs/promises')
const { join } = require('path')
const { test } = require('tap')

const {
  buildFileName,
  getFileSize,
  detectLastNumber,
  getNext,
  parseFrequency,
  parseSize,
  getFileName,
  validateLimitOptions
} = require('../../lib/utils')
const { cleanAndCreateFolder, sleep } = require('../utils')

test('parseSize()', async ({ equal, throws }) => {
  equal(parseSize(), null, 'returns null on empty input')
  equal(parseSize('15b'), 15, 'handles input in B')
  equal(parseSize('1k'), 1024, 'handles input in KB')
  equal(parseSize('1.5K'), 1.5 * 1024, 'handles input in KB, capital')
  equal(parseSize('10m'), 10 * 1024 ** 2, 'handles input in MB, capital')
  equal(parseSize('2M'), 2 * 1024 ** 2, 'handles input in MB, capital')
  equal(parseSize(52), 52 * 1024 ** 2, 'considers numerical input as MB')
  equal(parseSize('12'), 12 * 1024 ** 2, 'considers no unit as MB')
  equal(parseSize('3.2g'), 3.2 * 1024 ** 3, 'handles input in GB')
  throws(() => parseSize(''), 'throws on empty string')
  throws(() => parseSize('null'), 'throws on non parseable string')
})

test('parseFrequency()', async ({ same, throws }) => {
  const today = new Date()

  same(parseFrequency(), null, 'returns null on empty input')
  same(
    parseFrequency('daily'),
    { frequency: 'daily', start: startOfDay(today).getTime(), next: startOfDay(addDays(today, 1)).getTime() },
    'supports daily frequency'
  )
  same(
    parseFrequency('hourly'),
    { frequency: 'hourly', start: startOfHour(today).getTime(), next: startOfHour(addHours(today, 1)).getTime() },
    'supports hourly frequency'
  )
  const custom = 3000
  same(
    parseFrequency(custom),
    { frequency: custom, next: Date.now() + custom },
    'supports custom frequency and does not return start'
  )
  throws(() => parseFrequency('null'), 'throws on non parseable string')
})

test('getNext()', async ({ same }) => {
  const today = new Date()

  same(getNext('daily'), startOfDay(addDays(today, 1)).getTime(), 'supports daily frequency')
  same(getNext('hourly'), startOfHour(addHours(today, 1)).getTime(), 'supports hourly frequency')
  const custom = 3000
  same(getNext(custom), Date.now() + custom, 'supports custom frequency and does not return start')
})

test('getFileName()', async ({ equal, throws }) => {
  const strFunc = () => 'my-func'
  throws(getFileName, 'throws on empty input')
  equal(getFileName('my-file'), 'my-file', 'returns string when string given')
  equal(getFileName(strFunc), 'my-func', 'invokes function when function given')
})

test('buildFileName()', async ({ equal, throws }) => {
  const ext = '.json'
  throws(buildFileName, 'throws on empty input')
  equal(buildFileName('my-file'), 'my-file.1', 'appends 1 by default')
  equal(buildFileName(() => 'my-func'), 'my-func.1', 'appends 1 by default')
  equal(buildFileName('my-file', 5, ext), 'my-file.5.json', 'appends number and extension')
})

test('getFileSize()', async ({ test, beforeEach }) => {
  const folder = join('logs', 'utils')
  beforeEach(() => cleanAndCreateFolder(folder))

  test('given an existing file', async ({ equal }) => {
    const fileName = join(folder, 'file.log')
    await writeFile(fileName, '123')

    equal(await getFileSize(fileName), 3, 'detects size of existing file')
  })

  test('given a non existing file', async ({ equal }) => {
    const fileName = join(folder, 'file.log')
    equal(await getFileSize(fileName), 0, 'set current size to 0 with non existing file')
  })
})

test('detectLastNumber()', async ({ test, beforeEach }) => {
  const folder = join('logs', 'utils')
  beforeEach(() => cleanAndCreateFolder(folder))

  test('given existing files', async ({ equal }) => {
    const fileName = join(folder, 'file.5')
    const fileNameFunc = () => fileName
    await writeFile(join(folder, 'file.1'), '')
    await writeFile(join(folder, 'file.5'), '')
    await writeFile(join(folder, 'file.10'), '')
    await writeFile(join(folder, 'file.7'), '')
    equal(await detectLastNumber(fileName), 10, 'detects highest existing number')
    equal(await detectLastNumber(fileNameFunc), 10, 'detects highest existing number when given func')
  })

  test('given existing files and a time', async ({ equal }) => {
    const fileName = join(folder, 'file.5')
    await writeFile(join(folder, 'file.9'), '')
    await writeFile(join(folder, 'file.10'), '')
    await sleep(10)
    await writeFile(join(folder, 'file.2'), '')
    await writeFile(join(folder, 'file.3'), '')
    const { birthtimeMs } = await stat(join(folder, 'file.2'))
    equal(await detectLastNumber(fileName, birthtimeMs - 15), 10, 'considers files after provided time')
    equal(await detectLastNumber(fileName, birthtimeMs), 3, 'ignores files older than time')
    equal(await detectLastNumber(fileName, Date.now()), 1, 'ignores all files older than time')
  })

  test('given files without numbers', async ({ equal }) => {
    await writeFile(join(folder, 'file'), '')
    await writeFile(join(folder, 'file.5'), '')
    equal(await detectLastNumber(join(folder, 'file')), 5, 'ignores them')
  })

  test('given an empty folder', async ({ equal }) => {
    equal(await detectLastNumber(join(folder, 'file')), 1, 'returns 1')
  })

  test('given no folder', async ({ equal }) => {
    await rm(folder, { force: true, recursive: true })
    equal(await detectLastNumber(join(folder, 'file')), 1, 'returns 1')
  })
})

test('validateLimitOptions()', async ({ doesNotThrow, throws }) => {
  doesNotThrow(() => validateLimitOptions(), 'allows no limit')
  doesNotThrow(() => validateLimitOptions({ count: 2 }), 'allows valid count')
  throws(() => validateLimitOptions(true), { message: 'limit must be an object' }, 'throws when limit is not an object')
  throws(() => validateLimitOptions({ count: [] }), { message: 'limit.count must be a number greater than 0' }, 'throws when limit.count is not an number')
  throws(() => validateLimitOptions({ count: -2 }), { message: 'limit.count must be a number greater than 0' }, 'throws when limit.count is negative')
  throws(() => validateLimitOptions({ count: 0 }), { message: 'limit.count must be a number greater than 0' }, 'throws when limit.count is 0')
})
