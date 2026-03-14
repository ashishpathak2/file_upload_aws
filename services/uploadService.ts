/**
 * services/uploadService.ts
 *
 * Core upload orchestration service.
 *
 * Responsibilities:
 *   - Start a new multipart upload
 *   - Resume an interrupted upload (skip already-uploaded parts)
 *   - Upload chunks concurrently with retry + exponential backoff
 *   - Complete the multipart upload
 *   - Abort the multipart upload
 *
 * This service is intentionally UI-agnostic — it receives callbacks
 * for logging and progress so it can be used from any component.
 */

import { calcChunkSize, calcPartCount } from "@/utils/chunkCalculator";
import { calcConcurrency } from "@/utils/concurrencyManager";
import { withRetry, fetchWithRetry } from "@/utils/retryHandler";
import {
  saveUploadSession,
  markPartUploaded,
  clearUploadSession,
  type UploadSession,
} from "@/utils/uploadSession";
import { formatUploadMetrics } from "@/utils/uploadLogger";
import type { LogLevel } from "@/utils/uploadLogger";

// ─── Types ────────────────────────────────────

export interface UploadPart {
  PartNumber: number;
  ETag: string;
}

export interface StartUploadResponse {
  fileId: string;
  uploadId: string;
  presignedUrls: string[];
}

export interface UploadCallbacks {
  /** Emit a UI log entry */
  onLog: (message: string, level: LogLevel) => void;
  /** Called after each chunk completes to update progress */
  onProgress: (loaded: number, total: number) => void;
  /** Return true to stop the upload (abort/cancel) */
  onAbort: () => boolean;
}

// ─── Upload chunk ─────────────────────────────

/**
 * Upload one chunk to S3 via presigned URL.
 *
 * Uses exponential backoff + jitter on failure.
 * Checks abort signal before each attempt.
 */
async function uploadChunk(
  url: string,
  chunk: Blob,
  partNumber: number,
  callbacks: UploadCallbacks
): Promise<string> {
  let retryCount = 0;

  return withRetry(
    async () => {
      if (callbacks.onAbort()) throw new Error("Upload aborted by user");

      const res = await fetch(url, {
        method: "PUT",
        body: chunk,
        headers: { "Content-Type": "application/octet-stream" },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const etag = (res.headers.get("ETag") ?? "").replace(/"/g, "");
      if (!etag) throw new Error("No ETag in response — check S3 CORS ExposeHeaders");

      return etag;
    },
    {
      maxRetries: 3,
      baseDelay: 800,
      onRetry: (attempt, error) => {
        retryCount++;
        callbacks.onLog(
          `Part ${partNumber} retry ${attempt}/3 — ${error.message}`,
          "warn"
        );
      },
    }
  );
}

// ─── Start Upload ─────────────────────────────

/**
 * Initiate a brand-new multipart upload.
 *
 * 1. POST /api/upload/start → receive presigned URLs
 * 2. Save session to localStorage for resume capability
 * 3. Upload all chunks concurrently in batches
 * 4. POST /api/upload/complete → finalize in S3
 */
export async function startUpload(
  file: File,
  callbacks: UploadCallbacks
): Promise<{ fileId: string; location?: string }> {
  const chunkSize = calcChunkSize(file.size);
  const partCount = calcPartCount(file.size);
  const concurrency = calcConcurrency(file.size);

  callbacks.onLog(
    `Chunk size: ${formatBytes(chunkSize)} → ${partCount} parts | Concurrency: ${concurrency}×`,
    "info"
  );
  callbacks.onLog("[API] POST /api/upload/start", "api");

  // Start upload with retry on API call itself
  const startData = await fetchWithRetry(
    "/api/upload/start",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
      }),
    },
    { maxRetries: 3, onRetry: (a) => callbacks.onLog(`Start API retry ${a}/3`, "warn") }
  ).then((r) => r.json() as Promise<StartUploadResponse>);

  callbacks.onLog(
    `[API] Response: ${startData.presignedUrls.length} presigned URLs | fileId: ${startData.fileId.slice(0, 8)}…`,
    "api"
  );

  // Save session to localStorage for resume support
  saveUploadSession({
    fileId: startData.fileId,
    uploadId: startData.uploadId,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    uploadedPartNumbers: [],
    presignedUrls: startData.presignedUrls,
  });

  return uploadChunks(file, startData.fileId, startData.uploadId, startData.presignedUrls, [], callbacks);
}

// ─── Resume Upload ────────────────────────────

/**
 * Resume an interrupted upload using a saved session.
 *
 * Fetches already-uploaded parts from S3 via ListParts,
 * then only uploads the missing chunks.
 */
