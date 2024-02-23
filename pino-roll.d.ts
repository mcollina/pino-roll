import SonicBoom, {SonicBoomOpts} from "sonic-boom";

export interface PinoRollOptions extends Omit<SonicBoomOpts, 'dest'> {
    file: string
    mkdir?: boolean
    frequency?: 'daily' | 'hourly' | number
    size?: number | `${string}k` | `${string}m` | `${string}g`
    extension?: string
    prefix?: string
}

/**
 * Creates a Pino transport (a Sonic-boom stream) to writing into files.
 * Automatically rolls your files based on a given frequency, size, or both.
 */
declare function createPinoRoll(options: PinoRollOptions): Promise<SonicBoom>
export default createPinoRoll
