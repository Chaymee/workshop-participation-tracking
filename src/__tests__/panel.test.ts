jest.mock("../extension", () => ({
  outputChannel: { appendLine: jest.fn() }
}));

import { escapeHtml } from "../panel";

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml(`say "hello"`)).toBe("say &quot;hello&quot;");
  });

  it("escapes less-than", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes greater-than", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("escapes all special characters together", () => {
    expect(escapeHtml(`<a href="x">a & b</a>`))
      .toBe("&lt;a href=&quot;x&quot;&gt;a &amp; b&lt;/a&gt;");
  });

  it("returns plain strings unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });
});
