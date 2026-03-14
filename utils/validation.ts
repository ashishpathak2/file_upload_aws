/**
 * utils/validation.ts
 *
 * Frontend input validation helpers.
 * Keeps validation logic separate from UI components.
 */

import { MAX_FILE_SIZE } from "./chunkCalculator";

/**
 * Validate a file before initiating upload.
 * Throws a descriptive error if validation fails.
 *
 * Rules:
 *   - File must not be null
 *   - File size must be > 0
 *   - File size must be <= 5 TB (S3 limit)
 */
export function validateFile(file: File | null): void {
  if (!file) {
    throw new Error("Please select a file before uploading.");
  }
  if (file.size === 0) {
    throw new Error("The selected file is empty (0 bytes). Please select a valid file.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File size (${formatBytes(file.size)}) exceeds the 5 TB S3 maximum.`
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
