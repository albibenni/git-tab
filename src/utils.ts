export function encodeBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}
export function decodeBase64(value: string): string {
  return decodeURIComponent(escape(atob(value)));
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor++;
      await map(values[index] as T, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, worker),
  );
}