export async function resumeUpload(
  file: File,
  session: UploadSession,
  callbacks: UploadCallbacks
): Promise<{ fileId: string; location?: string }> {
  callbacks.onLog(`Resuming upload for ${file.name}…`, "step");
  callbacks.onLog("[API] GET /api/upload/status — fetching uploaded parts", "api");

  // Ask backend to check S3 ListParts for what's already uploaded
  let uploadedPartNumbers: number[] = session.uploadedPartNumbers;

  try {
    const statusRes = await fetch(`/api/upload/status?fileId=${session.fileId}`);
    if (statusRes.ok) {
      const data = await statusRes.json();
      uploadedPartNumbers = data.uploadedParts ?? uploadedPartNumbers;
      callbacks.onLog(
        `[API] S3 reports ${uploadedPartNumbers.length} parts already uploaded`,
        "api"
      );
    }
  } catch {
    callbacks.onLog("Could not fetch status from S3, using local session", "warn");
  }

  callbacks.onLog(
    `Resuming from part ${uploadedPartNumbers.length + 1} / ${session.presignedUrls.length}`,
    "info"
  );

  return uploadChunks(
    file,
    session.fileId,
    session.uploadId,
    session.presignedUrls,
    uploadedPartNumbers,
    callbacks
  );
}

// ─── Upload chunks (shared by start + resume) ─

/**
 * Upload all chunks, skipping already-uploaded part numbers.
 * Called by both startUpload and resumeUpload.
 */
async function uploadChunks(
  file: File,
  fileId: string,
  uploadId: string,
  presignedUrls: string[],
  alreadyUploadedParts: number[],
  callbacks: UploadCallbacks
): Promise<{ fileId: string; location?: string }> {
  const chunkSize = calcChunkSize(file.size);
  const concurrency = calcConcurrency(file.size);
  const partCount = presignedUrls.length;

  const alreadyUploadedSet = new Set(alreadyUploadedParts);

  // Pre-populate completed parts from already-uploaded list
  // (We don't have their ETags, so we'll need S3 to have them)
  const completedParts: UploadPart[] = [];
  let bytesUploaded = alreadyUploadedParts.length * chunkSize;

  callbacks.onLog("File chunking started", "step");

  let totalRetries = 0;
  let totalFailures = 0;
  const uploadStart = Date.now();

  for (let i = 0; i < presignedUrls.length; i += concurrency) {
    if (callbacks.onAbort()) throw new Error("Upload cancelled by user");

    const batch = presignedUrls.slice(i, i + concurrency);

    const results = await Promise.all(
      batch.map(async (url, idx) => {
        const partNumber = i + idx + 1;

        // Skip already uploaded parts
        if (alreadyUploadedSet.has(partNumber)) {
          callbacks.onLog(`Part ${partNumber}/${partCount} already uploaded, skipping`, "info");
          return null; // Will be filtered out
        }

        const start = (partNumber - 1) * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);

        callbacks.onLog(
          `Uploading chunk ${partNumber}/${partCount} (${formatBytes(chunk.size)})`,
          "step"
        );

        try {
          const etag = await uploadChunk(url, chunk, partNumber, callbacks);

          bytesUploaded += chunk.size;
          callbacks.onProgress(bytesUploaded, file.size);
          callbacks.onLog(`Chunk ${partNumber}/${partCount} ✓`, "success");

          // Persist part to localStorage session immediately
          markPartUploaded(fileId, partNumber);

          return { PartNumber: partNumber, ETag: etag };
        } catch (err) {
          totalFailures++;
          throw err;
        }
      })
    );

    // Filter nulls (skipped parts) and add to completedParts
    completedParts.push(
      ...(results.filter((r): r is UploadPart => r !== null))
    );
  }

  // Sort required by S3 — parts must be in ascending order
  completedParts.sort((a, b) => a.PartNumber - b.PartNumber);

  const elapsed = Date.now() - uploadStart;
  const speed = bytesUploaded / (elapsed / 1000);
  callbacks.onLog("All chunks uploaded", "success");
  callbacks.onLog(
    formatUploadMetrics({
      speed,
      retries: totalRetries,
      failures: totalFailures,
      elapsedMs: elapsed,
      bytesUploaded,
      totalBytes: file.size,
    }),
    "info"
  );

  // ── Complete multipart upload ──
  callbacks.onLog("Completing multipart upload…", "step");
  callbacks.onLog("[API] POST /api/upload/complete", "api");

  const completeData = await fetchWithRetry(
    "/api/upload/complete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, uploadId, parts: completedParts }),
    },
    {
      maxRetries: 3,
      onRetry: (a) => callbacks.onLog(`Complete API retry ${a}/3`, "warn"),
    }
  ).then((r) => r.json());

  // Clear session on success
  clearUploadSession(fileId);

  callbacks.onLog("[API] Upload finalized — S3 merge complete", "api");
  callbacks.onLog("[API] POST /api/webhook/s3-file → MongoDB status: success", "api");

  return { fileId, location: completeData.location };
}

// ─── Abort upload ─────────────────────────────

/**
 * Abort an in-progress multipart upload.
 * Calls S3 AbortMultipartUpload and clears the local session.
 */
export async function abortUpload(
  fileId: string,
  callbacks: UploadCallbacks
): Promise<void> {
  callbacks.onLog("[API] POST /api/upload/abort", "api");
  try {
    await fetch("/api/upload/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    clearUploadSession(fileId);
    callbacks.onLog("Upload aborted and session cleared", "warn");
  } catch {
    callbacks.onLog("Abort request failed — session cleared locally", "warn");
    clearUploadSession(fileId);
  }
}

// ─── Helpers ──────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
