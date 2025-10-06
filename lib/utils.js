'use strict'

const { readdir, stat, unlink, symlink, lstat, readlink } = require('fs/promises')
const { dirname, join } = require('path')
const { format, addDays, addHours, parse, isValid } = require('date-fns')
const { promisify } = require('util')

const sleep = promisify(setTimeout)

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
    const start = today.getTime() - today.getTime() % frequency
    return { frequency, start, next: getNextCustom(frequency) }
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
    if (typeof limit.removeOtherLogFiles !== 'undefined' && typeof limit.removeOtherLogFiles !== 'boolean') {
      throw new Error('limit.removeOtherLogFiles must be boolean')
    }
  }
}

function getNextDay (start) {
  return addDays(new Date(start), 1).setHours(0, 0, 0, 0)
}

function getNextHour (start) {
  return addHours(new Date(start), 1).setMinutes(0, 0, 0)
}

function getNextCustom (frequency) {
  const time = Date.now()
  return time - time % frequency + frequency
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

function buildFileName (fileVal, date, lastNumber = 1, extension) {
  const dateStr = date ? `.${date}` : ''
  const extensionStr = typeof extension !== 'string' ? '' : extension.startsWith('.') ? extension : `.${extension}`
  return `${getFileName(fileVal)}${dateStr}.${lastNumber}${extensionStr}`
}

function identifyLogFile (checkedFileName, fileVal, dateFormat, extension) {
  const baseFileNameStr = getFileName(fileVal)
  if (!checkedFileName.startsWith(baseFileNameStr)) return false
  const checkFileNameSegments = checkedFileName
    .slice(baseFileNameStr.length + 1)
    .split('.')
  let expectedSegmentCount = 1
  if (typeof dateFormat === 'string' && dateFormat.length > 0) expectedSegmentCount++
  if (typeof extension === 'string' && extension.length > 0) expectedSegmentCount++
  const extensionStr = typeof extension !== 'string' ? '' : extension.startsWith('.') ? extension.slice(1) : extension
  if (checkFileNameSegments.length !== expectedSegmentCount) return false
  if (extensionStr.length > 0) {
    const chkExtension = checkFileNameSegments.pop()
    if (extensionStr !== chkExtension) return false
  }
  const chkFileNumber = checkFileNameSegments.pop()
  const fileNumber = Number(chkFileNumber)
  if (!Number.isInteger(fileNumber)) {
    return false
  }
  let fileTime = 0
  if (typeof dateFormat === 'string' && dateFormat.length > 0) {
    const d = parse(checkFileNameSegments[0], dateFormat, new Date())
    if (!isValid(d)) return false
    fileTime = d.getTime()
  }
  return { fileName: checkedFileName, fileTime, fileNumber }
}

async function getFileSize (filePath) {
  try {
    const fileStats = await stat(filePath)
    return fileStats.size
  } catch {
    return 0
  }
}

async function detectLastNumber (fileVal, time = null, fileExtension = '') {
  const fileName = getFileName(fileVal)
  try {
    const numbers = await readFileTrailingNumbers(dirname(fileName), time, fileExtension)
    return numbers.sort((a, b) => b - a)[0]
  } catch {
    return 1
  }
}

async function readFileTrailingNumbers (folder, time, fileExtension) {
  const numbers = [1]
  for (const file of await readdir(folder)) {
    if (time && !(await isMatchingTime(join(folder, file), time))) {
      continue
    }
    const number = extractTrailingNumber(file, fileExtension)
    if (number) {
      numbers.push(number)
    }
  }
  return numbers
}

function extractTrailingNumber (fileName, fileExtension) {
  let normalizedFileExtension = fileExtension
  if (fileExtension && !fileExtension.startsWith('.')) {
    normalizedFileExtension = '.' + fileExtension
  }

  const extLength = normalizedFileExtension.length
  if (extLength > 0 && !fileName.endsWith(normalizedFileExtension)) {
    return null
  }
  const fileNameWithoutExtension = fileName.slice(0, fileName.length - extLength)
  const match = fileNameWithoutExtension.match(/(\d+)$/)
  return match ? +match[1] : null
}

function extractFileName (fileName) {
  return fileName.split(/(\\|\/)/g).pop()
}

async function isMatchingTime (filePath, time) {
  const { birthtimeMs } = await stat(filePath)
  return birthtimeMs >= time
}

/**
 * Retry unlink operation for Windows compatibility
 * Windows can fail to delete files if they're still being accessed
 */
async function unlinkWithRetry (filePath, maxRetries = 30, retryDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await unlink(filePath)
      return
    } catch (error) {
      if (attempt === maxRetries - 1) {
        // Last attempt failed, log and throw the error
        console.error(`Failed to delete file ${filePath} after ${maxRetries} attempts:`, error.message)
        throw error
      }
      // Log retry attempt
      console.warn(`Failed to delete file ${filePath} (attempt ${attempt + 1}/${maxRetries}), retrying in ${retryDelay}ms...`)
      // Wait 1 second before retrying
      await sleep(retryDelay)
    }
  }
}

