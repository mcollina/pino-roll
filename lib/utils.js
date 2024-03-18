'use strict'

const { readdir, stat, unlink } = require('fs/promises')
const { dirname, join } = require('path')

function parseSize (size) {
  let multiplier = 1024 ** 2
  if (typeof size !== 'string' && typeof size !== 'number') {
    return null
  }
  if (typeof size === 'string') {
    const match = size.match(/^([\d.]+)(\w?)$/)
    if (match) {
      const unit = match[2]?.toLowerCase()
      size = +match[1]
      multiplier = unit === 'g' ? 1024 ** 3 : unit === 'k' ? 1024 : unit === 'b' ? 1 : 1024 ** 2
    } else {
      throw new Error(`${size} is not a valid size in KB, MB or GB`)
    }
  }
  return size * multiplier
}

function parseFrequency (frequency) {
  const today = new Date()
  if (frequency === 'daily') {
    const start = today.setHours(0, 0, 0, 0)
    return { frequency, start, next: getNextDay(start) }
  }
  if (frequency === 'hourly') {
    const start = today.setMinutes(0, 0, 0)
    return { frequency, start, next: getNextHour(start) }
  }
  if (typeof frequency === 'number') {
    return { frequency, next: getNextCustom(frequency) }
  }
  if (frequency) {
    throw new Error(`${frequency} is neither a supported frequency or a number of milliseconds`)
  }
  return null
}

function validateLimitOptions (limit) {
  if (limit) {
    if (typeof limit !== 'object') {
      throw new Error('limit must be an object')
    }
    if (typeof limit.count !== 'number' || limit.count <= 0) {
      throw new Error('limit.count must be a number greater than 0')
    }
  }
}

function getNextDay (start) {
  return new Date(start + 24 * 60 * 60 * 1000).setHours(0, 0, 0, 0)
}

function getNextHour (start) {
  return new Date(start + 60 * 60 * 1000).setMinutes(0, 0, 0)
}

function getNextCustom (frequency) {
  return Date.now() + frequency
}

function getNext (frequency) {
  if (frequency === 'daily') {
    return getNextDay(new Date().setHours(0, 0, 0, 0))
  }
  if (frequency === 'hourly') {
    return getNextHour(new Date().setMinutes(0, 0, 0))
  }
  return getNextCustom(frequency)
}

function getFileName (fileVal) {
  if (!fileVal) {
    throw new Error('No file name provided')
  }
  return typeof fileVal === 'function' ? fileVal() : fileVal
}

function buildFileName (fileVal, lastNumber = 1, extension) {
  return `${getFileName(fileVal)}.${lastNumber}${extension ?? ''}`
}

async function detectLastNumber (fileVal, time = null) {
  const fileName = getFileName(fileVal)
  try {
    const numbers = await readFileTrailingNumbers(dirname(fileName), time)
    return numbers.sort((a, b) => b - a)[0]
  } catch {
    return 1
  }
}

async function readFileTrailingNumbers (folder, time) {
  const numbers = [1]
  for (const file of await readdir(folder)) {
    if (time && !(await isMatchingTime(join(folder, file), time))) {
      continue
    }
    const number = extractTrailingNumber(file)
    if (number) {
      numbers.push(number)
    }
  }
  return numbers
}

function extractTrailingNumber (fileName) {
  const match = fileName.match(/(\d+)$/)
  return match ? +match[1] : null
}

async function isMatchingTime (filePath, time) {
  const { birthtimeMs } = await stat(filePath)
  return birthtimeMs >= time
}

async function checkFileRemoval (files, { count }) {
  if (files.length > count) {
    const filesToRemove = files.splice(0, files.length - 1 - count)
    await Promise.allSettled(filesToRemove.map(file => unlink(file)))
  }
  return files
}

module.exports = {
  buildFileName,
  checkFileRemoval,
  detectLastNumber,
  parseFrequency,
  getNext,
  parseSize,
  getFileName,
  validateLimitOptions
}
