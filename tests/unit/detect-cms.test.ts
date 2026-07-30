import { describe, expect, it } from "vitest";
import { detectCms } from "@/lib/parsing/detect-cms";

describe("detectCms", () => {
  it("prefers the generator meta tag when present", () => {
    expect(detectCms({ generatorMeta: "WordPress 6.4.2" })).toBe("wordpress");
    expect(detectCms({ generatorMeta: "Squarespace" })).toBe("squarespace");
    expect(detectCms({ generatorMeta: "Wix.com Website Builder" })).toBe("wix");
  });

  it("falls back to asset-host fingerprints when the generator tag is stripped", () => {
    // Most builders remove the generator tag but cannot avoid their CDN.
    expect(
      detectCms({ generatorMeta: null, rawMarkupSample: "/wp-content/themes/x/style.css" }),
    ).toBe("wordpress");
    expect(
      detectCms({ generatorMeta: null, rawMarkupSample: "https://cdn.shopify.com/s/files/1/x.js" }),
    ).toBe("shopify");
    expect(
      detectCms({ generatorMeta: null, rawMarkupSample: "https://static.wixstatic.com/media/a.png" }),
    ).toBe("wix");
    expect(
      detectCms({ generatorMeta: null, rawMarkupSample: "https://assets.website-files.com/x.js" }),
    ).toBe("webflow");
  });

  it("returns 'unknown' rather than guessing when nothing matches", () => {
    expect(
      detectCms({ generatorMeta: null, rawMarkupSample: "/static/app.bundle.js" }),
    ).toBe("unknown");
    expect(detectCms({})).toBe("unknown");
  });
});
