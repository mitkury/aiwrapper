export interface ErrorWithPartialResult<T> extends Error {
  partialResult?: T;
}

export function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw createAbortError();
}

function errorProperty(error: unknown, property: string): unknown {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }
  return Reflect.get(error, property);
}

export function isAbortError(error: unknown): boolean {
  return errorProperty(error, "name") === "AbortError";
}

export function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;

  const reportedMessage = errorProperty(error, "message");
  const normalized = new Error(
    typeof reportedMessage === "string" ? reportedMessage : String(error),
  );
  const reportedName = errorProperty(error, "name");
  if (typeof reportedName === "string") normalized.name = reportedName;
  return normalized;
}

export function partialResultFrom<T>(error: unknown): T | undefined {
  return errorProperty(error, "partialResult") as T | undefined;
}

export function attachPartialResult<T>(
  error: unknown,
  partialResult: T,
): ErrorWithPartialResult<T> {
  const normalized = normalizeError(error) as ErrorWithPartialResult<T>;

  try {
    normalized.partialResult = partialResult;
    return normalized;
  } catch {
    const wrapped = new Error(
      normalized.message,
      { cause: error },
    ) as ErrorWithPartialResult<T>;
    wrapped.name = normalized.name;
    wrapped.partialResult = partialResult;
    return wrapped;
  }
}
