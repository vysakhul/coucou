// Calls into Rust. Outside Tauri (plain `npm run dev` in a browser) every call
// is a no-op, so the island can be previewed and tested without the shell.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Placement } from "./layout";

export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Settings {
  placement: Placement;
  /** Gap between the notch and the screen corner for left / right, logical px. */
  edgeMargin: number;
  /** Open island → compact after this many idle seconds. */
  autoCloseInterval: number;
  /** Compact → folded notch after this many idle seconds. */
  hideDelay: number;
  /** Resting the pointer on the face opens the chat. */
  faceHoverOpen: boolean;
  soundEnabled: boolean;
  soundVolume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  placement: "center",
  edgeMargin: 12,
  autoCloseInterval: 15,
  hideDelay: 10,
  faceHoverOpen: true,
  soundEnabled: true,
  soundVolume: 0.12,
};

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.warn(`${cmd} failed`, err);
    return null;
  }
}

export const Bridge = {
  boot: () => call<{ settings: Settings }>("boot"),
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),
  setCollapsed: (collapsed: boolean, width?: number, height?: number) =>
    call<void>("set_collapsed", { collapsed, width, height }),
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),
  reposition: () => call<void>("reposition"),
  fitZoom: async (dpr: number) => (await call<boolean>("fit_zoom", { dpr })) === true,
};

export async function onEvent<T>(name: string, handler: (payload: T) => void): Promise<void> {
  if (!IS_TAURI) return;
  await listen<T>(name, (e) => handler(e.payload));
}
