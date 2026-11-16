// Outfits are left out of this app. These stand-ins keep engine.ts identical
// to Coucou's: with the outfit always "none", none of them is ever drawn.

import type { Outfit } from "./wardrobe";

export const PUMPKIN_BODY: readonly [string, string] = ["#000", "#000"];

export type Head = Record<string, never>;

export function makeHead(_R: number, _yaw: number, _pitch: number, _dx: number, _dy: number): Head {
  return {};
}

export function drawOutfitBehind(
  _ctx: CanvasRenderingContext2D,
  _outfit: Outfit,
  _head: Head,
  _state: { presence: number; morph: number },
) {}

export function drawOutfitFront(
  _ctx: CanvasRenderingContext2D,
  _outfit: Outfit,
  _head: Head,
  _state: { presence: number; morph: number },
) {}
