# Coucou / Mochi — reference notes (for the notch-assistant clone)

Purpose: everything we need from the Coucou repo so we never have to re-read it.
Scope: the **Windows (Tauri 2) build in `windows/`** — island window, state machine,
character, chat, local LLM, sounds, settings. Integrations (Claude Code hooks,
mail, WhatsApp, Spotify, phone link, recap, wardrobe, flow/voice…) are ignored.

All paths are relative to the repo root. Line numbers are from commit `0d7fe58`.

---

## 0. Licence — read first

- `LICENSE`: **MIT** for the source code (© Louis Raillé).
- `LICENSE-ASSETS.md`: **not MIT** — the names "Coucou"/"Mochi", **the Mochi
  character (design, look, expressions, animations)**, icons, **all sounds**
  (`NotchBuddy/Resources/sounds/`) and everything in `design/` and `docs/media/`.
- Allowed: build and run it for yourself, fork, contribute back.
- Not allowed without written permission (raillelouis@gmail.com): distributing an
  app/fork that uses the name, the Mochi character, the icon or the sounds.
- Consequence: an exact Mochi clone is fine **for personal use only**. To share or
  ship our assistant we need permission, or our own character + sounds. Our
  architecture therefore keeps the character and the sounds swappable.

---

## 1. Tech stack (Windows build)

| Layer | What |
|---|---|
| Shell | Tauri 2 (`windows/src-tauri/`), Rust, `windows` crate 0.61 (Win32 window styles, cursor) |
| UI | Vanilla TypeScript + Vite 6, no framework; tiny `h()` DOM helper in `windows/src/views/dom.ts` |
| Character | Canvas 2D, drawn in code (`windows/src/mochi/engine.ts`), no images/Lottie |
| Audio | WebAudio playing WAVs (`windows/src/core/sound.ts`) |
| Plugins kept by a minimal clone | `tauri-plugin-single-instance`, `tauri-plugin-autostart`, (`tauri-plugin-global-shortcut`) |
| HTTP (LLM) | `reqwest` 0.12 + rustls in Rust (`local_chat.rs`) |

Run: `cd windows && npm install && npm run tauri dev`.

---

## 2. The island window (fake notch)

### 2.1 Window
`windows/src-tauri/tauri.conf.json` — one window, label `island`:
`decorations:false, transparent:true, shadow:false, alwaysOnTop:true,
skipTaskbar:true, focus:false, resizable:false, closable/minimizable/maximizable:false,
dragDropEnabled:false`, initial size 240×6.
`additionalBrowserArgs: --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required`
(the autoplay flag lets sounds play with no user gesture — needed for alarms).

Sizes (`windows/src-tauri/src/island.rs:14-23`):
- Open window = **720×320 logical** panel (largest view). The island is drawn inside.
- Folded window shrinks to just the closed shape (e.g. 120×24) or a **240×6
  invisible wake strip** when the closed style is "hidden".

### 2.2 Placement (`apply_geometry`, `island.rs:428-469`)
- Monitor: saved key → monitor under cursor → primary (`target_monitor`, `:250`).
- `pw = round(lw*scale)`; **`x = monitor.x + (monitor.width - pw)/2`** (`:439`, always centred);
  `y = monitor.y + top_inset` where `top_inset` = height of a top-docked taskbar (0..200).
- `set_size` + `set_position` in physical px, re-assert always-on-top, verify size, retry once.
- DPI: `fit_zoom(dpr)` (`lib.rs:226`, `calculate_zoom_correction` `island.rs:315`) sets the
  WebView2 zoom when its `devicePixelRatio` differs from the monitor scale by >2%.
- Monitor changes: poll thread checks the screen key every ~0.5 s → emits `screen-changed`
  → page calls `fitZoom` + `reposition`.

### 2.3 Click-through & hover (Windows)
`spawn_cursor_poll` (`island.rs:493`), `platform/windows.rs`:
- Rust thread reads `GetCursorPos` every **16 ms** (50 ms when the cursor is far).
- Page pushes the island rect with `set_island_rect`. `on_island = cursor within rect ± 14 px`
  (`HIT_MARGIN`). Left button held (`GetAsyncKeyState`) also counts (keeps drags working).
- Only when that flips: `win.set_ignore_cursor_events(!accept)` (WS_EX_TRANSPARENT|LAYERED),
  then re-apply overlay ex-style bits on the main thread (`windows.rs:379`).
