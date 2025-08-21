'use strict'

const { addDays, addHours, startOfDay, startOfHour } = require('date-fns')
const { writeFile, rm, stat, readlink, symlink } = require('fs/promises')
const { join } = require('path')
const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert')
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
  identifyLogFile,
  sanitizeFile,
  validateFileName
} = require('../../lib/utils')
const { createTempTestDir, sleep } = require('../utils')

it('parseSize()', async () => {
  assert.strictEqual(parseSize(), null, 'returns null on empty input')
  assert.strictEqual(parseSize('15b'), 15, 'handles input in B')
  assert.strictEqual(parseSize('1k'), 1024, 'handles input in KB')
  assert.strictEqual(parseSize('1.5K'), 1.5 * 1024, 'handles input in KB, capital')
  assert.strictEqual(parseSize('10m'), 10 * 1024 ** 2, 'handles input in MB, capital')
  assert.strictEqual(parseSize('2M'), 2 * 1024 ** 2, 'handles input in MB, capital')
  assert.strictEqual(parseSize(52), 52 * 1024 ** 2, 'considers numerical input as MB')
  assert.strictEqual(parseSize('12'), 12 * 1024 ** 2, 'considers no unit as MB')
  assert.strictEqual(parseSize('3.2g'), 3.2 * 1024 ** 3, 'handles input in GB')
  assert.throws(() => parseSize(''), 'throws on empty string')
  assert.throws(() => parseSize('null'), 'throws on non parseable string')
})

it('parseFrequency()', async () => {
  const today = new Date()

  assert.deepStrictEqual(parseFrequency(), null, 'returns null on empty input')
  assert.deepStrictEqual(
    parseFrequency('daily'),
    { frequency: 'daily', start: startOfDay(today).getTime(), next: startOfDay(addDays(today, 1)).getTime() },
    'supports daily frequency'
  )
  assert.deepStrictEqual(
    parseFrequency('hourly'),
    { frequency: 'hourly', start: startOfHour(today).getTime(), next: startOfHour(addHours(today, 1)).getTime() },
    'supports hourly frequency'
  )
  const custom = 3000
  const start = today.getTime() - today.getTime() % custom
  const next = start + custom
  assert.deepStrictEqual(
    parseFrequency(custom),
    { frequency: custom, start, next },
    'supports custom frequency'
  )
  assert.throws(() => parseFrequency('null'), 'throws on non parseable string')
})

it('getNext()', async () => {
  const today = new Date()

  assert.deepStrictEqual(getNext('daily'), startOfDay(addDays(today, 1)).getTime(), 'supports daily frequency')
  assert.deepStrictEqual(getNext('hourly'), startOfHour(addHours(today, 1)).getTime(), 'supports hourly frequency')
  const custom = 3000
  const time = Date.now()
  const next = time - time % custom + custom
  assert.deepStrictEqual(getNext(custom), next, 'supports custom frequency')
})

it('getNext() on dates transitioning from DST to Standard Time', async () => {
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

    assert.deepStrictEqual(getNext('daily'), startOfDay(addDays(today, 1)).getTime(), 'supports daily frequency')
    assert.deepStrictEqual(getNext('hourly'), startOfHour(addHours(today, 1)).getTime(), 'supports hourly frequency')
    const custom = 3000
    assert.deepStrictEqual(getNext(custom), Date.now() + custom, 'supports custom frequency and does not return start')
    MockDate.reset()
    process.env.TZ = undefined
  }
})

it('getNext() on dates transitioning from Standard Time to DST', async () => {
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

    assert.deepStrictEqual(getNext('daily'), startOfDay(addDays(today, 1)).getTime(), 'supports daily frequency')
    assert.deepStrictEqual(getNext('hourly'), startOfHour(addHours(today, 1)).getTime(), 'supports hourly frequency')
    const custom = 3000
    assert.deepStrictEqual(getNext(custom), Date.now() + custom, 'supports custom frequency and does not return start')
    MockDate.reset()
    process.env.TZ = undefined
  }
})

it('getFileName()', async () => {
  const strFunc = () => 'my-func'
  assert.throws(getFileName, 'throws on empty input')
  assert.strictEqual(getFileName('my-file'), 'my-file', 'returns string when string given')
  assert.strictEqual(getFileName(strFunc), 'my-func', 'invokes function when function given')
})

