import { describe, expect, it } from "vitest";
import { detectIndustry } from "@/agents/shared/detect-industry";

describe("detectIndustry", () => {
  it("detects plumbing from trade keywords", () => {
    expect(detectIndustry(["We are your local plumber for drain cleaning and water heater repair."])).toBe(
      "plumbing",
    );
  });

  it("detects hvac from trade keywords", () => {
    expect(detectIndustry(["Expert furnace and air conditioning repair, plus ductwork."])).toBe("hvac");
  });

  it("returns null when no trade keyword clears the bar", () => {
    expect(detectIndustry(["We build custom furniture and cabinetry."])).toBeNull();
  });

  it("picks the trade with the most keyword matches across pages", () => {
    const pages = [
      "Roofing repair and roof replacement services.",
      "Ask about our storm damage roof repair program.",
      "We also do a bit of plumbing on the side.",
    ];
    expect(detectIndustry(pages)).toBe("roofing");
  });
});