- Emits `cursor {x,y}` (window-logical) to the page only within **420 px** of the window
  (Mochi's eyes follow it); one "far" event, then silence.
- Folded: the poll parks on a condvar; wakes every 250 ms to run `wake_if_hovered`
  (`:617`) → if cursor is on the folded window: disable click-through, emit `closed-hover`.
- Result: ~0% CPU when hidden.

### 2.4 Focus (typing without stealing focus)
- Startup: `make_non_activating` (`windows.rs:346`) → `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`,
  clear `WS_EX_APPWINDOW`. Clicking the island never steals focus.
- Typing views: page calls `focus_window(true)` (`lib.rs:206`) → clear NOACTIVATE +
  `set_focus()`; `focus_window(false)` restores it when leaving. Page waits 120 ms then
  focuses the input (`island.ts:1498-1508`).

### 2.5 Shape (pure CSS, `windows/src/style.css:73-90`)
- `#island { position:absolute; top:0; left:50%; transform:translateX(-50%);
  background:#000; border-radius:0 0 r r; }` — square top corners merge with the screen edge.
  **No shadow, no concave "shoulders".**
- `#island-clip { inset:0; overflow:hidden; border-radius:inherit }` holds view content.
  Mochi's canvas, glow and countdown sit outside the clip (can overflow).

| Mode | W × H | radius | bot (cx, cy, Ø) |
|---|---|---|---|
| hidden, closed style shown | 80…280 (Mochi style 120) × **24** | 10 | centre, Ø 18 |
| hidden, "hidden" style | 184 × **0** (slides into top edge) | 14 | opacity 0 |
| compact ("petit") | **288 × 32** | 14 | (40, 16), Ø 20 |
| expanded ("home") | **640** × per view (150–240); chat `min(300, 240+40·msgs)` | **22** | per view (chat: x 52, Ø 44) |

Constants: `windows/src/core/layout.ts` (`NOTCH_W 184, NOTCH_H 32, COMPACT_W 288,
EXPANDED_W 640, ROUNDED_CORNER 14, EXPANDED_CORNER 22`, `VIEW_LAYOUTS`, `botPosition`),
`windows/src/core/closed.ts` (`CLOSED_H 24, CLOSED_MIN_W 80, CLOSED_MAX_W 280,
CLOSED_BOT_D 18, CLOSED_PAD 16`; styles `mochi|time|datetime|claude|music|empty|hidden`).
Expanded bot cy auto-centres on an 84 px card under a 42 px header:
`cy = 42 + (h-42-84)/2 + 42`.

### 2.6 Morph animation (`windows/src/core/anim.ts`)
- `Tracked` value per width/height/radius:
  - **Grow** → SwiftUI-style spring, `response 0.5`, `damping 0.72`
    (ω = 2π/response, ζ = damping), integrated in 1/240 s sub-steps.
  - **Shrink** → 340 ms `cubic-bezier(.45,0,.2,1)`.
  - Shrinking = new mode lower than old (hidden 0 < compact 1 < expanded 2).
- Mochi's `cx/cy/size` are plain springs (0.5 / 0.72) so he glides with the island;
  his size target is `diameter/0.6`.
- One `requestAnimationFrame` loop (`island.ts:1252`), `dt` capped at 0.05 s, **stops
  itself when everything settled**.
- View cross-fade (`style.css:366-385`): off = `opacity 0, scale .97, .16s ease-in`;
  on = `opacity 1, scale 1, .3s ease-out` + `.3s cubic-bezier(.3,1.2,.4,1)`, both delayed .16 s.
- Window shrinks 420 ms after entering hidden (`updateWindowCollapsed`, `island.ts:917`).

### 2.7 Look & feel tokens
- Island `#000`; cards `#141518`, radius 20, 1 px `rgba(255,255,255,.035)` border,
  radial "wash" in `::after` (chat wash `rgba(99,102,241,.5)`, others in `layout.ts washRGBA`).
- Text `--ink #f5f6f8`, dim `--dim-3 #6b7079`. Font
  `system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif`; mono `Cascadia Mono`.
- Auto-close **countdown bar** (`island.ts:1454`, `style.css:155`): 2 px
  `rgba(255,255,255,.35)` at the island's bottom centre; visible in the last
  `min(10, autoClose·0.6)` s, shrinks 160 px → 0.
- Header: tabs + gear + speaker + **✕** (✕ → compact). `Esc` → compact.

---

## 3. Island state machine (`windows/src/island/fsm.ts`, verbatim-portable, no DOM)

States: `hidden` (folded) · `petit` (compact, face visible) · `home` (expanded) ·
`coucou` (launch greeting).

| Timer | Default |
|---|---|
| `homeToPetitDelay` (setting `autoCloseInterval`, 5–120) | **15 s** |
| `petitToHiddenDelay` | **60 s** |
| `hoverOpenDelay` (only with `openOnHover`) | 0.5 s |
| `hoverCloseDelay` (island opened by hover, not clicked) | 0.6 s |
| `greetAutoCollapseDelay` / `greetHoverCollapseDelay` | 0.6 s / 10 s |

Transitions:
- `mouseEntered`: hidden→petit (+ hover-open timer if `openOnHover`); petit: cancel hide
  timer; home: cancel collapse timer; coucou: collapse in 10 s.
- `mouseLeft`: petit → arm 60 s hide; home → arm collapse (0.6 s if opened by hover,
  else 15 s); coucou → petit.
- `click()` petit→home. `userInteracted()` (any mousedown inside) turns a hover-open
  into a normal open.
- `forceHome()` (alerts, tray, shortcut), `forcePetit()` (✕, Esc, OK), `forceHidden()`
  (pause), `reveal()` hidden→petit for non-alert events.
- `pinned = true` disables both auto timers (used for alerts and typing views).
- **Only mouse-leave arms timers** — there is no keyboard-activity idle timer. A clone that
  wants "hide after N s of no interaction" must re-arm on keydown/typing too.
- **There is no "hover the face → chat" step** in the original; the nearest is `openOnHover`.

Island wiring (`windows/src/island/island.ts`, 1584 lines): `build`, `wireFsm`, `setMode`,
`animateGeometry`, `applyGeometry` (`:882`), `islandRect` (`:912`), `updateWindowCollapsed`,
`scheduleClosedLife` (`:945`), `wakeFromClosed`, `wireInput`, `onCursor` (`:1129`),
`frame` (`:1252`), `drawBot` (`:1361`), `updateCountdown` (`:1454`), `syncDom` (`:1498`),
`alert()` + `holdOpen` (`:542`).

Centre-only assumptions (to change for left/right placement): Rust `x` (`island.rs:439`);
CSS `left:50%; translateX(-50%)` on `#island`, `#wake-strip`, `#countdown`;
`(viewportW - w)/2` in `applyGeometry`, `islandRect` and the rect sent to Rust;
`greetingCanvas`/`uploadCanvas` left offsets.

### Rust ↔ TS contract (core only)
Commands: `boot() → {settings, screen, version, cursor_poll}`, `save_settings`,
`set_collapsed({collapsed,width?,height?})`, `set_island_rect({x,y,width,height})`,
`focus_window({focused})`, `reposition()`, `fit_zoom({dpr})`, `list_monitors()`.
Events → page: `cursor {x,y}`, `closed-hover`, `screen-changed`, `settings-changed`, `tray`.
Setup (`lib.rs:1097-1118`): `make_non_activating` → `apply_geometry` → `show` →
`gate.set_active(true)` → `spawn_cursor_poll`.

---

## 4. The character (Mochi) — `windows/src/mochi/engine.ts`

Self-contained Canvas 2D engine. Depends only on `core/anim.ts` (easings/springs),
`core/sound.ts` (`Sound.play`), two type unions from `core/layout.ts`, and outfits
(`outfits.ts`/`wardrobe.ts`, droppable). A host loop must: size canvas for DPR
(`min(2, dpr)`), set `lookX/lookY`, call `update(dt)` then `draw(ctx, W, H)`.
Canvas = `(Ø + 48) × (Ø + 40)` CSS px (`BOT_SIDE 24`, `BOT_OVERHANG 40` for particles).

### 4.1 Geometry & drawing
- `R = W·0.3`, `rx = 1.14R`, `ry = 0.88R`; body = 72-segment **superellipse**, exponent `2/2.7`.
- Fill: linear gradient `#EDEDEF → #C4C5CA` from `(0.7rx,-0.85ry)` to `(-0.8rx,0.9ry)`;
  state tint gradient bottom→top `rgba(col, 0.72·tint)`; edge shading radial (0→`rgba(0,0,0,.2)`);
  highlight radial at `(0.34rx,-0.46ry)`, r `0.42R`, `rgba(255,255,255,.55)`.
- Blush: two ellipses `0.17R×0.1R` at `±0.55rx`, `rgba(255,120,150,0.5v)`.
- Eyes (`drawEyes` L940): `EYE_W .25, EYE_H .27`, spaced ±0.37 rad, pitch −0.12 rad, projected
  on a sphere (`ex = sin(yaw)·cos(pitch)·rx`, `ey = −sin(pitch)·ry`, foreshortened) → eyes
  roll around the body when he spins. Ink `rgb(26,20,18)`.
- Eye shapes: `pill wide dot line flat happy closed spiral heart star tired wink cup`
  (exact params in `drawEyeShape` L982).
- Hands (`drawHandsBehind` L1131): small ellipses behind the body, used for waving.
- Badges (L1200) top-left of body: `dots` (animated typing pill), `bang` `!`, `question` `?`,
  `dot`, `arrow`.
- Glow: DOM div, 2.2×Ø radial gradient; colour/opacity by state (`layout.ts botGlowColor/Opacity`).
- Particles: heart `#FF4D6D`, star `#F7B32B`, spark (white), sweat `#7CC7FF`, `z`.

### 4.2 Animation
- Tweens: per-property keyframes `[target, ms, ease]` on
  `yaw pitch roll tilt open sx sy oy ox tint morph hands blush es badgeS`; new tween replaces old.
- Easings (`anim.ts`): `out = 1-(1-t)^3`, `inOut` cubic, `back` (c1 1.7, c3 2.7), `lin`, `easeIn t³`.
- Smoothing per frame: `k = 1 - 0.0008^dt` (general), `1 - 0.0025^dt` (look), `1 - 0.002^dt` (colour).
- **Cursor following**: `lookX = tanh((mouseX − botX)/260)`, `lookY = −tanh((mouseY − botY)/200)`;
  `yaw = lookX·0.62`, `pitch = lookY·0.5`.
- **Blink**: `open → 0.06 (70 ms) → 1 (130 ms)`, every `2.2 + rand·3.2` s, 22% double blink.
- State motion: approval bounce `oy = −|sin 5.2t|·0.07`; sleeping breathe `sy = 1 + sin(1.8t)·0.035`;
  searching scan `yaw = sin(2.6t)·0.6`; dizzy wobble.
- Closed island "life" (`scheduleClosedLife`): every 2.5–6 s, 55% blink else glance `(±0.8, ±0.3)`, ~700 ms awake.

### 4.3 States (`BOT_STATES` L94-106)
| state | colour | tint | eyes | badge | extra |
|---|---|---|---|---|---|
| idle | `#E6E9EE` | 0 | pill | – | |
| working | `#3B9EFF` | .72 | pill | dots | |
| thinking | `#8B5CF6` | .72 | pill | dots | looks up-right |
| searching | `#6366F1` | .72 | pill | dots | scans |
| approval | `#F5A524` | .78 | wide | `!` | bounces, hop on enter |
| question | `#22D3EE` | .75 | pill | `?` | head tilt .17 |
| error | `#F4505E` | .78 | flat | dot | side shake |
| finished | `#34D399` | .35 | happy | dot | roll + sparks |
| ratelimit | `#FB923C` | .72 | tired | dot | sweat |
| sleeping | `#94A3B8` | .32 | closed | – | breathes, z's |
| dizzy | `#F472B6` | .7 | spiral | – | double roll |

Emotes (`triggerEmote(name, 1.8s)`): love (heart eyes, blush, 4 hearts, hop), surprised
(dot eyes, jump, eyes grow), proud (star eyes, 5 stars, tilt), wink, yawn (stretch then
closed eyes + z's), happy, annoyed (line eyes).

### 4.4 Interactions (`island.ts:1164-1240`)
- Hover Mochi (expanded): blink, eyes grow to 1.08, `hover` sound; rest 1.9 s → **love** (6 s cooldown).
- Click → `slap()`: squash, `slap` + `annoyed` sound, line eyes 0.8 s. **3 clicks in 1.7 s → dizzy**
  for 3.3 s, then happy.
- `greet()` peek-wave: happy eyes, hand waves ~1.1 s, `greet` sound.
- Launch greeting (`greeting.ts`, separate renderer, 640×150 canvas): drops from the notch,
  bounces, waves, tucks hands, turns blue, collapses at ~4.9 s. Timeline in `T` (L14-27).
- Sleep: desktop pet sleeps after 120 s idle; SPEC says 10 min for the island.

### 4.5 Public API
`setState(s)`, `triggerEmote(e, dur)`, `blink()`, `squash()`, `slap()`, `greet()`,
`interruptGreet()`, `doRoll(ms, turns)`, `emit(type, n)`, `setBadge(b)`, `gulp()`,
`setOutfit()`, `setDancing()`; per-frame fields `lookX, lookY, tgEs, particleOverhang`;
`busy` getter; `update(dt)`; `draw(ctx, W, H)`; `onDizzy` callback.

---

## 5. Chat view (`windows/src/views/chat.ts`, `style.css:1027-1465`)

- `.view > .card.wash.chat-card > .chat-body` (padding `12px 16px 14px 84px`, room for Mochi left).
- `.chat-log` scrolls. User `.bubble`: `rgba(255,255,255,.13)`, radius 12, 12.5 px, right-aligned.
  Assistant `.reply`: no bubble, `#b0b5be`, rendered by `views/markdown.ts` (textContent only, safe).
- `.typing`: three 5 px dots pulsing .6→1.2 over .9 s, staggered .14 s.
- `.chat-bar`: `rgba(255,255,255,.07)`, radius 12; `.chat-input` 13 px; `.send-btn` 28 px white circle.
- Enter = send; Esc inside input is stopped (doesn't close island).
- Send: `send` sound → `stateOverride = "thinking"` → stream → `finish` / `error` sound → clear override.
- Island height grows with message count (`chatPromptHeight`).

## 6. Local LLM (`windows/src-tauri/src/local_chat.rs`)

- Providers: Ollama, **LM Studio (`http://127.0.0.1:1234`)**, custom; URL in settings `lmstudioUrl`.
- Models: `GET {base}/v1/models` (5 s timeout), filters out embedding models.
- Chat: `POST {base}/v1/chat/completions`, `{model, messages, stream:true, max_tokens:4096}`, 300 s timeout.
- SSE parser: line-buffered, `data:` lines, `choices[0].delta.content`, ~15 UI updates/s,
  hides `<think>…</think>`, caps 1 MB/line, 4 MB/answer. 404 → "model isn't installed".
- **No tool/function calling, no structured output** — we add that ourselves.
- LM Studio itself supports `response_format: {type:"json_schema", json_schema:{name, strict, schema}}`
  (grammar-constrained for GGUF); docs warn small models (<7B) may follow it less reliably.

## 7. Sounds (`windows/src/core/sound.ts`, `NotchBuddy/Resources/sounds/`)

29 WAVs: `peek open close hover blip slap annoyed dizzy greet greeting work finish error approval
question approve gulp tick send love pop proud wink yawn attach think search rate sleep`.
Vite copies them to `dist/sounds` (`windows/vite.config.ts:9-34`). WebAudio, master gain 0.12
(max 0.2), context suspended 1.5 s after silence. **Short UI sounds — nothing loops; too quiet for
an alarm.** Licence-free alternative: the synthesized oscillator sounds in
`design/prototype/notch-buddy.html:480-500` (`Snd.lib`) show how to make our own.

## 8. Settings, tray, shortcuts

- `%APPDATA%\Coucou\settings.json`, camelCase, defaults on missing fields, atomic write
  (`settings.rs:206-450`). Saving emits `settings-changed` to all windows.
- Relevant keys: `autoCloseInterval` (15), `openOnHover` (false), `closedIsland` ("mochi"),
  `screen`, `soundEnabled`, `soundVolume` (0.12), `autostart`, `lmstudioUrl`.
- Settings window = separate `settings.html` window.
- Tray (`tray.rs`): Open / Settings / Pause / Quit via `TrayIconBuilder`.
- Global shortcut `Ctrl+Alt+Space` opens chat (`shortcuts.rs`, `tauri-plugin-global-shortcut`).
- No scheduler / reminder / notification code exists anywhere in the repo.

## 9. What to lift vs drop

Lift (adapt): `core/anim.ts` (as is), `island/fsm.ts` (as is + idle re-arm), `core/layout.ts`
(geometry subset), `core/closed.ts` (subset), the island core of `island/island.ts`,
`mochi/engine.ts` (+ stubs, personal use only), `views/dom.ts`, `views/chat.ts` +
`views/markdown.ts` (stripped), island/card/chat CSS from `style.css`; Rust `island.rs`
(minus monitor picker), `platform/windows.rs` (cursor + window-style fns only),
`local_chat.rs` SSE parser, `settings.rs` pattern, `tray.rs` (trimmed).

Drop: hooks, agents, mail, WhatsApp, Spotify, phone link, desktop pet, flow/voice/notes,
recap, update/what's-new, wardrobe/outfits, upload/drop, pills, i18n, the `hook/` crate.
