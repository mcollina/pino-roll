'use strict'

const { addDays, addHours, startOfDay, startOfHour } = require('date-fns')
const { writeFile, rm, stat, readlink, symlink } = require('fs/promises')
const { join } = require('path')
const { test } = require('tap')
const { format } = require('date-fns')
const MockDate = require('mockdate')

const {
  buildFileName,
  checkSymlink,
  createSymlink,
  extractFileName,
  getFileSize,
  detectLastNumber,
  getNext,
  parseFrequency,
  parseSize,
  getFileName,
  validateLimitOptions,
  validateDateFormat,
  parseDate,
  identifyLogFile
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
  const start = today.getTime() - today.getTime() % custom
  const next = start + custom
  same(
    parseFrequency(custom),
    { frequency: custom, start, next },
    'supports custom frequency'
  )
  throws(() => parseFrequency('null'), 'throws on non parseable string')
})

test('getNext()', async ({ same }) => {
  const today = new Date()

  same(getNext('daily'), startOfDay(addDays(today, 1)).getTime(), 'supports daily frequency')
  same(getNext('hourly'), startOfHour(addHours(today, 1)).getTime(), 'supports hourly frequency')
  const custom = 3000
  const time = Date.now()
  const next = time - time % custom + custom
  same(getNext(custom), next, 'supports custom frequency')
})

test('getNext() on dates transitioning from DST to Standard Time', async ({ same }) => {
  // on these days the time rolls back 1 hour so there "are" 25 hours in the day
  // genNext() should account for variable number of hours in the day

  // test two different timezones
  const data = [
    {
      tz: 'Europe/Berlin',
      mockDate: '27 Oct 2024 00:00:00 GMT+0100'
    },
    {
      tz: 'America/New_York',
      mockDate: '03 Nov 2024 00:00:00 GMT-0500'
    }
  ]

  for (const d of data) {
    MockDate.set(d.mockDate)
    process.env.TZ = d.tz
    const today = new Date()

    same(getNext('daily'), startOfDay(addDays(today, 1)).getTime(), 'supports daily frequency')
    same(getNext('hourly'), startOfHour(addHours(today, 1)).getTime(), 'supports hourly frequency')
    const custom = 3000
    same(getNext(custom), Date.now() + custom, 'supports custom frequency and does not return start')
    MockDate.reset()
    process.env.TZ = undefined
  }
})

test('getNext() on dates transitioning from Standard Time to DST', async ({ same }) => {
  // on these days the time rolls forward 1 hour so there "are" 23 hours in the day
  // genNext() should account for variable number of hours in the day

  // test two different timezones
  const data = [
    {
      tz: 'Europe/Berlin',
      mockDate: '31 March 2024 01:00:00 GMT+0100'
    },
    {
      tz: 'America/New_York',
      mockDate: '10 Nov 2024 01:00:00 GMT-0500'
    }
  ]

  for (const d of data) {
    MockDate.set(d.mockDate)
    process.env.TZ = d.tz
    const today = new Date()

    same(getNext('daily'), startOfDay(addDays(today, 1)).getTime(), 'supports daily frequency')
    same(getNext('hourly'), startOfHour(addHours(today, 1)).getTime(), 'supports hourly frequency')
    const custom = 3000
    same(getNext(custom), Date.now() + custom, 'supports custom frequency and does not return start')
    MockDate.reset()
    process.env.TZ = undefined
  }
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
  equal(buildFileName('my-file', null, 5, ext), 'my-file.5.json', 'appends number and extension')
  equal(buildFileName('my-file', '2024-09-26'), 'my-file.2024-09-26.1', 'appends date')
  equal(buildFileName('my-file', '2024-09-26-07'), 'my-file.2024-09-26-07.1', 'appends date and hour')
  equal(buildFileName('my-file', '2024-09-26', 5), 'my-file.2024-09-26.5', 'appends date and number')
  equal(buildFileName('my-file', '2024-09-26', 5, ext), 'my-file.2024-09-26.5.json', 'appends date, number and extension')
})

test('identifyLogFiles()', async ({ notOk, equal }) => {
  const ext = 'json'
  let b
  b = buildFileName('my-file', null, 5, ext)
  equal(b, identifyLogFile(b, 'my-file', null, ext).fileName, 'number + ext')
  b = buildFileName('my-file', null, 5, undefined)
  equal(b, identifyLogFile(b, 'my-file', null, null).fileName, 'number only')
  b = buildFileName('my-file', '2024-09-26')
  equal(b, identifyLogFile(b, 'my-file', 'yyyy-MM-dd').fileName, 'number(start)+date')
  b = buildFileName('my-file', '2024-09-26-07')
  equal(b, identifyLogFile(b, 'my-file', 'yyyy-MM-dd-hh').fileName, 'number(start)+date (hourly)')
  b = buildFileName('my-file', '2024-09-26', 5)
  equal(b, identifyLogFile(b, 'my-file', 'yyyy-MM-dd').fileName, 'number+date')
  b = buildFileName('my-file', '2024-09-26', 5, ext)
  equal(b, identifyLogFile(b, 'my-file', 'yyyy-MM-dd', ext).fileName, 'number+date+extension')
  b = buildFileName('my-file', '2024-09-26', 5, '.json')
  equal(b, identifyLogFile(b, 'my-file', 'yyyy-MM-dd', '.json').fileName, 'number+date+extension(with dot suffix)')
  b = buildFileName('my-file', '2024-09-31', '5a', ext)
  b = buildFileName('my-file', '2024-09-31', 5, ext)
  notOk(identifyLogFile(b, 'my-file', 'yyyy-MM-dd', ext).fileName, 'number+invalid date+extension')
  b = buildFileName('my-file', '2024-09-26', 5, 'notMyExtension')
  notOk(identifyLogFile(b, 'my-file', 'yyyy-MM-dd', ext), 'number+date+invalid extension')
  notOk(identifyLogFile('my-file.log', 'my-file'), 'invalid number in file name')
  notOk(identifyLogFile('not any file can be log.txt', 'my-file'), 'invalid base file name')
  notOk(identifyLogFile('my-file.extrasegment.txt', 'my-file'), 'unequal segment with expected')
})

