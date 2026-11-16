import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// fsm.ts schedules with window.setTimeout.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

const { IslandStateMachine } = await import("../src/island/fsm");

/**
 * Wired like island.ts: after a transition, a pointer outside the island
 * re-arms the idle timer. The pointer starts on the island.
 */
function machine() {
  const fsm = new IslandStateMachine();
  const seen: string[] = [];
  let inside = true;
  fsm.onTransition = (_from, to) => {
    seen.push(to);
    if ((to === "petit" || to === "home") && !inside) fsm.mouseLeft();
  };
  const leave = () => {
    inside = false;
    fsm.mouseLeft();
  };
  const enter = () => {
    inside = true;
    fsm.mouseEntered();
  };
  return { fsm, seen, enter, leave };
}

describe("island state machine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("peeks on hover and opens after resting on the face", () => {
    const { fsm, enter } = machine();
    enter();
    expect(fsm.state).toBe("petit");
    fsm.faceEntered();
    vi.advanceTimersByTime(499);
    expect(fsm.state).toBe("petit");
    vi.advanceTimersByTime(1);
    expect(fsm.state).toBe("home");
    expect(fsm.openedByHover).toBe(true);
  });

  it("does not open when the pointer leaves the face early", () => {
    const { fsm, enter } = machine();
    enter();
    fsm.faceEntered();
    vi.advanceTimersByTime(300);
    fsm.faceLeft();
    vi.advanceTimersByTime(1000);
    expect(fsm.state).toBe("petit");
  });

  it("face hover can be turned off", () => {
    const { fsm, enter } = machine();
    fsm.faceHoverOpen = false;
    enter();
    fsm.faceEntered();
    vi.advanceTimersByTime(2000);
    expect(fsm.state).toBe("petit");
  });

  it("folds back into the notch after the idle delays", () => {
    const { fsm, seen, enter, leave } = machine();
    fsm.homeToPetitDelay = 15;
    fsm.petitToHiddenDelay = 10;
    enter();
    fsm.click();
    expect(fsm.state).toBe("home");
    leave();
    vi.advanceTimersByTime(15_000);
    expect(fsm.state).toBe("petit");
    vi.advanceTimersByTime(10_000);
    expect(fsm.state).toBe("hidden");
    expect(seen).toEqual(["petit", "home", "petit", "hidden"]);
  });

  it("stays open while the pointer is on it", () => {
    const { fsm, enter } = machine();
    enter();
    fsm.click();
    vi.advanceTimersByTime(120_000);
    expect(fsm.state).toBe("home");
  });

  it("activity restarts the idle countdown", () => {
    const { fsm, enter, leave } = machine();
    fsm.homeToPetitDelay = 15;
    enter();
    fsm.click();
    leave();
    vi.advanceTimersByTime(10_000);
    fsm.activity();
    vi.advanceTimersByTime(10_000);
    expect(fsm.state).toBe("home");
    vi.advanceTimersByTime(5_000);
    expect(fsm.state).toBe("petit");
  });

  it("a hover-opened island folds 0.6 s after the pointer leaves, unless clicked", () => {
    const { fsm, enter, leave } = machine();
    enter();
    fsm.faceEntered();
    vi.advanceTimersByTime(500);
    leave();
    vi.advanceTimersByTime(600);
    expect(fsm.state).toBe("petit");

    enter();
    fsm.faceEntered();
    vi.advanceTimersByTime(500);
    fsm.userInteracted();
    leave();
    vi.advanceTimersByTime(600);
    expect(fsm.state).toBe("home");
  });

  it("a pinned island never folds on its own", () => {
    const { fsm, leave } = machine();
    fsm.forceHome();
    fsm.pinned = true;
    leave();
    vi.advanceTimersByTime(120_000);
    expect(fsm.state).toBe("home");
  });
});
