// Island geometry, ported from Coucou's windows/src/core/layout.ts (MIT) and
// trimmed to the views this app has. Logical px, same values as Coucou.

export type IslandMode = "hidden" | "compact" | "expanded";

export type IslandViewName = "chat";

export type Placement = "left" | "center" | "right";

export type BotStateName =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "ratelimit"
  | "sleeping"
  | "dizzy";

export type BotEmoteName = "love" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";

export interface ViewLayout {
  height: number;
  botX: number;
  botY: number | null; // null = auto-centred on the card
  botDiameter: number;
}

/** The open window: the largest view, like Coucou's panel. */
export const PANEL_W = 720;
export const PANEL_H = 320;

export const NOTCH_W = 184;
export const NOTCH_H = 32;
export const COMPACT_W = 288;
export const EXPANDED_W = 640;

export const ROUNDED_CORNER = 14;
export const EXPANDED_CORNER = 22;

/** The folded notch (Coucou's "empty" closed island): a small black shape. */
export const CLOSED_W = 120;
export const CLOSED_H = 24;
export const CLOSED_RADIUS = 10;

export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  // Coucou's "prompt" view.
  chat: { height: 160, botX: 52, botY: null, botDiameter: 44 },
};

/** Chat grows with the conversation — IslandContainer.chatPromptHeight. */
export function chatPromptHeight(messageCount: number): number {
  return Math.min(300, 240 + messageCount * 40);
}

export function islandSize(
  mode: IslandMode,
  _view: IslandViewName,
  chatCount = 0,
): { w: number; h: number; r: number } {
  switch (mode) {
    case "hidden":
      return { w: CLOSED_W, h: CLOSED_H, r: CLOSED_RADIUS };
    case "compact":
      return { w: COMPACT_W, h: NOTCH_H, r: ROUNDED_CORNER };
    case "expanded":
      return { w: EXPANDED_W, h: chatPromptHeight(chatCount), r: EXPANDED_CORNER };
  }
}

/** Where the island starts inside the window, for the chosen placement. */
export function islandX(placement: Placement, islandW: number, viewportW: number): number {
  switch (placement) {
    case "left":
      return 0;
    case "right":
      return viewportW - islandW;
    default:
      return (viewportW - islandW) / 2;
  }
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

/** IslandRootView.botPosition — cy is measured from the island's top edge. */
export function botPosition(mode: IslandMode, view: IslandViewName, islandH: number): BotPlacement {
  switch (mode) {
    case "hidden":
      // The face is tucked away: it only shows once the pointer is on the notch.
      return { cx: 40, cy: 12, diameter: 6, opacity: 0 };
    case "compact":
      return { cx: 40, cy: 16, diameter: 20, opacity: 1 };
    case "expanded": {
      const layout = VIEW_LAYOUTS[view];
      if (layout.botY != null) {
        return { cx: layout.botX, cy: layout.botY, diameter: layout.botDiameter, opacity: 1 };
      }
      // Centre of the fixed 84 px card (8 px top inset + 34 px header → content at y = 42).
      const headerBottom = 42;
      const cardH = 84;
      const cy = headerBottom + (islandH - headerBottom - cardH) / 2 + cardH / 2;
      return { cx: layout.botX, cy, diameter: layout.botDiameter, opacity: 1 };
    }
  }
}

export function botGlowColor(s: BotStateName): string {
  switch (s) {
    case "working":
      return "#3B9EFF";
    case "thinking":
      return "#A78BFA";
    case "searching":
      return "#6366F1";
    case "approval":
      return "#F5A524";
    case "error":
      return "#F4505E";
    case "finished":
      return "#34D399";
    case "ratelimit":
      return "#F59E0B";
    default:
      return "#FFFFFF";
  }
}

export function botGlowOpacity(s: BotStateName): number {
  switch (s) {
    case "idle":
    case "sleeping":
      return 0.15;
    case "dizzy":
      return 0;
    default:
      return 0.65;
  }
}
