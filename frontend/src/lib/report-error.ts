import { getErrorMessage } from '@/api/decoders';

const isProd = (import.meta as { env?: { PROD?: boolean } }).env?.PROD ?? false;

/**
 * Central error reporter for runtime errors in production paths.
 *
 * - In dev: logs full error + context to console for debugging.
 * - In prod: emits a single-line structured log so log shippers (Loki, etc.)
 *   can ingest it without leaking stack traces to the browser console of
 *   end-users who have devtools open.
 *
 * Returns the human-readable message so callers can pass it to `toast.error()`.
 */
export function reportError(error: unknown, context: string, fallback = 'Something went wrong'): string {
  const message = getErrorMessage(error, fallback);
  if (isProd) {
    // Single structured line — easy to grep, no stack-trace leak.
    console.warn(JSON.stringify({ level: 'error', context, message }));
  } else {
    console.error(`[${context}]`, error);
  }
  return message;
}
