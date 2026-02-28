'use strict'

const { join } = require('path')
const buildPinoRoll = require('../..')

module.exports = async function pinoRollDynamicTransport ({
  folder = 'logs',
  baseName = 'app',
  mkdir = true,
  ...rollOptions
} = {}) {
  const dateStamp = new Date().toISOString().slice(0, 10)
  const file = join(folder, `${baseName}-${dateStamp}`)

  return buildPinoRoll({ ...rollOptions, file, mkdir })
}
