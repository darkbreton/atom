declare module 'fit-file-parser' {
  interface FitLap {
    start_time?: string | Date;
    total_timer_time?: number;
    total_elapsed_time?: number;
    total_distance?: number;
    [key: string]: unknown;
  }

  interface FitRecord {
    position_lat?: number;
    position_long?: number;
    start_position_lat?: number;
    start_position_long?: number;
    latitude?: number;
    longitude?: number;
    altitude?: number;
    enhanced_altitude?: number;
    enhanced_avg_altitude?: number;
    timestamp?: string | Date;
    heart_rate?: number;
    hr?: number;
    [key: string]: unknown;
  }

  interface FitData {
    records?: FitRecord[];
    laps?: FitLap[];
    [key: string]: unknown;
  }

  export default class FitParser {
    constructor(options?: Record<string, unknown>);
    parseAsync(buffer: ArrayBuffer): Promise<FitData>;
  }
}
