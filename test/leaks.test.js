'use strict'
const { it } = require('node:test')
const assert = require('node:assert')
const build = require('..')
const { join } = require('path')
const { tmpdir } = require('os')
const { cleanAndCreateFolder } = require('./utils')

it('roll does not prevent process end', async () => {
  const logFolder = join(tmpdir(), 'pino-roll-tests', 'leaks')
  await cleanAndCreateFolder(logFolder)
  const stream = await build({ file: join(logFolder, 'logfile'), frequency: 100 })
  assert.ok(stream)
})
