/**
 * utils/chunkCalculator.ts
 *
 * Calculates optimal upload chunk size based on file size.
 *
 * S3 Constraints:
 *   - Minimum part size: 5 MB
 *   - Maximum parts per upload: 10,000
 *   - Maximum file size: 5 TB
 *
 * Strategy:
 *   chunkSize = max(5MB, ceil(fileSize / 10000))
 *
 * This ensures we never exceed 10,000 parts for any file,
 * while keeping chunks at a reasonable minimum for small files.
 */

export const MIN_CHUNK_SIZE = 5 * 1024 * 1024;  // 5 MB — S3 minimum
export const MAX_PARTS = 10_000;                 // S3 hard limit
export const MAX_FILE_SIZE = 5 * 1024 ** 4;      // 5 TB — S3 maximum

/**
 * Calculate the optimal chunk size for a given file.
 *
 * @param fileSize - Total file size in bytes
 * @returns Chunk size in bytes (always >= 5MB)
 *
 * Examples:
 *   50 MB  → 5 MB chunks  → 10 parts
 *   500 MB → 5 MB chunks  → 100 parts
 *   10 GB  → 5 MB chunks  → ~2000 parts
 *   5 TB   → ~524 MB chunks → ~10,000 parts
 */
export function calcChunkSize(fileSize: number): number {
  const dynamic = Math.ceil(fileSize / MAX_PARTS);
  return Math.max(MIN_CHUNK_SIZE, dynamic);
}

/**
 * Calculate how many parts a file will be split into.
 */
export function calcPartCount(fileSize: number): number {
  return Math.ceil(fileSize / calcChunkSize(fileSize));
}