it('buildFileName()', async () => {
  const ext = '.json'
  assert.throws(buildFileName, 'throws on empty input')
  assert.strictEqual(buildFileName('my-file'), 'my-file.1', 'appends 1 by default')
  assert.strictEqual(buildFileName(() => 'my-func'), 'my-func.1', 'appends 1 by default')
  assert.strictEqual(buildFileName('my-file', null, 5, ext), 'my-file.5.json', 'appends number and extension')
  assert.strictEqual(buildFileName('my-file', '2024-09-26'), 'my-file.2024-09-26.1', 'appends date')
  assert.strictEqual(buildFileName('my-file', '2024-09-26-07'), 'my-file.2024-09-26-07.1', 'appends date and hour')
  assert.strictEqual(buildFileName('my-file', '2024-09-26', 5), 'my-file.2024-09-26.5', 'appends date and number')
  assert.strictEqual(buildFileName('my-file', '2024-09-26', 5, ext), 'my-file.2024-09-26.5.json', 'appends date, number and extension')
})

it('identifyLogFiles()', async () => {
  const ext = 'json'
  let b
  b = buildFileName('my-file', null, 5, ext)
  assert.strictEqual(b, identifyLogFile(b, 'my-file', null, ext).fileName, 'number + ext')
  b = buildFileName('my-file', null, 5, undefined)
  assert.strictEqual(b, identifyLogFile(b, 'my-file', null, null).fileName, 'number only')
  b = buildFileName('my-file', '2024-09-26')
  assert.strictEqual(b, identifyLogFile(b, 'my-file', 'yyyy-MM-dd').fileName, 'number(start)+date')
  b = buildFileName('my-file', '2024-09-26-07')
  assert.strictEqual(b, identifyLogFile(b, 'my-file', 'yyyy-MM-dd-hh').fileName, 'number(start)+date (hourly)')
  b = buildFileName('my-file', '2024-09-26', 5)
  assert.strictEqual(b, identifyLogFile(b, 'my-file', 'yyyy-MM-dd').fileName, 'number+date')
  b = buildFileName('my-file', '2024-09-26', 5, ext)
  assert.strictEqual(b, identifyLogFile(b, 'my-file', 'yyyy-MM-dd', ext).fileName, 'number+date+extension')
  b = buildFileName('my-file', '2024-09-26', 5, '.json')
  assert.strictEqual(b, identifyLogFile(b, 'my-file', 'yyyy-MM-dd', '.json').fileName, 'number+date+extension(with dot suffix)')
  b = buildFileName('my-file', '2024-09-31', '5a', ext)
  b = buildFileName('my-file', '2024-09-31', 5, ext)
  assert.ok(!identifyLogFile(b, 'my-file', 'yyyy-MM-dd', ext).fileName, 'number+invalid date+extension')
  b = buildFileName('my-file', '2024-09-26', 5, 'notMyExtension')
  assert.ok(!identifyLogFile(b, 'my-file', 'yyyy-MM-dd', ext), 'number+date+invalid extension')
  assert.ok(!identifyLogFile('my-file.log', 'my-file'), 'invalid number in file name')
  assert.ok(!identifyLogFile('not any file can be log.txt', 'my-file'), 'invalid base file name')
  assert.ok(!identifyLogFile('my-file.extrasegment.txt', 'my-file'), 'unequal segment with expected')
})

it('validateDateFormat()', async () => {
  assert.strictEqual(validateDateFormat('2024-09-26'), true, 'returns null on valid date format')
  assert.strictEqual(validateDateFormat('2024-09-26-10'), true, 'returns null on valid date time format')
  assert.throws(() => validateDateFormat('2024:09:26'), 'throws on invalid date format with semicolon')
  assert.throws(() => validateDateFormat('2024*09*26'), 'throws on invalid date format with asterisk')
  assert.throws(() => validateDateFormat('2024<09>26'), 'throws on invalid date format with <>')
})

it('parseDate()', async () => {
  const today = new Date()
  const frequencySpec = { frequency: 'hourly', start: startOfHour(today).getTime(), next: startOfHour(addHours(today, 1)).getTime() }
  assert.strictEqual(parseDate(null, frequencySpec), null, 'returns null on empty format')
  assert.strictEqual(parseDate('yyyy-MM-dd-hh', frequencySpec, true), format(frequencySpec.start, 'yyyy-MM-dd-hh'), 'parse start date time')
  assert.strictEqual(parseDate('yyyy-MM-dd-hh', frequencySpec), format(frequencySpec.next, 'yyyy-MM-dd-hh'), 'parse next date time')
  assert.throws(() => parseDate('yyyy-MM-dd-hhU', frequencySpec), 'throws on invalid date format with character U')
  assert.throws(() => parseDate('yyyy-MM-dd-hhJ', frequencySpec), 'throws on invalid date format with character J')
})

