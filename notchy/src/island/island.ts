// The island: DOM shell, sizing animation, Mochi placement, mouse handling.
// A trimmed port of Coucou's windows/src/island/island.ts (MIT): same springs,
// curves, timings and hit tests, with one chat view, and placement at the
// top-left, top-middle or top-right of the screen.

import { Spring, Tracked, clamp } from "../core/anim";
import { Bridge, IS_TAURI, type Settings, DEFAULT_SETTINGS } from "../core/bridge";
import {
  CLOSED_H, CLOSED_W, PANEL_W, botGlowColor, botGlowOpacity, botPosition, islandSize, islandX,
  type BotStateName, type IslandMode, type IslandViewName,
} from "../core/layout";
import { Sound } from "../core/sound";
import { BotEngine } from "../mochi/engine";
import { ChatView } from "../views/chat";
import { h, svg, ICONS } from "../views/dom";
import { IslandStateMachine } from "./fsm";

/** Extra canvas above Mochi so hearts and z's can fly out without clipping. */
const BOT_OVERHANG = 40;
/** Extra canvas on each side of Mochi. */
const BOT_SIDE = 24;
/** Same margin as the Rust hit test (src-tauri/src/island.rs). */
const HIT_MARGIN = 14;

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

export class Island {
  readonly fsm = new IslandStateMachine();
  settings: Settings = { ...DEFAULT_SETTINGS };
  mode: IslandMode = "hidden";
  view: IslandViewName = "chat";
  /** Overrides Mochi's state while something happens (thinking, dizzy). */
  stateOverride: BotStateName | null = null;

  private root: HTMLElement;
  private islandEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private soundBtn!: HTMLButtonElement;
  private botCanvas!: HTMLCanvasElement;
  private botGlow!: HTMLElement;
  private countdown!: HTMLElement;
  private chat: ChatView;

  private width = new Tracked(CLOSED_W);
  private height = new Tracked(CLOSED_H);
  private radius = new Tracked(10);
  private botCx = new Spring(40);
  private botCy = new Spring(12);
  private botSize = new Spring(10);

  private engine = new BotEngine();

  private running = false;
  private lastFrame = 0;
  private dirty = true;
  private canvasPx = 0;
  private canvasDpr = 0;

  // Rust starts the window at full panel size.
  private collapsed = false;
  private collapseTimer: number | null = null;
  private wasInIsland = false;
  private pushedRect = { x: -1, y: -1, w: -1, h: -1 };
  private mouse = { x: -10_000, y: -10_000 };
  private typing = false;

  // Bot hover → love (IslandWindowController.botHoverIn)
  private botHovering = false;
  private botHoverTimer: number | null = null;
  private lastLoveTime = 0;
  private botHoverStart = { x: 0, y: 0 };
  private overFace = false;
  private dizzyRecovery: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.chat = new ChatView({
      onHeightChange: () => {
        if (this.mode === "expanded") this.animateGeometry(false);
      },
      send: (text) => this.answer(text),
      activity: () => this.activity(),
      close: () => this.collapse(),
    });
    this.build();
    this.wireFsm();
    this.wireInput();
    this.engine.onDizzy = () => this.handleDizzy();
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private build() {
    const tabChat = h("button", { class: "tab on", title: "Chat" }, svg(ICONS.bubbleRound, 19));
    this.soundBtn = h("button", { title: "Mute", onclick: () => this.toggleSound() }, svg(ICONS.speaker, 18, { stroke: 1.6 }));
    const closeBtn = h("button", { class: "close", title: "Close", onclick: () => this.collapse() }, svg(ICONS.xmark, 17));
    this.headerEl = h(
      "div",
      { id: "header" },
      h("div", { class: "tabs" }, tabChat),
      h("div", { class: "header-actions" }, this.soundBtn, closeBtn),
    );
    const viewsEl = h("div", { id: "views" }, this.chat.el);
    this.contentEl = h("div", { id: "content" }, this.headerEl, viewsEl);

    this.botGlow = h("div", { id: "bot-glow" });
    this.botCanvas = h("canvas", { id: "bot-canvas" });
    this.countdown = h("div", { id: "countdown" });
    this.islandEl = h(
      "div",
      { id: "island" },
      h("div", { id: "island-clip" }, this.contentEl),
      this.botGlow,
      this.botCanvas,
      this.countdown,
    );
    this.root.append(this.islandEl);
    this.applyGeometry();
  }

