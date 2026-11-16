// Entry point: fit the zoom, boot from Rust, wire events, start the island.

import "./style.css";
import { Bridge, DEFAULT_SETTINGS, IS_TAURI, onEvent, type Settings } from "./core/bridge";
import type { Placement } from "./core/layout";
import { Sound } from "./core/sound";
import { Island } from "./island/island";

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  // Before the island exists: its canvas sizes its bitmap from the pixel ratio,
  // so the zoom correction has to land first.
  const dprBefore = window.devicePixelRatio || 1;
  if (await Bridge.fitZoom(dprBefore)) {
    for (let i = 0; i < 20 && window.devicePixelRatio === dprBefore; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  const island = new Island(root);
  if (import.meta.env.DEV) Object.assign(window, { __island: island });

  const boot = await Bridge.boot();
  let settings: Settings = { ...DEFAULT_SETTINGS, ...(boot?.settings ?? {}) };
  if (!IS_TAURI) {
    // Browser preview: ?placement=left|center|right.
    const p = new URLSearchParams(location.search).get("placement");
    if (p === "left" || p === "center" || p === "right") settings = { ...settings, placement: p as Placement };
  }
  island.applySettings(settings);

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));
  await onEvent<null>("closed-hover", () => island.wakeFromClosed());
  await onEvent<Settings>("settings-changed", (s) => island.applySettings({ ...DEFAULT_SETTINGS, ...s }));
  await onEvent<string>("tray", (what) => {
    if (what === "open") island.open();
  });

  const checkZoom = async () => {
    await Bridge.fitZoom(window.devicePixelRatio || 1);
  };
  await onEvent<null>("screen-changed", async () => {
    await checkZoom();
    void Bridge.reposition();
    island.ensureRunning();
  });
  // A query only matches the ratio it was made for: watch the new one after each change.
  const watchRatio = () => {
    window
      .matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      .addEventListener?.("change", () => {
        watchRatio();
        void checkZoom();
        island.ensureRunning();
      }, { once: true });
  };
  watchRatio();

  // No page zoom: the island is laid out in exact pixels.
  window.addEventListener("wheel", (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && ["+", "-", "=", "0"].includes(e.key)) e.preventDefault();
  });

  island.launch();

  if (!IS_TAURI) document.addEventListener("click", () => Sound.resume(), { once: true });
}

void main();