describe('getFileSize()', () => {
  let folder
  beforeEach(() => {
    folder = createTempTestDir()
  })

  it('given an existing file', async () => {
    const fileName = join(folder, 'file.log')
    await writeFile(fileName, '123')

    assert.strictEqual(await getFileSize(fileName), 3, 'detects size of existing file')
  })

  it('given a non existing file', async () => {
    const fileName = join(folder, 'file.log')
    assert.strictEqual(await getFileSize(fileName), 0, 'set current size to 0 with non existing file')
  })
})

describe('detectLastNumber()', () => {
  let folder
  beforeEach(() => {
    folder = createTempTestDir()
  })

  it('given existing files', async () => {
    const fileName = join(folder, 'file.5')
    const fileNameFunc = () => fileName
    await writeFile(join(folder, 'file.1'), '')
    await writeFile(join(folder, 'file.5'), '')
    await writeFile(join(folder, 'file.10'), '')
    await writeFile(join(folder, 'file.7'), '')
    assert.strictEqual(await detectLastNumber(fileName), 10, 'detects highest existing number')
    assert.strictEqual(await detectLastNumber(fileNameFunc), 10, 'detects highest existing number when given func')
  })

  it('given existing files and a time', async () => {
    const fileName = join(folder, 'file.5')
    await writeFile(join(folder, 'file.9'), '')
    await writeFile(join(folder, 'file.10'), '')
    await sleep(100)
    await writeFile(join(folder, 'file.2'), '', { flush: true })
    await writeFile(join(folder, 'file.3'), '', { flush: true })
    const { birthtimeMs } = await stat(join(folder, 'file.2'))
    assert.strictEqual(await detectLastNumber(fileName, birthtimeMs - 150), 10, 'considers files after provided time')
    assert.strictEqual(await detectLastNumber(fileName, birthtimeMs), 3, 'ignores files older than time')
    assert.strictEqual(await detectLastNumber(fileName, Date.now()), 1, 'ignores all files older than time')
  })

  it('given existing files with a time with extension', async () => {
    const fileName = join(folder, 'file.5.log')
    await writeFile(join(folder, 'file.9.log'), '')
    await writeFile(join(folder, 'file.10.log'), '')
    await writeFile(join(folder, 'file.11'), '')
    await sleep(100)
    await writeFile(join(folder, 'file.2.log'), '', { flush: true })
    await writeFile(join(folder, 'file.3.log'), '', { flush: true })
    const { birthtimeMs } = await stat(join(folder, 'file.2.log'))
    assert.strictEqual(await detectLastNumber(fileName, birthtimeMs - 150, 'log'), 10, 'considers only files with extension after provided time')
    assert.strictEqual(await detectLastNumber(fileName, birthtimeMs - 150, '.log'), 10, 'normalizes extension with dot prefix')
    assert.strictEqual(await detectLastNumber(fileName, birthtimeMs, 'log'), 3, 'ignores files older than time')
    assert.strictEqual(await detectLastNumber(fileName, birthtimeMs, '.log'), 3, 'normalizes extension with dot prefix')
    assert.strictEqual(await detectLastNumber(fileName, Date.now(), 'log'), 1, 'ignores all files older than time')
    assert.strictEqual(await detectLastNumber(fileName, Date.now(), '.log'), 1, 'ignores all files older than time')
  })

  it('given files without numbers', async () => {
    await writeFile(join(folder, 'file'), '')
    await writeFile(join(folder, 'file.5'), '')
    assert.strictEqual(await detectLastNumber(join(folder, 'file')), 5, 'ignores them')
  })

  it('given an empty folder', async () => {
    assert.strictEqual(await detectLastNumber(join(folder, 'file')), 1, 'returns 1')
  })

  it('given no folder', async () => {
    await rm(folder, { force: true, recursive: true })
    assert.strictEqual(await detectLastNumber(join(folder, 'file')), 1, 'returns 1')
  })
})

