import SonicBoomModule from 'sonic-boom';
import type { SonicBoom as SonicBoomType, SonicBoomOpts } from 'sonic-boom';
import {
  buildFileName,
  removeOldFiles,
  createSymlinkSync,
  detectLastNumber,
  parseSize,
  parseFrequency,
  getNext,
  getFileSize,
  validateLimitOptions,
  parseDate,
  validateDateFormat,
  sanitizeFile,
  validateFileName,
  type LimitOptions,
} from './lib/utils.ts';

// sonic-boom is CommonJS, so default export is the entire module
const SonicBoom = SonicBoomModule.SonicBoom || SonicBoomModule;

/**
 * A function that returns a string path to the base file name
 */
export type LogFilePath = () => string;

/**
 * Options for configuring the Pino roll transport
 */
export interface Options {
  /**
   * Absolute or relative path to the log file.
   * Your application needs the write right on the parent folder.
   * Number will be appended to this file name.
   * When the parent folder already contains numbered files, numbering will continue based on the highest number.
   * If this path does not exist, the logger with throw an error unless you set `mkdir` to `true`.
   */
  file: string | LogFilePath;

  /**
   * When specified, the maximum size of a given log file.
   * Can be combined with frequency.
   * Use 'k', 'm' and 'g' to express values in KB, MB or GB.
   * Numerical values will be considered as MB.
   */
  size?: string | number;

  /**
   * When specified, the amount of time a given log file is used.
   * Can be combined with size.
   * Use 'daily' or 'hourly' to rotate file every day (or every hour).
   * Existing file within the current day (or hour) will be re-used.
   * Numerical values will be considered as a number of milliseconds.
   * Using a numerical value will always create a new file upon startup.
   */
  frequency?: string | number;

  /**
   * When specified, appends a file extension after the file number.
   */
  extension?: string;

  /**
   * When specified, creates a symlink to the current log file.
   */
  symlink?: boolean;

  /**
   * Strategy used to remove oldest files when rotating them.
   */
  limit?: LimitOptions;

  /**
   * When specified, appends the current date/time to the file name in the provided format.
   * Supports date formats from `date-fns` (see: https://date-fns.org/v4.1.0/docs/format),
   * such as 'yyyy-MM-dd' and 'yyyy-MM-dd-hh'.
   */
  dateFormat?: string;
}

export type PinoRollOptions = Options & SonicBoomOpts;

/**
 * Creates a Pino transport (a Sonic-boom stream) to writing into files.
 * Automatically rolls your files based on a given frequency, size, or both.
 *
 * @param options - to configure file destionation, and rolling rules.
 * @returns the Sonic boom steam, usabled as Pino transport.
 */
export default async function pinoRoll (
  {
    file,
    size,
    frequency,
    extension,
    limit,
    symlink,
    dateFormat,
    ...opts
  }: PinoRollOptions = {} as PinoRollOptions
): Promise<SonicBoomType> {
  validateLimitOptions(limit);
  validateDateFormat(dateFormat);
  validateFileName(file);
  const frequencySpec = parseFrequency(frequency);

  let date = parseDate(dateFormat, frequencySpec, true);
  const sanitizedFile = sanitizeFile(file, extension);
  file = sanitizedFile.file;
  extension = sanitizedFile.extension;

  let number = await detectLastNumber(
    file,
    frequencySpec?.start ?? null,
    extension
  );
  let fileName = buildFileName(file, date, number, extension);
  const createdFileNames = [fileName];
  let currentSize = await getFileSize(fileName);
  const maxSize = parseSize(size);

  const destination = new SonicBoom({ ...opts, dest: fileName });

  if (symlink) {
    createSymlinkSync(fileName);
  }

  let rollTimeout: NodeJS.Timeout | undefined;
  let isClosing = false;
  let isRolling = false;

  if (frequencySpec) {
    destination.once('close', () => {
      isClosing = true;
      clearTimeout(rollTimeout);
    });
    scheduleRoll();
  }

  if (maxSize) {
    destination.on('write', (writtenSize: number) => {
      // Check if adding this write would exceed or meet the size limit
      const newSize = currentSize + writtenSize;
      if (newSize >= maxSize && !isRolling) {
        isRolling = true;
        // Increment number and build new filename for NEXT writes
        const nextNumber = ++number;
        fileName = buildFileName(file, date, nextNumber, extension);
        // Reset size - the current write went to the old file, new file starts fresh
        currentSize = 0;
        // Roll immediately for size-based rotation (don't delay)
        roll(() => {
          isRolling = false;
        });
      } else {
        // Track cumulative size for current file
        currentSize = newSize;
      }
    });
  }

  function roll (callback?: (err?: Error) => void): void {
    // Don't roll if the stream is destroyed or closing
    if ((destination as any).destroyed || isClosing) {
      if (callback) callback();
      return;
    }

    // Flush buffered data to disk before rotating the file
    destination.flush((err?: Error) => {
      if (err) {
        destination.emit('error', err);
        if (callback) callback(err);
        return;
      }

      // Check again if stream is destroyed or closing after flush completes
      if ((destination as any).destroyed || isClosing) {
        if (callback) callback();
        return;
      }

      try {
        destination.reopen(fileName);
        if (symlink) {
          createSymlinkSync(fileName);
        }
        if (limit) {
          // Run cleanup asynchronously and emit event when complete
          removeOldFiles({
            ...limit,
            baseFile: file as string,
            dateFormat,
            extension,
            createdFileNames,
            newFileName: fileName,
          })
            .then(() => {
              destination.emit('cleanup-complete');
            })
            .catch((cleanupError: Error) => {
              destination.emit('error', cleanupError);
            });
        }

        // Notify that roll operation is complete
        if (callback) callback();
      } catch (error) {
        // Handle reopen errors gracefully
        destination.emit('error', error as Error);
        if (callback) callback(error as Error);
      }
    });
  }

  function scheduleRoll (): void {
    clearTimeout(rollTimeout);
    rollTimeout = setTimeout(() => {
      const prevDate = date;
      date = parseDate(dateFormat, frequencySpec);
      if (dateFormat && date && date !== prevDate) number = 0;
      fileName = buildFileName(file, date, ++number, extension);

      // Only schedule next roll after current roll completes
      roll((err?: Error) => {
        if (err) {
          // Log error but continue scheduling to maintain rotation
          destination.emit('error', err);
        }

        // Schedule the next roll only after current roll is complete
        if (frequencySpec) {
          frequencySpec.next = getNext(frequency!);
          scheduleRoll();
        }
      });
    }, frequencySpec!.next - Date.now()).unref();
  }

  // Clean up the timeout when the stream is closed or destroyed
  destination.once('close', () => {
    isClosing = true;
    clearTimeout(rollTimeout);
  });

  return destination;
}

// Also export as named export for compatibility
export { pinoRoll };
