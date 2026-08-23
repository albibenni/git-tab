import {
  decodeBase64,
  encodeBase64,
  gitBlobSha,
  mapConcurrent,
  message,
  remotePath,
  withTimeout,
} from "./utils";

describe("encoding helpers", () => {
  it("round-trips Unicode Markdown", () => {
    const source = "# Notes ✨\nCaffè";
    expect(decodeBase64(encodeBase64(source))).toBe(source);
  });

  it("formats Error instances for user notices", () => {
    expect(message(new Error("GitHub unavailable"))).toBe("GitHub unavailable");
  });

  it("preserves line endings and reserved URL characters", () => {
    const source = "- query: ?q=one&two\r\n- emoji: 🧭";
    expect(decodeBase64(encodeBase64(source))).toBe(source);
  });

  it("formats non-Error failures without hiding their value", () => {
    expect(message("rate limited")).toBe("rate limited");
    expect(message({ status: 403 })).toBe("[object Object]");
  });

  it("fails operations that do not settle before their timeout", async () => {
    let timedOut = false;
    await expect(
      withTimeout(
        new Promise<never>(() => undefined),
        1,
        "Pulling note.md",
        () => {
          timedOut = true;
        },
      ),
    ).rejects.toThrow("Pulling note.md timed out after 0.001s.");
    expect(timedOut).toBe(true);
  });

  it("encodes each remote path segment", () => {
    expect(remotePath("My Notes/archive", "Daily/one & two.md")).toBe(
      "My%20Notes/archive/Daily/one%20%26%20two.md",
    );
  });

  it("limits concurrent work", async () => {
    let active = 0;
    let peak = 0;
    await mapConcurrent([1, 2, 3, 4, 5], 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("does not start more work after cancellation", async () => {
    let cancelled = false;
    const processed: number[] = [];
    await mapConcurrent(
      [1, 2, 3],
      1,
      (value) => {
        processed.push(value);
        cancelled = true;
        return Promise.resolve();
      },
      () => cancelled,
    );
    expect(processed).toEqual([1]);
  });

  it("matches GitHub blob SHAs without requesting file content", async () => {
    await expect(gitBlobSha("hello\n")).resolves.toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a",
    );
  });
});
