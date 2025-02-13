'use strict'

const { once } = require('events')
const { stat, readFile, writeFile, readdir, lstat, readlink } = require('fs/promises')
const { join } = require('path')
const { test, beforeEach } = require('tap')
const { format } = require('date-fns')

const { buildStream, cleanAndCreateFolder, sleep } = require('./utils')
const { removeOldFiles } = require('../lib/utils')

const logFolder = join('logs', 'roll')

beforeEach(() => cleanAndCreateFolder(logFolder))

test('rotate file based on time', async ({ ok, notOk, rejects }) => {
  const file = join(logFolder, 'log')
  await sleep(100 - (Date.now() % 100))
  const stream = await buildStream({ frequency: 100, file })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await sleep(110)
  stream.write('logged message #3\n')
  stream.write('logged message #4\n')
  await sleep(110)
  stream.end()
  await stat(`${file}.1`)
  let content = await readFile(`${file}.1`, 'utf8')
  ok(content.includes('#1'), 'first file contains first log')
  ok(content.includes('#2'), 'first file contains second log')
  notOk(content.includes('#3'), 'first file does not contains third log')
  await stat(`${file}.2`)
  content = await readFile(`${file}.2`, 'utf8')
  ok(content.includes('#3'), 'second file contains third log')
  ok(content.includes('#4'), 'second file contains fourth log')
  notOk(content.includes('#2'), 'second file does not contains second log')
  await stat(`${file}.3`)
  rejects(stat(`${file}.4`), 'no other files created')
})

test('rotate file based on time and parse filename func', async ({ ok, notOk, rejects }) => {
  const file = join(logFolder, 'log')
  await sleep(100 - (Date.now() % 100))
  const fileFunc = () => `${file}-${format(new Date(), 'HH-mm-ss-SSS')}`
  const stream = await buildStream({ frequency: 100, file: fileFunc })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await sleep(110)
  stream.write('logged message #3\n')
  stream.write('logged message #4\n')
  await sleep(110)
  stream.end()
  const files = await readdir(logFolder)
  ok(files.length === 3, 'created three files')
})

test('rotate file based on size', async ({ ok, rejects }) => {
  const file = join(logFolder, 'log')
  const size = 20
  const stream = await buildStream({ size: `${size}b`, file })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await once(stream, 'ready')
  stream.write('logged message #3\n')
  let stats = await stat(`${file}.1`)
  ok(
    size <= stats.size && stats.size <= size * 2,
    `first file size: ${size} <= ${stats.size} <= ${size * 2}`
  )
  stats = await stat(`${file}.2`)
  ok(stats.size <= size, `second file size: ${stats.size} <= ${size}`)
  rejects(stat(`${file}.3`), 'no other files created')
})

test('resume writing in last file', async ({ equal, rejects }) => {
  const file = join(logFolder, 'log')
  const previousContent = '--previous content--\n'
  const newContent = 'logged message #1\n'
  await writeFile(`${file}.6`, previousContent)
  const size = 20
  const stream = await buildStream({ size: `${size}o`, file })
  stream.write(newContent)
  await sleep(10)

  equal(
    await readFile(`${file}.6`, 'utf8'),
    `${previousContent}${newContent}`,
    'old and new content were written'
  )
  rejects(stat(`${file}.1`), 'no other files created')
})

test('remove files based on count', async ({ ok, rejects }) => {
  const file = join(logFolder, 'log')
  const stream = await buildStream({
    size: '20b',
    file,
    limit: { count: 1 }
  })
  for (let i = 1; i <= 5; i++) {
    stream.write(`logged message #${i}\n`)
    await sleep(20)
  }
  stream.end()
  await stat(`${file}.2`)
  let content = await readFile(`${file}.2`, 'utf8')
  ok(content.includes('#3'), 'second file contains thrid log')
  ok(content.includes('#4'), 'second file contains fourth log')
  await stat(`${file}.3`)
  content = await readFile(`${file}.3`, 'utf8')
  ok(content.includes('#5'), 'third file contains fifth log')
  await rejects(stat(`${file}.1`), 'first file was deleted')
  await rejects(stat(`${file}.4`), 'no other files created')
})

