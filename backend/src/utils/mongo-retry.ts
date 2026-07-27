export interface MongoWriteConflictRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (error: unknown, failedAttempt: number, delayMs: number) => void;
}

type MongoErrorLike = {
  code?: unknown;
  codeName?: unknown;
  message?: unknown;
  cause?: unknown;
};

export function isMongoWriteConflict(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const candidate = current as MongoErrorLike;
    if (
      candidate.code === 112
      || candidate.codeName === "WriteConflict"
      || (typeof candidate.message === "string" && /\bwrite conflict\b/i.test(candidate.message))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export async function retryMongoWriteConflict<T>(
  operation: () => Promise<T>,
  options: MongoWriteConflictRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 4));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 25));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isMongoWriteConflict(error) || attempt === maxAttempts) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * (baseDelayMs + 1));
      options.onRetry?.(error, attempt, delayMs);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Mongo write-conflict retry attempts were exhausted");
}
