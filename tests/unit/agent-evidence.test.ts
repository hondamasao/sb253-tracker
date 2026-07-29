import { describe, expect, it } from "vitest";
import { buildEvidenceList, formatEvidenceForPrompt } from "@/agents/shared/evidence";

describe("buildEvidenceList", () => {
  it("numbers facts sequentially as EV1, EV2, ...", () => {
    const evidence = buildEvidenceList(["First fact.", "Second fact.", "Third fact."]);
    expect(evidence).toEqual([
      { id: "EV1", fact: "First fact." },
      { id: "EV2", fact: "Second fact." },
      { id: "EV3", fact: "Third fact." },
    ]);
  });

  it("drops null, undefined, false, and blank entries without leaving gaps in the numbering", () => {
    const evidence = buildEvidenceList(["Kept one.", null, undefined, false, "  ", "Kept two."]);
    expect(evidence).toEqual([
      { id: "EV1", fact: "Kept one." },
      { id: "EV2", fact: "Kept two." },
    ]);
  });

  it("trims whitespace around each fact", () => {
    const evidence = buildEvidenceList(["  padded fact  "]);
    expect(evidence[0]?.fact).toBe("padded fact");
  });

  it("returns an empty array when every candidate is falsy", () => {
    expect(buildEvidenceList([null, undefined, false, ""])).toEqual([]);
  });
});

describe("formatEvidenceForPrompt", () => {
  it("renders one 'ID: fact' line per item", () => {
    const evidence = buildEvidenceList(["Fact A.", "Fact B."]);
    expect(formatEvidenceForPrompt(evidence)).toBe("EV1: Fact A.\nEV2: Fact B.");
  });

  it("returns a placeholder string for an empty evidence list", () => {
    expect(formatEvidenceForPrompt([])).toContain("No evidence");
  });
});
