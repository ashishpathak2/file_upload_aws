/**
 * utils/uploadSession.ts
 *
 * Manages upload session state in localStorage so uploads can be
 * resumed after page refresh or network disconnect.
 *
 * Stores:
 *   {
 *     fileId: string
 *     uploadId: string
 *     fileName: string
 *     fileSize: number
 *     fileType: string
 *     uploadedPartNumbers: number[]    // parts already uploaded
 *     presignedUrls: string[]          // all URLs (re-usable until expiry)
 *     createdAt: number                // timestamp for TTL check
 *   }
 *
 * Sessions expire after 1 hour (presigned URL lifetime).
 */

const SESSION_KEY_PREFIX = "s3_upload_session_";
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour — matches presigned URL expiry

export interface UploadSession {
  fileId: string;
  uploadId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  uploadedPartNumbers: number[];
  presignedUrls: string[];
  createdAt: number;
}

/**
 * Persist an upload session to localStorage.
 * Called after receiving presigned URLs from the backend.
 */
export function saveUploadSession(session: Omit<UploadSession, "createdAt">): void {
  if (typeof window === "undefined") return;
  const data: UploadSession = { ...session, createdAt: Date.now() };
  try {
    localStorage.setItem(
      `${SESSION_KEY_PREFIX}${session.fileId}`,
      JSON.stringify(data)
    );
  } catch {
    // localStorage may be full or unavailable — fail silently
    console.warn("[UploadSession] Failed to save session to localStorage");
  }
}

/**
 * Mark a specific part as uploaded in the saved session.
 * Called after each successful chunk upload.
 */
export function markPartUploaded(fileId: string, partNumber: number): void {
  if (typeof window === "undefined") return;
  const session = getUploadSession(fileId);
  if (!session) return;

  if (!session.uploadedPartNumbers.includes(partNumber)) {
    session.uploadedPartNumbers.push(partNumber);
    try {
      localStorage.setItem(
        `${SESSION_KEY_PREFIX}${fileId}`,
        JSON.stringify(session)
      );
    } catch {
      console.warn("[UploadSession] Failed to update session");
    }
  }
}

/**
 * Retrieve a saved upload session.
 * Returns null if not found or expired.
 */
export function getUploadSession(fileId: string): UploadSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${SESSION_KEY_PREFIX}${fileId}`);
    if (!raw) return null;

    const session: UploadSession = JSON.parse(raw);

    // Check TTL — sessions expire after presigned URL lifetime
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
      clearUploadSession(fileId);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Find any active upload session matching a filename + size.
 * Used to detect resumable uploads when user re-selects the same file.
 */
export function findResumeSession(
  fileName: string,
  fileSize: number
): UploadSession | null {
  if (typeof window === "undefined") return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(SESSION_KEY_PREFIX)) continue;

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const session: UploadSession = JSON.parse(raw);

      // Check TTL first
      if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        clearUploadSession(session.fileId);
        continue;
      }

      // Match by name + size (sufficient to identify same file)
      if (session.fileName === fileName && session.fileSize === fileSize) {
        return session;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Remove an upload session (on completion, abort, or expiry).
 */
export function clearUploadSession(fileId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`${SESSION_KEY_PREFIX}${fileId}`);
  } catch {
    // ignore
  }
}

/**
 * Clear all expired sessions to prevent localStorage bloat.
 * Call this periodically (e.g., on app mount).
 */
export function pruneExpiredSessions(): void {
  if (typeof window === "undefined") return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(SESSION_KEY_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const session: UploadSession = JSON.parse(raw);
      if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
