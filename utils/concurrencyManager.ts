/**
 * utils/concurrencyManager.ts
 *
 * Determines optimal upload concurrency based on device
 * capabilities and file size.
 *
 * Rules:
 *   < 100 MB  → 3  concurrent uploads (light load)
 *   < 1 GB    → 5  concurrent uploads (medium load)
 *   >= 1 GB   → min(8, CPU cores)    (heavy, CPU-bound)
 *
 * Cap at 8 to avoid overwhelming the browser/network.
 * Fallback to 4 when hardwareConcurrency is unavailable (SSR).
 */

const MAX_CONCURRENCY = 8;
const DEFAULT_CONCURRENCY = 4;

/**
 * Calculate optimal concurrent chunk upload count.
 *
 * @param fileSize - File size in bytes
 * @returns Number of chunks to upload in parallel
 */
export function calcConcurrency(fileSize: number): number {
  const cpuCores =
    typeof navigator !== "undefined"
      ? (navigator.hardwareConcurrency ?? DEFAULT_CONCURRENCY)
      : DEFAULT_CONCURRENCY;

  if (fileSize < 100 * 1024 * 1024) return 3;           // < 100 MB
  if (fileSize < 1024 * 1024 * 1024) return 5;          // < 1 GB
  return Math.min(MAX_CONCURRENCY, cpuCores);            // >= 1 GB
}
