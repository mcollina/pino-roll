import type SonicBoom from "snoic-boom";
import type { SonicBoomOpts } from "sonic-boom";

export type RollFrequency = "weekly" | "daily" | "hourly";

export interface PinoRollOptions extends Omit<SonicBoomOpts, "dest"> {
  file: string | (() => string);
  size?: number | string;
  frequency?: RollFrequency | number;
  extension?: string;
  symlink?: boolean;
  limit?: {
    count?: number;
    removeOtherLogFiles?: boolean;
  };
  dateFormat?: string;
}
const PinoRoll: (options: PinoRollOptions) => Promise<SonicBoom>;
export default PinoRoll;
