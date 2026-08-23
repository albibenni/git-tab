export function encodeBase64(value: string): string {
  return btoa(bytesToBinaryString(new TextEncoder().encode(value)));
}
export function decodeBase64(value: string): string {
  return new TextDecoder().decode(binaryStringToBytes(atob(value)));
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}

function binaryStringToBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  description: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          reject(
            new Error(`${description} timed out after ${timeoutMs / 1000}s.`),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function contentHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function gitBlobSha(value: string): Promise<string> {
  const content = new TextEncoder().encode(value);
  const header = new TextEncoder().encode(`blob ${content.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + content.byteLength);
  bytes.set(header);
  bytes.set(content, header.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function remotePath(root: string, localPath: string): string {
  return [root, localPath]
    .filter(Boolean)
    .flatMap((path) => path.split("/"))
    .map(encodeURIComponent)
    .join("/");
}

export async function mapConcurrent<T>(
  values: readonly T[],
  limit: number,
  map: (value: T, index: number) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < values.length) {
      if (shouldStop?.()) return;
      const index = cursor++;
      await map(values[index] as T, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, worker),
  );
}
