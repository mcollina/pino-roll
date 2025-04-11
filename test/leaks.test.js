'use strict'
const { test, setTimeout, ok } = require('tap')
const build = require('..')
const { join } = require('path')
const { cleanAndCreateFolder } = require('./utils')

test('roll does not prevent process end', async (t) => {
  const logFolder = join('logs', 'leaks')
  await cleanAndCreateFolder(logFolder)
  const stream = await build({ file: join(logFolder, 'logfile'), frequency: 100 })
  ok(stream)
}).finally(() => setTimeout(1000))