async function removeOldFiles ({ count, removeOtherLogFiles, baseFile, dateFormat, extension, createdFileNames, newFileName }) {
  if (!removeOtherLogFiles) {
    createdFileNames.push(newFileName)
    if (createdFileNames.length > count) {
      const filesToRemove = createdFileNames.splice(0, createdFileNames.length - 1 - count)
      await Promise.allSettled(filesToRemove.map(file => unlinkWithRetry(file)))
    }
  } else {
    let files = []
    const pathSegments = getFileName(baseFile).split(/(\\|\/)/g)
    const baseFileNameStr = pathSegments.pop()
    for (const fileEntry of await readdir(join(...pathSegments))) {
      const f = identifyLogFile(fileEntry, baseFileNameStr, dateFormat, extension)
      if (f) {
        files.push(f)
      }
    }
    files = files.sort((i, j) => {
      if (i.fileTime === j.fileTime) {
        return i.fileNumber - j.fileNumber
      }
      return i.fileTime - j.fileTime
    })
    if (files.length > count) {
      await Promise.allSettled(
        files
          .slice(0, files.length - count)
          .map(file => unlinkWithRetry(join(...pathSegments, file.fileName)))
      )
    }
  }
}

async function checkSymlink (fileName, linkPath) {
  const stats = await lstat(linkPath).then(stats => stats, () => null)
  if (stats?.isSymbolicLink()) {
    const existingTarget = await readlink(linkPath)
    if (extractFileName(existingTarget) === extractFileName(fileName)) {
      return false
    }
    await unlink(linkPath)
  }
  return true
}

async function createSymlink (fileVal) {
  const linkPath = join(dirname(fileVal), 'current.log')
  const shouldCreateSymlink = await checkSymlink(fileVal, linkPath)
  if (shouldCreateSymlink) {
    await symlink(extractFileName(fileVal), linkPath)
  }
  return false
}

function validateDateFormat (formatStr) {
  const invalidChars = /[/\\?%*:|"<>]/g
  if (invalidChars.test(formatStr)) {
    throw new Error(`${formatStr} contains invalid characters`)
  }
  return true
}

function parseDate (formatStr, frequencySpec, parseStart = false) {
  if (!(formatStr && frequencySpec?.start && frequencySpec.next)) return null

  try {
    return format(parseStart ? frequencySpec.start : frequencySpec.next, formatStr)
  } catch (error) {
    throw new Error(`${formatStr} must be a valid date format`)
  }
}

// to implement the default file fallback feature
function sanitizeFile (file, extension) {
  if (typeof file === 'function') {
    file = file()
  }
  if (!file) {
    throw new Error('No file name provided')
  }

  // defining default file name values
  const FALLBACK_FILENAME = 'app'
  const FALLBACK_EXTENSION = 'log'

  const currentFileName = extractFileName(file)
  if (!currentFileName || currentFileName === '') {
    file += FALLBACK_FILENAME
  }

  // only removing the last extension, (to support exact file pattern and multiple ext like app.prod.log)
  let currentFileExtension = ''
  if (currentFileName.includes('.')) {
    const fileParts = file.split('.')
    currentFileExtension = fileParts.pop()
    file = fileParts.join('.')
  }

  if (!extension && !currentFileExtension) {
    extension = FALLBACK_EXTENSION
  } else if (!extension && currentFileExtension.length > 1) {
    extension = currentFileExtension
  }
  return { file, extension }
}

// to validate and reject characters that are not allowed in file paths (cross-platform safe set, based on Windows restrictions)
function validateFileName (filepath) {
  if (typeof filepath === 'function') {
    filepath = filepath()
  }
  if (!filepath) {
    throw new Error('No file name provided')
  }

  // For full file paths, we need to be more permissive than for filenames alone
  // Allow colons for Windows drive letters (C:, D:, etc.) but reject them elsewhere
  // Allow path separators (/ and \)
  // Still reject truly dangerous characters: < > " | ? * and control characters

  // Handle Windows drive letters by temporarily replacing them to avoid false positives
  let pathToCheck = filepath
  const driveLetterMatch = filepath.match(/^[A-Za-z]:/)
  if (driveLetterMatch) {
    // Replace drive letter (e.g., "C:") with placeholder to avoid colon detection
    pathToCheck = filepath.replace(/^[A-Za-z]:/, '[DRIVE]')
  }

  // Check for invalid characters
  // Exclude colons from this check since we handled drive letters above
  const invalidChars = /[<>"|?*\0]/g
  if (invalidChars.test(pathToCheck)) {
    throw new Error(`File name contains invalid characters: ${filepath}`)
  }

  // Check for any remaining colons (which would be invalid since drive letters were handled)
  if (pathToCheck.includes(':')) {
    throw new Error(`File name contains invalid characters: ${filepath}`)
  }
  return true
}

module.exports = {
  buildFileName,
  identifyLogFile,
  removeOldFiles,
  checkSymlink,
  createSymlink,
  detectLastNumber,
  extractFileName,
  parseFrequency,
  getNext,
  parseSize,
  getFileName,
  getFileSize,
  validateLimitOptions,
  parseDate,
  validateDateFormat,
  sanitizeFile,
  validateFileName
}
