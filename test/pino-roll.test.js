'use strict'

const { once } = require('events')
const { stat, readFile, writeFile } = require('fs/promises')
const { join } = require('path')
const { test, beforeEach } = require('tap')

const { buildStream, cleanAndCreateFolder, sleep } = require('./utils')

const logFolder = join('logs', 'roll')

beforeEach(() => cleanAndCreateFolder(logFolder))

test('rotate file based on time', async ({ ok, notOk, rejects }) => {
  const file = join(logFolder, 'log')
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
  ok(content.includes('#3'), 'first file contains third log')
  ok(content.includes('#4'), 'first file contains fourth log')
  notOk(content.includes('#2'), 'first file does not contains second log')
  await stat(`${file}.3`)
  rejects(stat(`${file}.4`), 'no other files created')
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

  equal(await readFile(`${file}.6`, 'utf8'), `${previousContent}${newContent}`, 'old and new content were written')
  rejects(stat(`${file}.1`), 'no other files created')
})

test('throw on missing file parameter', async ({ rejects }) => {
  rejects(buildStream(), { message: 'No file name provided' }, 'throws on missing file parameters')
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
    'throws on unexisting folder'
  )
})

test('throw on unparseable frequency', async ({ rejects }) => {
  const frequency = 'unparseable'
  rejects(
    buildStream({ file: join(logFolder, 'log'), frequency }),
    { message: `${frequency} is neither a supported frequency or a number of milliseconds` },
    'throws on unexisting folder'
  )
})
