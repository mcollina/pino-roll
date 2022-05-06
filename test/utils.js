'use strict'

const { once } = require('events')
const { mkdir, rm } = require('fs/promises')
const { promisify } = require('util')
const build = require('..')

async function buildStream (options) {
  const stream = await build(options)
  await once(stream, 'ready')
  return stream
}

async function cleanAndCreateFolder (path) {
  await rm(path, { force: true, recursive: true })
  await mkdir(path, { force: true, recursive: true })
}

module.exports = { buildStream, cleanAndCreateFolder, sleep: promisify(setTimeout) }
