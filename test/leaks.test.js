'use strict'
const { it } = require('node:test')
const assert = require('node:assert')
const build = require('..')
const { join } = require('path')
const { createTempTestDir } = require('./utils')

it('roll does not prevent process end', async () => {
  const logFolder = createTempTestDir()
  const stream = await build({ file: join(logFolder, 'logfile'), frequency: 100 })
  assert.ok(stream)
})
