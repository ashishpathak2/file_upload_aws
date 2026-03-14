/**
 * utils/retryHandler.ts
 *
 * Generic retry wrapper with exponential backoff and random jitter.
 *
 * Jitter prevents "retry storms" — when many clients fail at the same
 * time and all retry simultaneously, overwhelming the server.
 *
 * Formula: delay = baseDelay * 2^attempt + randomJitter
 */

export interface RetryOptions {
  maxRetries?: number;    // Default: 3
  baseDelay?: number;     // Default: 800ms
  maxDelay?: number;      // Default: 10000ms cap
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Wrap any async function with retry + exponential backoff + jitter.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Result of fn on success
 * @throws Last error after all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 800,
    maxDelay = 10_000,
    onRetry,
  } = options;

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on the last attempt
      if (attempt === maxRetries) break;

      onRetry?.(attempt + 1, lastError);

      // Exponential backoff with random jitter to prevent retry storms
      const exponentialDelay = baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * baseDelay;                      // 0..baseDelay ms
      const delay = Math.min(exponentialDelay + jitter, maxDelay);

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Retry specifically for fetch API calls.
 * Treats non-2xx responses as retryable errors.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {}
): Promise<Response> {
  return withRetry(async () => {
    const res = await fetch(url, init);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return res;
  }, options);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
