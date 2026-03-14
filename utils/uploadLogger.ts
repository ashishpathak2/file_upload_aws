/**
 * utils/uploadLogger.ts
 *
 * Structured logger for upload events.
 * Outputs to both the UI log console and browser devtools console.
 *
 * Tracks:
 *   - Upload speed
 *   - Retry count
 *   - Failure rate
 *   - Completion time
 */

export type LogLevel = "info" | "success" | "error" | "warn" | "api" | "step";

export interface LogEntry {
  id: number;
  time: string;
  message: string;
  level: LogLevel;
  meta?: Record<string, unknown>;  // optional structured data for observability
}

let _logId = 0;

/**
 * Create a log entry with current timestamp.
 */
export function createLogEntry(
  message: string,
  level: LogLevel,
  meta?: Record<string, unknown>
): LogEntry {
  const time = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Also emit to browser console with appropriate level
  const prefix = `[S3Upload][${level.toUpperCase()}]`;
  const consoleMeta = meta ? meta : "";
  switch (level) {
    case "error": console.error(prefix, message, consoleMeta); break;
    case "warn":  console.warn(prefix, message, consoleMeta);  break;
    case "success":
    case "api":
    case "step":  console.info(prefix, message, consoleMeta);  break;
    default:      console.log(prefix, message, consoleMeta);
  }

  return { id: ++_logId, time, message, level, meta };
}

/**
 * Format upload metrics for logging.
 */
export function formatUploadMetrics(params: {
  speed: number;
  retries: number;
  failures: number;
  elapsedMs: number;
  bytesUploaded: number;
  totalBytes: number;
}): string {
  const { speed, retries, failures, elapsedMs, bytesUploaded, totalBytes } = params;
  const pct = totalBytes > 0 ? ((bytesUploaded / totalBytes) * 100).toFixed(1) : "0";
  const speedStr = speed > 0 ? `${formatBytes(speed)}/s` : "—";
  return `progress=${pct}% speed=${speedStr} retries=${retries} failures=${failures} elapsed=${(elapsedMs / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
