import { decodeBase64, encodeBase64, message, remotePath } from "./utils";

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

  it("encodes each remote path segment", () => {
    expect(remotePath("My Notes/archive", "Daily/one & two.md")).toBe(
      "My%20Notes/archive/Daily/one%20%26%20two.md",
    );
  });
});