test('removeOtherOldFiles()', async ({ ok, notOk }) => {
  const dateFormat = 'HH-mm-ss-S'
  const notLogFile = 'notLogFile'
  await writeFile(join(logFolder, notLogFile), 'not a log file')
  let now = new Date()
  now = new Date(now.getTime() - now.getTime() % 100)
  const file0 = `log.${format(now, dateFormat)}`
  await writeFile(join(logFolder, `${file0}.1`), 'Content log 0.1')
  const file1 = `log.${format(new Date(now.getTime() + 100), dateFormat)}`
  await writeFile(join(logFolder, `${file1}.1`), 'Content log 1.1')
  await writeFile(join(logFolder, `${file1}.2`), 'Content log 1.2')
  const file2 = `log.${format(new Date(now.getTime() + 200), dateFormat)}`
  await writeFile(join(logFolder, `${file2}.1`), 'Content log 2.1')

  await removeOldFiles({ baseFile: join(logFolder, 'log'), count: 2, removeOtherLogFiles: true, dateFormat })
  let files = await readdir(logFolder)
  notOk(files.includes(`${file0}.1`), 'first run: fourth recent file is removed')
  notOk(files.includes(`${file1}.1`), 'first run: third recent file is removed')
  ok(files.includes(`${file1}.2`), 'first run: second recent file is not removed')
  ok(files.includes(`${file2}.1`), 'first run: most recent file is not removed')
  ok(files.includes(notLogFile), 'first run: non log file is not removed')

  await removeOldFiles({ baseFile: join(logFolder, 'log'), count: 2, removeOtherLogFiles: true, dateFormat })
  files = await readdir(logFolder)
  notOk(files.includes(`${file0}.1`), 'second run: fourth recent file is removed')
  notOk(files.includes(`${file1}.1`), 'second run: third recent file is removed')
  ok(files.includes(`${file1}.2`), 'second run: second recent file is not removed')
  ok(files.includes(`${file2}.1`), 'second run: most recent file is not removed')
  ok(files.includes(notLogFile), 'second run: non log file is not removed')
})

test('do not remove pre-existing file when removing files based on count', async ({
  ok,
  equal,
  rejects
}) => {
  const file = join(logFolder, 'log')
  await writeFile(`${file}.1`, 'oldest content')
  await writeFile(`${file}.2`, 'old content')
  const stream = await buildStream({
    size: '20b',
    file,
    limit: { count: 2 }
  })
  for (let i = 1; i <= 6; i++) {
    stream.write(`logged message #${i}\n`)
    await sleep(20)
  }
  stream.end()
  await stat(`${file}.1`)
  let content = await readFile(`${file}.1`, 'utf8')
  equal(content, 'oldest content', 'oldest file was not touched')
  await stat(`${file}.3`)
  content = await readFile(`${file}.3`, 'utf8')
  ok(content.includes('#3'), 'second file contains third log')
  await stat(`${file}.4`)
  content = await readFile(`${file}.4`, 'utf8')
  ok(content.includes('#4'), 'third file contains fourth log')
  ok(content.includes('#5'), 'third file contains fifth log')
  await stat(`${file}.5`)
  content = await readFile(`${file}.5`, 'utf8')
  ok(content.includes('#6'), 'fourth file contains sixth log')
  await rejects(stat(`${file}.2`), 'resumed file was deleted')
  await rejects(stat(`${file}.6`), 'no other files created')
})

