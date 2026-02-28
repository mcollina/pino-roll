'use strict'

const { join } = require('path')
const build = require('..')

module.exports = async function customPinoRollTransport ({ folder, prefix = 'app', ...options } = {}) {
  const now = new Date()
  const dateStamp = now.toISOString().slice(0, 10)
  const file = join(folder, `${prefix}-${dateStamp}`)

  return build({ ...options, file })
}