test('validateDateFormat()', async ({ equal, throws }) => {
  equal(validateDateFormat('2024-09-26'), true, 'returns null on valid date format')
  equal(validateDateFormat('2024-09-26-10'), true, 'returns null on valid date time format')
  throws(() => validateDateFormat('2024:09:26'), 'throws on invalid date format with semicolon')
  throws(() => validateDateFormat('2024*09*26'), 'throws on invalid date format with asterisk')
  throws(() => validateDateFormat('2024<09>26'), 'throws on invalid date format with <>')
})

test('parseDate()', async ({ equal, throws }) => {
  const today = new Date()
  const frequencySpec = { frequency: 'hourly', start: startOfHour(today).getTime(), next: startOfHour(addHours(today, 1)).getTime() }
  equal(parseDate(null, frequencySpec), null, 'returns null on empty format')
  equal(parseDate('yyyy-MM-dd-hh', frequencySpec, true), format(frequencySpec.start, 'yyyy-MM-dd-hh'), 'parse start date time')
  equal(parseDate('yyyy-MM-dd-hh', frequencySpec), format(frequencySpec.next, 'yyyy-MM-dd-hh'), 'parse next date time')
  throws(() => parseDate('yyyy-MM-dd-hhU', frequencySpec), 'throws on invalid date format with character U')
  throws(() => parseDate('yyyy-MM-dd-hhJ', frequencySpec), 'throws on invalid date format with character J')
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
    await sleep(100)
    await writeFile(join(folder, 'file.2'), '', { flush: true })
    await writeFile(join(folder, 'file.3'), '', { flush: true })
    const { birthtimeMs } = await stat(join(folder, 'file.2'))
    equal(await detectLastNumber(fileName, birthtimeMs - 150), 10, 'considers files after provided time')
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
  throws(() => validateLimitOptions({ count: 2, removeOtherLogFiles: 2 }), { message: 'limit.removeOtherLogFiles must be boolean' }, 'throws when limit.removeOtherLogFiles is not boolean')
  throws(() => validateLimitOptions({ count: 2, removeOtherLogFiles: [] }), { message: 'limit.removeOtherLogFiles must be boolean' }, 'throws when limit.removeOtherLogFiles is not boolean')
  throws(() => validateLimitOptions({ count: 2, removeOtherLogFiles: {} }), { message: 'limit.removeOtherLogFiles must be boolean' }, 'throws when limit.removeOtherLogFiles is not boolean')
  throws(() => validateLimitOptions({ count: 2, removeOtherLogFiles: 'ok' }), { message: 'limit.removeOtherLogFiles must be boolean' }, 'throws when limit.removeOtherLogFiles is not boolean')
})

test('checkSymlink()', async ({ test, beforeEach }) => {
  const folder = join('logs', 'utils')
  const other = join(folder, 'other')
  beforeEach(async () => {
    await cleanAndCreateFolder(folder)
    await cleanAndCreateFolder(other)
  })

  test('given a new symlink (should return true)', async ({ equal }) => {
    const fileName = join(folder, 'file.log')
    const linkPath = join(folder, 'current.log')
    await writeFile(fileName, 'test content')
    const result = await checkSymlink(fileName, linkPath)
    equal(result, true, 'returns true when symlink does not exist')
  })

  test('given an existing symlink pointing to the same file (should return false)', async ({ equal }) => {
    const fileName = join(folder, 'file.log')
    const linkPath = join(folder, 'current.log')
    await writeFile(fileName, 'test content')
    await symlink(fileName, linkPath)
    const result = await checkSymlink(fileName, linkPath)
    equal(result, false, 'returns false when symlink points to the same file')
    const linkTarget = await readlink(linkPath)
    equal(linkTarget, fileName, 'symlink remains unchanged')
  })

  test('given a new symlink pointing to a different folder (should return true)', async ({ equal }) => {
    const linkPath = join(folder, 'current.log')
    const fileName = join(other, 'file.log')
    await writeFile(fileName, 'test content')
    const result = await checkSymlink(fileName, linkPath)
    equal(result, true, 'returns true when symlink does not exist')
  })

  test('given a symlink pointing to a different folder (should return false)', async ({ equal }) => {
    const linkPath = join(folder, 'current.log')
    const fileName = join(other, 'file.log')
    await writeFile(fileName, 'test content')
    await symlink(fileName, linkPath)
    const result = await checkSymlink(fileName, linkPath)
    equal(result, false, 'returns false when symlink points to a different folder')
  })
})

test('createSymlink()', async ({ beforeEach }) => {
  const folder = join('logs', 'utils')
  beforeEach(() => cleanAndCreateFolder(folder))

  test('given a new symlink (should create symlink)', async ({ equal }) => {
    const fileName = join(folder, 'file1.log')
    const linkPath = join(folder, 'current.log')
    await writeFile(fileName, 'test content')
    await createSymlink(fileName)
    const linkTarget = await readlink(linkPath)
    equal(linkTarget, extractFileName(fileName), 'creates correct symlink')
  })

  test('given there is already a symlink (should not create symlink)', async ({ equal }) => {
    const fileName = join(folder, 'file1.log')
    equal(false, await createSymlink(fileName), 'returns false when symlink already exists')
  })
})
