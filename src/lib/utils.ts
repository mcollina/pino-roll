import {
  readdir,
  stat,
  unlink,
  symlink,
  lstat,
  readlink,
} from 'node:fs/promises'
import { symlinkSync, unlinkSync, lstatSync, readlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { format, addDays, addHours, parse, isValid } from 'date-fns'
import { setTimeout as sleep } from 'node:timers/promises'

export interface FrequencySpec {
  frequency: string | number;
  start: number;
  next: number;
}

export interface LogFileInfo {
  fileName: string;
  fileTime: number;
  fileNumber: number;
}

export interface LimitOptions {
  count: number;
  removeOtherLogFiles?: boolean;
}

export interface SanitizedFile {
  file: string;
  extension: string;
}

export interface RemoveOldFilesOptions {
  count: number;
  removeOtherLogFiles?: boolean;
  baseFile: string;
  dateFormat?: string;
  extension?: string;
  createdFileNames: string[];
  newFileName: string;
}

export function parseSize (
  size: string | number | null | undefined
): number | null {
  let multiplier = 1024 ** 2
  if (typeof size !== 'string' && typeof size !== 'number') {
    return null
  }
  if (typeof size === 'string') {
    const match = size.match(/^([\d.]+)(\w?)$/)
    if (match) {
      const unit = match[2]?.toLowerCase()
      size = +match[1]
      multiplier =
        unit === 'g'
          ? 1024 ** 3
          : unit === 'k'
            ? 1024
            : unit === 'b'
              ? 1
              : 1024 ** 2
    } else {
      throw new Error(`${size} is not a valid size in KB, MB or GB`)
    }
  }
  return size * multiplier
}

export function parseFrequency (
  frequency?: string | number
): FrequencySpec | null {
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
    const start = today.getTime() - (today.getTime() % frequency)
    return { frequency, start, next: getNextCustom(frequency) }
  }
  if (frequency) {
    throw new Error(
      `${frequency} is neither a supported frequency or a number of milliseconds`
    )
  }
  return null
}

export function validateLimitOptions (limit?: LimitOptions): void {
  if (limit) {
    if (typeof limit !== 'object') {
      throw new Error('limit must be an object')
    }
    if (typeof limit.count !== 'number' || limit.count <= 0) {
      throw new Error('limit.count must be a number greater than 0')
    }
    if (
      typeof limit.removeOtherLogFiles !== 'undefined' &&
      typeof limit.removeOtherLogFiles !== 'boolean'
    ) {
      throw new Error('limit.removeOtherLogFiles must be boolean')
    }
  }
}

function getNextDay (start: number): number {
  return addDays(new Date(start), 1).setHours(0, 0, 0, 0)
}

function getNextHour (start: number): number {
  return addHours(new Date(start), 1).setMinutes(0, 0, 0)
}

function getNextCustom (frequency: number): number {
  const time = Date.now()
  return time - (time % frequency) + frequency
}

export function getNext (frequency: string | number): number {
  if (frequency === 'daily') {
    return getNextDay(new Date().setHours(0, 0, 0, 0))
  }
  if (frequency === 'hourly') {
    return getNextHour(new Date().setMinutes(0, 0, 0))
  }
  return getNextCustom(frequency as number)
}

export function getFileName (fileVal: string | (() => string)): string {
  if (!fileVal) {
    throw new Error('No file name provided')
  }
  return typeof fileVal === 'function' ? fileVal() : fileVal
}

export function buildFileName (
  fileVal: string | (() => string),
  date: string | null,
  lastNumber = 1,
  extension?: string
): string {
  const dateStr = date ? `.${date}` : ''
  const extensionStr =
    typeof extension !== 'string'
      ? ''
      : extension.startsWith('.')
        ? extension
        : `.${extension}`
  return `${getFileName(fileVal)}${dateStr}.${lastNumber}${extensionStr}`
}

export function identifyLogFile (
  checkedFileName: string,
  fileVal: string | (() => string),
  dateFormat?: string,
  extension?: string
): LogFileInfo | false {
  const baseFileNameStr = getFileName(fileVal)
  if (!checkedFileName.startsWith(baseFileNameStr)) return false
  const checkFileNameSegments = checkedFileName
    .slice(baseFileNameStr.length + 1)
    .split('.')
  let expectedSegmentCount = 1
  if (typeof dateFormat === 'string' && dateFormat.length > 0) { expectedSegmentCount++ }
  if (typeof extension === 'string' && extension.length > 0) { expectedSegmentCount++ }
  const extensionStr =
    typeof extension !== 'string'
      ? ''
      : extension.startsWith('.')
        ? extension.slice(1)
        : extension
  if (checkFileNameSegments.length !== expectedSegmentCount) return false
  if (extensionStr.length > 0) {
    const chkExtension = checkFileNameSegments.pop()
    if (extensionStr !== chkExtension) return false
  }
  const chkFileNumber = checkFileNameSegments.pop()!
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

export async function getFileSize (filePath: string): Promise<number> {
  try {
    const fileStats = await stat(filePath)
    return fileStats.size
  } catch {
    return 0
  }
}

export async function detectLastNumber (
  fileVal: string | (() => string),
  time: number | null = null,
  fileExtension = ''
): Promise<number> {
  const fileName = getFileName(fileVal)
  try {
    const numbers = await readFileTrailingNumbers(
      dirname(fileName),
      time,
      fileExtension
    )
    return numbers.sort((a, b) => b - a)[0]
  } catch {
    return 1
  }
}

async function readFileTrailingNumbers (
  folder: string,
  time: number | null,
  fileExtension: string
): Promise<number[]> {
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

function extractTrailingNumber (
  fileName: string,
  fileExtension: string
): number | null {
  let normalizedFileExtension = fileExtension
  if (fileExtension && !fileExtension.startsWith('.')) {
    normalizedFileExtension = '.' + fileExtension
  }

  const extLength = normalizedFileExtension.length
  if (extLength > 0 && !fileName.endsWith(normalizedFileExtension)) {
    return null
  }
  const fileNameWithoutExtension = fileName.slice(
    0,
    fileName.length - extLength
  )
  const match = fileNameWithoutExtension.match(/(\d+)$/)
  return match ? +match[1] : null
}

export function extractFileName (fileName: string): string {
  return fileName.split(/(\\|\/)/g).pop()!
}

async function isMatchingTime (
  filePath: string,
  time: number
): Promise<boolean> {
  const { birthtimeMs } = await stat(filePath)
  return birthtimeMs >= time
}

/**
 * Retry unlink operation for Windows compatibility
 * Windows can fail to delete files if they're still being accessed
 */
async function unlinkWithRetry (
  filePath: string,
  maxRetries = 50,
  retryDelay = 100
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await unlink(filePath)
      return
    } catch (error) {
      if (attempt === maxRetries - 1) {
        // Last attempt failed, throw the error
        throw error
      }
      // Wait before retrying
      await sleep(retryDelay)
    }
  }
}

