import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResearchSources, ResearchTiming, splitResearchContent } from "../client/src/components/ResearchResponseMeta";

describe("research response rendering", () => {
  const content = "The answer is current.\n\nSources:\n- [Official limits](https://openrouter.ai/docs/api_reference/limits)";

  it("extracts persisted citation markdown into an explicit clickable source link", () => {
    const parsed = splitResearchContent(content);
    expect(parsed.body).toBe("The answer is current.");
    const html = renderToStaticMarkup(createElement(ResearchSources, { sources: parsed.sources }));
    expect(html).toContain('href="https://openrouter.ai/docs/api_reference/limits"');
    expect(html).toContain("Official limits");
    expect(html).toContain("Verified sources");
  });

  it("renders research timing as a final-only measurement", () => {
    const html = renderToStaticMarkup(createElement(ResearchTiming, { latencyMs: 24577 }));
    expect(html).toContain("Research final 24.6s · final-only");
  });
});
