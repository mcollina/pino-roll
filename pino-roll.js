'use strict'

const SonicBoom = require('sonic-boom')
const {
  buildFileName,
  checkFileRemoval,
  detectLastNumber,
  parseSize,
  parseFrequency,
  getNext,
  getFileSize,
  validateLimitOptions
} = require('./lib/utils')

/**
 * A function that returns a string path to the base file name
 *
 * @typedef {function} LogFilePath
 * @returns {string}
 */

/**
 * @typedef {object} Options
 *
 * @property {string|LogFilePath} file - Absolute or relative path to the log file.
 * Your application needs the write right on the parent folder.
 * Number will be appended to this file name.
 * When the parent folder already contains numbered files, numbering will continue based on the highest number.
 * If this path does not exist, the logger with throw an error unless you set `mkdir` to `true`.
 *
 * @property {string|number} size? - When specified, the maximum size of a given log file.
 * Can be combined with frequency.
 * Use 'k', 'm' and 'g' to express values in KB, MB or GB.
 * Numerical values will be considered as MB.
 *
 * @property {string|number} frequency? - When specified, the amount of time a given log file is used.
 * Can be combined with size.
 * Use 'daily' or 'hourly' to rotate file every day (or every hour).
 * Existing file within the current day (or hour) will be re-used.
 * Numerical values will be considered as a number of milliseconds.
 * Using a numerical value will always create a new file upon startup.
 *
 * @property {string} extension? - When specified, appends a file extension after the file number.
 *
 * @property {LimitOptions} limit? - strategy used to remove oldest files when rotating them.
 */

/**
 * @typedef {object} LimitOptions
 *
 * @property {number} count? -number of log files, **in addition to the currently used file**.
 */

/**
 * @typedef {Options & import('sonic-boom').SonicBoomOpts} PinoRollOptions
 */

/**
 * Creates a Pino transport (a Sonic-boom stream) to writing into files.
 * Automatically rolls your files based on a given frequency, size, or both.
 *
 * @param {PinoRollOptions} options - to configure file destionation, and rolling rules.
 * @returns {SonicBoom} the Sonic boom steam, usabled as Pino transport.
 */
module.exports = async function ({
  file,
  size,
  frequency,
  extension,
  limit,
  ...opts
} = {}) {
  validateLimitOptions(limit)
  const frequencySpec = parseFrequency(frequency)

  let number = await detectLastNumber(file, frequencySpec?.start)

  let fileName = buildFileName(file, number, extension)
  const createdFileNames = [fileName]
  let currentSize = await getFileSize(fileName)
  const maxSize = parseSize(size)

  const destination = new SonicBoom({ ...opts, dest: fileName })

  let rollTimeout
  if (frequencySpec) {
    destination.once('close', () => {
      clearTimeout(rollTimeout)
    })
    scheduleRoll()
  }

  if (maxSize) {
    destination.on('write', writtenSize => {
      currentSize += writtenSize
      if (fileName === destination.file && currentSize >= maxSize) {
        currentSize = 0
        fileName = buildFileName(file, ++number, extension)
        // delay to let the destination finish its write
        destination.once('drain', roll)
      }
    })
  }

  function roll () {
    destination.reopen(fileName)
    if (limit) {
      createdFileNames.push(fileName)
      checkFileRemoval(createdFileNames, limit)
    }
  }

  function scheduleRoll () {
    clearTimeout(rollTimeout)
    rollTimeout = setTimeout(() => {
      fileName = buildFileName(file, ++number, extension)
      roll()
      frequencySpec.next = getNext(frequency)
      scheduleRoll()
    }, frequencySpec.next - Date.now())
  }

  return destination
}