export async function removeOldFiles ({
  count,
  removeOtherLogFiles,
  baseFile,
  dateFormat,
  extension,
  createdFileNames,
  newFileName,
}: RemoveOldFilesOptions): Promise<void> {
  if (!removeOtherLogFiles) {
    createdFileNames.push(newFileName)
    if (createdFileNames.length > count) {
      const filesToRemove = createdFileNames.splice(
        0,
        createdFileNames.length - 1 - count
      )
      await Promise.allSettled(
        filesToRemove.map((file) => unlinkWithRetry(file))
      )
    }
  } else {
    let files: LogFileInfo[] = []
    const pathSegments = getFileName(baseFile).split(/(\\|\/)/g)
    const baseFileNameStr = pathSegments.pop()!
    for (const fileEntry of await readdir(join(...pathSegments))) {
      const f = identifyLogFile(
        fileEntry,
        baseFileNameStr,
        dateFormat,
        extension
      )
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
      const filesToRemove = files.slice(0, files.length - count)
      await Promise.allSettled(
        filesToRemove.map((file) =>
          unlinkWithRetry(join(...pathSegments, file.fileName))
        )
      )
    }
  }
}

export async function checkSymlink (
  fileName: string,
  linkPath: string
): Promise<boolean> {
  const stats = await lstat(linkPath).then(
    (stats) => stats,
    () => null
  )
  if (stats?.isSymbolicLink()) {
    const existingTarget = await readlink(linkPath)
    if (extractFileName(existingTarget) === extractFileName(fileName)) {
      return false
    }
    await unlink(linkPath)
  }
  return true
}

export async function createSymlink (fileVal: string): Promise<boolean> {
  const linkPath = join(dirname(fileVal), 'current.log')
  const shouldCreateSymlink = await checkSymlink(fileVal, linkPath)
  if (shouldCreateSymlink) {
    await symlink(extractFileName(fileVal), linkPath)
  }
  return false
}

function checkSymlinkSync (fileName: string, linkPath: string): boolean {
  try {
    const stats = lstatSync(linkPath)
    if (stats.isSymbolicLink()) {
      const existingTarget = readlinkSync(linkPath)
      if (extractFileName(existingTarget) === extractFileName(fileName)) {
        return false
      }
      unlinkSync(linkPath)
    }
    return true
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return true
    }
    throw error
  }
}

export function createSymlinkSync (fileVal: string): boolean {
  const linkPath = join(dirname(fileVal), 'current.log')
  const shouldCreateSymlink = checkSymlinkSync(fileVal, linkPath)
  if (shouldCreateSymlink) {
    symlinkSync(extractFileName(fileVal), linkPath)
  }
  return false
}

export function validateDateFormat (formatStr?: string): boolean {
  const invalidChars = /[/\\?%*:|"<>]/g
  if (formatStr && invalidChars.test(formatStr)) {
    throw new Error(`${formatStr} contains invalid characters`)
  }
  return true
}

export function parseDate (
  formatStr?: string | null,
  frequencySpec?: FrequencySpec | null,
  parseStart = false
): string | null {
  if (!(formatStr && frequencySpec?.start && frequencySpec.next)) return null

  try {
    return format(
      parseStart ? frequencySpec.start : frequencySpec.next,
      formatStr
    )
  } catch (error) {
    throw new Error(`${formatStr} must be a valid date format`)
  }
}

// to implement the default file fallback feature
export function sanitizeFile (
  file: string | (() => string),
  extension?: string
): SanitizedFile {
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
    currentFileExtension = fileParts.pop()!
    file = fileParts.join('.')
  }

  if (!extension && !currentFileExtension) {
    extension = FALLBACK_EXTENSION
  } else if (!extension && currentFileExtension.length > 1) {
    extension = currentFileExtension
  }
  return { file, extension: extension! }
}

// to validate and reject characters that are not allowed in file paths (cross-platform safe set, based on Windows restrictions)
export function validateFileName (filepath: string | (() => string)): boolean {
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
