'use strict'

const { once } = require('events')
const { stat, writeFile, readFile } = require('fs/promises')
const { join } = require('path')
const { test, beforeEach } = require('tap')

const { buildStream, cleanAndCreateFolder, sleep } = require('./utils')

const logFolder = join('logs', 'roll')

beforeEach(() => cleanAndCreateFolder(logFolder))

test('rotate file on size', async ({ ok, rejects }) => {
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