test('remove pre-existing log files when removing files based on count when limit.removeOtherLogFiles', async ({
  ok,
  rejects
}) => {
  const dateFormat = 'HH-mm-ss'
  await sleep(1000 - (Date.now() % 1000))
  let now = new Date()
  now = new Date(now.getTime() - now.getTime() % 500)
  const prev = new Date(now.getTime() - 500)
  const prevFile = join(logFolder, `log.${format(prev, dateFormat)}`)
  const notLogFileName = join(logFolder, 'notLogFile')
  await writeFile(notLogFileName, 'not a log file')
  await writeFile(`${prevFile}.1`, 'previous content')
  const file1 = join(logFolder, `log.${format(new Date(now.getTime()), dateFormat)}`)
  const file2 = join(logFolder, `log.${format(new Date(now.getTime() + 1500), dateFormat)}`)
  await writeFile(`${file1}.1`, 'oldest content')
  const stream = await buildStream({
    dateFormat,
    file: join(logFolder, 'log'),
    frequency: 500,
    limit: { count: 2, removeOtherLogFiles: true }
  })
  for (let i = 1; i <= 3; i++) {
    stream.write(`logged message #${i}\n`)
    if (i < 3) await sleep(550)
  }
  stream.end()
  rejects(stat(`${prevFile}.1`), 'oldest file was deleted')
  let content = await readFile(notLogFileName, 'utf8')
  ok(content.includes('not a log file'), 'non-log file is untouched')
  content = await readFile(`${file1}.2`, 'utf8')
  ok(content.includes('#2'), 'TS1 - 2 file contains second log')
  content = await readFile(`${file2}.1`, 'utf8')
  ok(content.includes('#3'), 'TS2 - 1 file contains third log')
  rejects(stat(`${file2}.2`), 'no other files created')
})

test('throw on missing file parameter', async ({ rejects }) => {
  rejects(
    buildStream(),
    { message: 'No file name provided' },
    'throws on missing file parameters'
  )
})

test('throw on unexisting folder without mkdir', async ({ rejects }) => {
  const file = join('unknown', 'folder', 'file')
  rejects(
    buildStream({ file }),
    { message: `ENOENT: no such file or directory, open '${file}.1'` },
    'throws on unexisting folder'
  )
})

test('throw on unparseable size', async ({ rejects }) => {
  const size = 'unparseable'
  rejects(
    buildStream({ file: join(logFolder, 'log'), size }),
    { message: `${size} is not a valid size in KB, MB or GB` },
    'throws on unparseable size'
  )
})

test('throw on unparseable frequency', async ({ rejects }) => {
  const frequency = 'unparseable'
  rejects(
    buildStream({ file: join(logFolder, 'log'), frequency }),
    {
      message: `${frequency} is neither a supported frequency or a number of milliseconds`
    },
    'throws on unparseable frequency'
  )
})

test('throw on unparseable limit object', async ({ rejects }) => {
  rejects(
    buildStream({ file: join(logFolder, 'log'), limit: 10 }),
    {
      message: 'limit must be an object'
    },
    'throws on limit option not being an object'
  )
})

test('throw when limit.count is not a number', async ({ rejects }) => {
  rejects(
    buildStream({ file: join(logFolder, 'log'), limit: { count: true } }),
    {
      message: 'limit.count must be a number greater than 0'
    },
    'throws on limit.count not being a number'
  )
})

test('throw when limit.count is 0', async ({ rejects }) => {
  rejects(
    buildStream({ file: join(logFolder, 'log'), limit: { count: 0 } }),
    {
      message: 'limit.count must be a number greater than 0'
    },
    'throws on limit.count being 0'
  )
})

test('creates symlink if prop is set', async ({ equal, resolves }) => {
  const file = join(logFolder, 'log')
  const linkPath = join(logFolder, 'current.log')
  const stream = await buildStream({ file, symlink: true })
  stream.write('test content\n')
  stream.end()
  await sleep(200)
  await resolves(lstat(linkPath), 'symlink was created')
  const linkTarget = await readlink(linkPath)
  equal(linkTarget, 'log.1', 'symlink points to the correct file')
  const content = await readFile(linkPath, 'utf8')
  equal(content, 'test content\n', 'symlink contains correct content')
})

test('symlink rotates on roll', async ({ equal, ok, resolves }) => {
  const file = join(logFolder, 'log')
  const linkPath = join(logFolder, 'current.log')
  await sleep(100 - (Date.now() % 100))
  const stream = await buildStream({ frequency: 100, file, symlink: true })
  stream.write('logged message #1\n')
  stream.write('logged message #2\n')
  await sleep(110)
  stream.write('logged message #3\n')
  stream.write('logged message #4\n')
  stream.end()
  await sleep(200)
  await resolves(lstat(linkPath), 'symlink was created')
  const linkTarget = await readlink(linkPath)
  equal(linkTarget, 'log.2', 'symlink points to the correct file')
  const content = await readFile(linkPath, 'utf8')
  ok(content.includes('#4'), 'symlink contains fourth log')
})