  // ── FSM ─────────────────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.onTransition = (from, to) => {
      switch (to) {
        case "hidden":
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "hidden") Sound.play("peek");
          this.setMode("compact");
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.setMode("expanded");
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "coucou":
          break;
      }
      this.markDirty();
    };
  }

  /** At launch: the face peeks out and waves, then folds away when idle. */
  launch() {
    this.fsm.reveal();
    window.setTimeout(() => {
      this.engine.greet();
      this.ensureRunning();
    }, 350);
  }

  private setMode(mode: IslandMode) {
    const prev = this.mode;
    if (mode === prev) return;
    this.mode = mode;
    if (mode === "expanded") Sound.play("open");
    if (prev === "expanded") {
      Sound.play("close");
      this.setTyping(false);
    }
    if (mode !== "expanded") this.cancelBotHover();
    this.updateWindowCollapsed();
    this.animateGeometry(modeOrder(mode) < modeOrder(prev));
    this.markDirty();
  }

  collapse() {
    this.fsm.pinned = false;
    this.fsm.forcePetit();
  }

  /** Opens the island on the chat, e.g. from the tray. */
  open() {
    this.fsm.forceHome();
  }

  private activity() {
    this.fsm.userInteracted();
    this.fsm.activity();
  }

  private toggleSound() {
    this.settings.soundEnabled = !this.settings.soundEnabled;
    Sound.setEnabled(this.settings.soundEnabled);
    void Bridge.saveSettings(this.settings);
    this.markDirty();
  }

  /** The assistant's answer. Instructions are understood in a later milestone. */
  private async answer(text: string): Promise<string> {
    Sound.play("send");
    this.stateOverride = "thinking";
    this.markDirty();
    await new Promise((r) => setTimeout(r, 700));
    this.stateOverride = null;
    this.engine.triggerEmote("happy");
    Sound.play("finish");
    this.markDirty();
    return `Got it: “${text}”. Setting alarms and reminders comes in the next update.`;
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  private targetSize() {
    return islandSize(this.mode, this.view, this.chat.messages.length);
  }

  private animateGeometry(shrinking: boolean) {
    const { w, h: hh, r } = this.targetSize();
    if (shrinking) {
      this.width.curveTowards(w);
      this.height.curveTowards(hh);
      this.radius.curveTowards(r);
    } else {
      this.width.springTo(w);
      this.height.springTo(hh);
      this.radius.springTo(r);
    }
    this.ensureRunning();
  }

  /** Island rect in window coordinates (origin top-left of the window). */
  private islandRect(): { x: number; y: number; w: number; h: number } {
    const w = this.width.value;
    const viewportW = window.innerWidth > 0 ? window.innerWidth : PANEL_W;
    return { x: islandX(this.settings.placement, w, viewportW), y: 0, w, h: this.height.value };
  }

  private applyGeometry() {
    const rect = this.islandRect();
    const r = this.radius.value;
    this.islandEl.style.left = `${rect.x}px`;
    this.islandEl.style.width = `${rect.w}px`;
    this.islandEl.style.height = `${rect.h}px`;
    this.islandEl.style.borderRadius = `0 0 ${r}px ${r}px`;

    const p = this.pushedRect;
    if (Math.abs(p.x - rect.x) > 0.5 || Math.abs(p.w - rect.w) > 0.5 || Math.abs(p.h - rect.h) > 0.5) {
      this.pushedRect = rect;
      void Bridge.setIslandRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  // ── Window collapse (folded → window shrinks to the notch, zero polling) ────

  private updateWindowCollapsed() {
    if (this.collapseTimer != null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    if (this.mode === "hidden") {
      // Let the island finish folding, then shrink the window to the notch.
      this.collapseTimer = window.setTimeout(() => {
        this.collapseTimer = null;
        if (this.mode !== "hidden") return;
        this.collapsed = true;
        void Bridge.setCollapsed(true, CLOSED_W, CLOSED_H);
      }, 420);
    } else if (this.collapsed) {
      // Grow the window back before the island animates open.
      this.collapsed = false;
      void Bridge.setCollapsed(false);
    }
  }

  /** The pointer is on the folded window (Rust's `closed-hover`). */
  wakeFromClosed() {
    if (this.mode !== "hidden") return;
    Sound.resume();
    this.fsm.mouseEntered();
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private wireInput() {
    this.root.addEventListener("mouseover", () => {
      if (this.collapsed) this.wakeFromClosed();
    });

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      this.activity();
      if (this.mode !== "expanded") {
        this.fsm.click();
        return;
      }
      if (e.button === 0 && this.isBotHit(e.clientX, e.clientY)) {
        this.cancelBotHover();
        this.engine.slap();
        this.ensureRunning();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.mode === "expanded") this.collapse();
      this.activity();
    });

    if (!IS_TAURI) this.followPageCursor();
  }

  /** Outside Tauri the cursor comes from the page's own mouse events. */
  followPageCursor() {
    window.addEventListener("mousemove", (e) => this.onCursor(e.clientX, e.clientY));
    window.addEventListener("mouseout", (e) => {
      if (e.relatedTarget == null) this.onCursor(-10_000, -10_000);
    });
  }

  /** Cursor in window-logical coordinates. */
  onCursor(x: number, y: number) {
    this.mouse = { x, y };
    const rect = this.islandRect();
    const inIsland =
      x >= rect.x - HIT_MARGIN && x <= rect.x + rect.w + HIT_MARGIN &&
      y >= rect.y - HIT_MARGIN && y <= rect.y + rect.h + HIT_MARGIN;

    const wasIn = this.wasInIsland;
    this.wasInIsland = inIsland;
    if (inIsland && !wasIn) this.fsm.mouseEntered();
    if (!inIsland && wasIn) this.fsm.mouseLeft();

    // Compact: resting on the face opens the chat.
    const face = this.mode === "compact" && this.isBotHit(x, y);
    if (face && !this.overFace) this.fsm.faceEntered();
    if (!face && this.overFace) this.fsm.faceLeft();
    this.overFace = face;

    // Expanded: resting on Mochi → love.
    const overBot = this.mode === "expanded" && this.stateOverride == null && this.isBotHit(x, y);
    if (overBot && !this.botHovering) this.botHoverIn(x, y);
    if (!overBot && this.botHovering) this.cancelBotHover();
    this.botHovering = overBot;
    if (this.botHovering) {
      const d = Math.hypot(x - this.botHoverStart.x, y - this.botHoverStart.y);
      if (d > 40) {
        this.botHoverStart = { x, y };
        this.scheduleLove();
      }
    }

    this.ensureRunning();
  }

  private isBotHit(x: number, y: number): boolean {
    const rect = this.islandRect();
    const cx = rect.x + this.botCx.value;
    const cy = rect.y + this.botCy.value;
    const radius = this.botSize.value / 2;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  }

  private botHoverIn(x: number, y: number) {
    if (performance.now() / 1000 - this.lastLoveTime < 6) return;
    this.botHoverStart = { x, y };
    this.engine.blink();
    this.engine.tgEs = 1.08;
    Sound.play("hover");
    this.scheduleLove();
  }

  private scheduleLove() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = window.setTimeout(() => {
      this.botHoverTimer = null;
      if (!this.botHovering || this.stateOverride != null) return;
      if (performance.now() / 1000 - this.lastLoveTime < 6) return;
      this.lastLoveTime = performance.now() / 1000;
      this.engine.triggerEmote("love");
      Sound.play("love");
      this.ensureRunning();
    }, 1900);
  }

  private cancelBotHover() {
    if (this.botHoverTimer != null) window.clearTimeout(this.botHoverTimer);
    this.botHoverTimer = null;
    this.botHovering = false;
    this.engine.tgEs = 1;
  }

  /** Three slaps → dizzy for 3.3 s, then happy again. */
  private handleDizzy() {
    this.stateOverride = "dizzy";
    this.engine.setState("dizzy");
    Sound.play("dizzy");
    this.markDirty();
    if (this.dizzyRecovery != null) window.clearTimeout(this.dizzyRecovery);
    this.dizzyRecovery = window.setTimeout(() => {
      this.dizzyRecovery = null;
      this.stateOverride = null;
      this.engine.triggerEmote("happy");
      this.markDirty();
    }, 3300);
  }

  /** The chat is the only view with a text field: the island takes the keyboard. */
  private setTyping(on: boolean) {
    if (this.typing === on) return;
    this.typing = on;
    void Bridge.focusWindow(on);
    if (on) window.setTimeout(() => this.chat.focus(), 120);
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  private markDirty() {
    this.dirty = true;
    this.ensureRunning();
  }

  ensureRunning() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.radius.step(dt, nowMs);
    this.applyGeometry();

    if (this.dirty) {
      this.dirty = false;
      this.syncDom();
    }

    this.updateBotTargets();
    this.botCx.step(dt);
    this.botCy.step(dt);
    this.botSize.step(dt);
    this.drawBot(dt);
    this.updateCountdown(nowMs);

    const settling = this.width.animating || this.height.animating || this.radius.animating;
    const botMoving = !this.botCx.settled || !this.botCy.settled || !this.botSize.settled;
    // Folded, nothing is drawn, so nothing may keep the loop alive but the folding itself.
    const busy = this.mode === "hidden"
      ? settling || botMoving
      : settling || botMoving || this.engine.busy || this.fsm.homeCollapseDueAt != null;

    if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
    }
  };

  private get botState(): BotStateName {
    return this.stateOverride ?? "idle";
  }

  private updateBotTargets() {
    const p = botPosition(this.mode, this.view, this.height.value);
    this.botCx.target = p.cx;
    this.botCy.target = p.cy;
    this.botSize.target = p.diameter / 0.6;
    this.botCanvas.style.opacity = p.opacity > 0 ? "1" : "0";

    if (this.mode === "expanded") {
      const d = p.diameter;
      const state = this.botState;
      this.botGlow.style.display = "block";
      this.botGlow.style.width = `${d * 2.2}px`;
      this.botGlow.style.height = `${d * 2.2}px`;
      this.botGlow.style.left = `${this.botCx.value - d * 1.1}px`;
      this.botGlow.style.top = `${this.botCy.value - d * 1.1}px`;
      this.botGlow.style.background = `radial-gradient(circle, ${botGlowColor(state)} 0%, transparent 62%)`;
      this.botGlow.style.opacity = String(botGlowOpacity(state));
    } else {
      this.botGlow.style.display = "none";
    }
  }

  private drawBot(dt: number) {
    const size = this.botSize.value;
    const w = Math.max(1, Math.round(size));
    const hCss = w + BOT_OVERHANG;
    const wCss = w + BOT_SIDE * 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvasPx !== w || this.canvasDpr !== dpr) {
      this.canvasPx = w;
      this.canvasDpr = dpr;
      this.botCanvas.width = Math.round(wCss * dpr);
      this.botCanvas.height = Math.round(hCss * dpr);
      this.botCanvas.style.width = `${wCss}px`;
      this.botCanvas.style.height = `${hCss}px`;
    }
    this.botCanvas.style.left = `${this.botCx.value - wCss / 2}px`;
    this.botCanvas.style.top = `${this.botCy.value - BOT_OVERHANG / 2 - hCss / 2}px`;

    const ctx = this.botCanvas.getContext("2d");
    if (!ctx) return;

    this.engine.setState(this.botState);
    this.engine.particleOverhang = BOT_OVERHANG;
    this.engine.lookX = this.lookX();
    this.engine.lookY = this.lookY();
    this.engine.update(dt);
    // Cleared in device pixels: at 150 % a CSS-unit clear leaves a half row behind.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.botCanvas.width, this.botCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, BOT_SIDE * dpr, 0);
    ctx.save();
    this.engine.draw(ctx, w, hCss);
    ctx.restore();
  }

  /** BotCanvasView.lookX / lookY — tanh of the distance to the bot. */
  private lookX(): number {
    const rect = this.islandRect();
    return Math.tanh((this.mouse.x - (rect.x + this.botCx.value)) / 260);
  }

  private lookY(): number {
    return -Math.tanh((this.mouse.y - this.botCy.value) / 200);
  }

  private updateCountdown(nowMs: number) {
    const dueAt = this.fsm.homeCollapseDueAt;
    if (this.mode !== "expanded" || this.fsm.pinned || dueAt == null) {
      this.countdown.style.width = "0px";
      return;
    }
    const windowS = Math.min(10, this.fsm.homeToPetitDelay * 0.6);
    const remaining = (dueAt - nowMs) / 1000;
    this.countdown.style.width =
      remaining < windowS ? `${Math.max(0, clamp(remaining / windowS, 0, 1) * 160)}px` : "0px";
  }

  // ── DOM sync ────────────────────────────────────────────────────────────────

  private syncDom() {
    const expanded = this.mode === "expanded";
    this.contentEl.style.opacity = expanded ? "1" : "0";
    this.contentEl.style.pointerEvents = expanded ? "auto" : "none";
    this.chat.el.classList.toggle("on", expanded && this.view === "chat");
    this.soundBtn.classList.toggle("on", this.settings.soundEnabled);
    this.soundBtn.title = this.settings.soundEnabled ? "Mute" : "Unmute";
    this.setTyping(expanded && this.view === "chat");
  }

  /** Settings from Rust at boot, or changed from the tray / settings. */
  applySettings(s: Settings) {
    const moved = s.placement !== this.settings.placement;
    this.settings = { ...s };
    document.documentElement.dataset.placement = s.placement;
    Sound.setEnabled(s.soundEnabled);
    Sound.setVolume(s.soundVolume);
    this.fsm.homeToPetitDelay = s.autoCloseInterval;
    this.fsm.petitToHiddenDelay = s.hideDelay;
    this.fsm.faceHoverOpen = s.faceHoverOpen;
    if (moved) this.pushedRect = { x: -1, y: -1, w: -1, h: -1 };
    this.markDirty();
  }
}
