import { describe, expect, it } from "vitest";
import { islandSize, islandX, botPosition, chatPromptHeight } from "../src/core/layout";

describe("layout", () => {
  it("anchors the island to the chosen side of the window", () => {
    expect(islandX("left", 288, 720)).toBe(0);
    expect(islandX("center", 288, 720)).toBe(216);
    expect(islandX("right", 288, 720)).toBe(432);
    // Folded, the window is the notch itself: every placement starts at 0.
    for (const p of ["left", "center", "right"] as const) expect(islandX(p, 120, 120)).toBe(0);
  });

  it("keeps Coucou's sizes", () => {
    expect(islandSize("hidden", "chat")).toEqual({ w: 120, h: 24, r: 10 });
    expect(islandSize("compact", "chat")).toEqual({ w: 288, h: 32, r: 14 });
    expect(islandSize("expanded", "chat", 0)).toEqual({ w: 640, h: 240, r: 22 });
    expect(chatPromptHeight(5)).toBe(300);
  });

  it("places the face where Coucou does", () => {
    expect(botPosition("compact", "chat", 32)).toEqual({ cx: 40, cy: 16, diameter: 20, opacity: 1 });
    expect(botPosition("expanded", "chat", 240).cx).toBe(52);
    expect(botPosition("hidden", "chat", 24).opacity).toBe(0);
  });
});
