import { describe, expect, it } from "vitest";
import { renderClientScript, renderIndexHtml } from "../src/templates.js";

describe("web templates", () => {
  it("renders prompt and feed UI elements", () => {
    const html = renderIndexHtml();
    expect(html).toContain("Adam Remote Prompt");
    expect(html).toContain("id=\"sendPrompt\"");
    expect(html).toContain("id=\"feed\"");
    expect(html).toContain("id=\"sessionId\"");
  });

  it("renders client script with prompt and event handlers", () => {
    const script = renderClientScript();
    expect(script).toContain("submitPrompt");
    expect(script).toContain("pollEvents");
    expect(script).toContain("/api/prompts");
    expect(script).toContain("/api/events");
  });
});