it('validateLimitOptions()', async () => {
  assert.doesNotThrow(() => validateLimitOptions(), 'allows no limit')
  assert.doesNotThrow(() => validateLimitOptions({ count: 2 }), 'allows valid count')
  assert.throws(() => validateLimitOptions(true), { message: 'limit must be an object' }, 'throws when limit is not an object')
  assert.throws(() => validateLimitOptions({ count: [] }), { message: 'limit.count must be a number greater than 0' }, 'throws when limit.count is not an number')
  assert.throws(() => validateLimitOptions({ count: -2 }), { message: 'limit.count must be a number greater than 0' }, 'throws when limit.count is negative')
  assert.throws(() => validateLimitOptions({ count: 0 }), { message: 'limit.count must be a number greater than 0' }, 'throws when limit.count is 0')
  assert.throws(() => validateLimitOptions({ count: 2, removeOtherLogFiles: 2 }), { message: 'limit.removeOtherLogFiles must be boolean' }, 'throws when limit.removeOtherLogFiles is not boolean')
  assert.throws(() => validateLimitOptions({ count: 2, removeOtherLogFiles: [] }), { message: 'limit.removeOtherLogFiles must be boolean' }, 'throws when limit.removeOtherLogFiles is not boolean')
  assert.throws(() => validateLimitOptions({ count: 2, removeOtherLogFiles: {} }), { message: 'limit.removeOtherLogFiles must be boolean' }, 'throws when limit.removeOtherLogFiles is not boolean')
  assert.throws(() => validateLimitOptions({ count: 2, removeOtherLogFiles: 'ok' }), { message: 'limit.removeOtherLogFiles must be boolean' }, 'throws when limit.removeOtherLogFiles is not boolean')
})

describe('checkSymlink()', { skip: process.platform === 'win32' }, () => {
  let folder, other
  beforeEach(async () => {
    folder = createTempTestDir()
    other = join(folder, 'other')
    await require('fs/promises').mkdir(other, { recursive: true })
  })

  it('given a new symlink (should return true)', async () => {
    const fileName = join(folder, 'file.log')
    const linkPath = join(folder, 'current.log')
    await writeFile(fileName, 'test content')
    const result = await checkSymlink(fileName, linkPath)
    assert.strictEqual(result, true, 'returns true when symlink does not exist')
  })

  it('given an existing symlink pointing to the same file (should return false)', async () => {
    const fileName = join(folder, 'file.log')
    const linkPath = join(folder, 'current.log')
    await writeFile(fileName, 'test content')
    await symlink(fileName, linkPath)
    const result = await checkSymlink(fileName, linkPath)
    assert.strictEqual(result, false, 'returns false when symlink points to the same file')
    const linkTarget = await readlink(linkPath)
    assert.strictEqual(linkTarget, fileName, 'symlink remains unchanged')
  })

  it('given a new symlink pointing to a different folder (should return true)', async () => {
    const linkPath = join(folder, 'current.log')
    const fileName = join(other, 'file.log')
    await writeFile(fileName, 'test content')
    const result = await checkSymlink(fileName, linkPath)
    assert.strictEqual(result, true, 'returns true when symlink does not exist')
  })

  it('given a symlink pointing to a different folder (should return false)', async () => {
    const linkPath = join(folder, 'current.log')
    const fileName = join(other, 'file.log')
    await writeFile(fileName, 'test content')
    await symlink(fileName, linkPath)
    const result = await checkSymlink(fileName, linkPath)
    assert.strictEqual(result, false, 'returns false when symlink points to a different folder')
  })
})

describe('createSymlink()', { skip: process.platform === 'win32' }, () => {
  let folder
  beforeEach(() => {
    folder = createTempTestDir()
  })

  it('given a new symlink (should create symlink)', async () => {
    const fileName = join(folder, 'file1.log')
    const linkPath = join(folder, 'current.log')
    await writeFile(fileName, 'test content')
    await createSymlink(fileName)
    const linkTarget = await readlink(linkPath)
    assert.strictEqual(linkTarget, extractFileName(fileName), 'creates correct symlink')
  })

  it('given there is already a symlink (should not create symlink)', async () => {
    const fileName = join(folder, 'file1.log')
    assert.strictEqual(false, await createSymlink(fileName), 'returns false when symlink already exists')
  })
})

describe('sanitizeFile()', () => {
  it('throws an error when no file name is provided', async () => {
    assert.throws(() => sanitizeFile(), 'should throw when called without arguments')
    assert.throws(() => sanitizeFile(null, 'ext'), 'should throw when file name is null, even if extension is provided')
    assert.throws(() => sanitizeFile(() => null), 'should throw when function returns null')
  })

  it('handles file name provided as a function', async () => {
    assert.deepStrictEqual(sanitizeFile(() => 'my-func'), { file: 'my-func', extension: 'log' }, 'should resolve the function output and append the default extension')
    assert.deepStrictEqual(sanitizeFile(() => './logs/my-func', 'ext'), { file: './logs/my-func', extension: 'ext' }, 'should resolve the function output and append the provided extension')
    assert.deepStrictEqual(sanitizeFile(() => './logs/my-func.json'), { file: './logs/my-func', extension: 'json' }, 'should resolve the function output and extract the existing extension')
    assert.deepStrictEqual(sanitizeFile(() => './logs/my-func.log', 'json'), { file: './logs/my-func', extension: 'json' }, 'should resolve the function output, remove the extension from the file and append the provided extension')
  })

  it('handles cases where an explicit extension is provided', async () => {
    assert.deepStrictEqual(sanitizeFile('./logs/', 'ext'), { file: './logs/app', extension: 'ext' }, 'should append the default file name and use the provided extension')
    assert.deepStrictEqual(sanitizeFile('./logs/my-file', '.ext'), { file: './logs/my-file', extension: '.ext' }, 'should keep file name unchanged and use the provided extension')
    assert.deepStrictEqual(sanitizeFile('./logs/my-file.log', '.ext'), { file: './logs/my-file', extension: '.ext' }, 'should remove the existing extension and append the provided extension')
  })

  it('handles cases where no extension is provided', async () => {
    assert.deepStrictEqual(sanitizeFile('./logs/'), { file: './logs/app', extension: 'log' }, 'should append the default file name and default extension')
    assert.deepStrictEqual(sanitizeFile('./logs/my-file'), { file: './logs/my-file', extension: 'log' }, 'should keep file name unchanged and append the default extension')
    assert.deepStrictEqual(sanitizeFile('./logs/my-file.json'), { file: './logs/my-file', extension: 'json' }, 'should extract the file extension and use the extracted extension')
  })

  it('handles files with multiple extensions', async () => {
    assert.deepStrictEqual(sanitizeFile('./logs/my-file.log.json'), { file: './logs/my-file.log', extension: 'json' }, 'should extract the last extension, keep the file name intact and append the extracted extension')
    assert.deepStrictEqual(sanitizeFile('./logs/my-file.log.ab.xyz', 'ext'), { file: './logs/my-file.log.ab', extension: 'ext' }, 'should remove the last extension, keep the file name intact and append provided extension')
    assert.deepStrictEqual(sanitizeFile('./logs/my-file.prod.log.', 'json'), { file: './logs/my-file.prod.log', extension: 'json' }, 'should remove trailing dot, keep the file name intact and append provided extension')
    assert.deepStrictEqual(sanitizeFile('./logs/my-file.prod.log.'), { file: './logs/my-file.prod.log', extension: 'log' }, 'should remove trailing dot and append default extension, rare case (handles rare `.log.log` case)')
  })
})

it('validateFileName()', async () => {
  assert.throws(() => validateFileName(), 'should throw when called without arguments')
  assert.throws(() => validateFileName(null), 'should throw when file name is null')
  assert.throws(() => validateFileName(() => null), 'should throw when function returns null')
  assert.throws(() => validateFileName('./logs/my-file||.log'), 'should throw when file name contains invalid characters')
  assert.throws(() => validateFileName(() => './logs/my<file?log'), 'should throw when function returns file name that contains invalid characters')
  assert.strictEqual(validateFileName('./logs/my-file.log'), true, 'should validate a correct file path as true')

  // Windows path validation tests
  // Valid Windows paths should pass
  assert.strictEqual(validateFileName('C:\\Users\\test\\logfile.log'), true, 'should validate Windows absolute path with drive letter')
  assert.strictEqual(validateFileName('D:\\projects\\app.log'), true, 'should validate Windows path with different drive letter')
  assert.strictEqual(validateFileName('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\pino-roll-test-QvV9cz\\logfile'), true, 'should validate Windows temp path with tilde')
  assert.strictEqual(validateFileName('C:\\Program Files (x86)\\app\\logs\\app.log'), true, 'should validate Windows path with spaces and parentheses')

  // Invalid characters in Windows paths should fail
  assert.throws(() => validateFileName('C:\\Users\\test<file.log'), 'should throw for Windows path with < character')
  assert.throws(() => validateFileName('C:\\Users\\test>file.log'), 'should throw for Windows path with > character')
  assert.throws(() => validateFileName('C:\\Users\\test|file.log'), 'should throw for Windows path with | character')
  assert.throws(() => validateFileName('C:\\Users\\test?file.log'), 'should throw for Windows path with ? character')
  assert.throws(() => validateFileName('C:\\Users\\test*file.log'), 'should throw for Windows path with * character')
  assert.throws(() => validateFileName('C:\\Users\\test"file.log'), 'should throw for Windows path with " character')

  // Invalid colon usage should fail (colons outside of drive letters)
  assert.throws(() => validateFileName('C:\\Users\\test:invalid.log'), 'should throw for colon in non-drive position')
  assert.throws(() => validateFileName('/tmp/test:file.log'), 'should throw for colon in Unix path')

  // Edge cases
  assert.strictEqual(validateFileName('C:'), true, 'should validate bare drive letter')
  assert.strictEqual(validateFileName('C:\\'), true, 'should validate root directory')
})
