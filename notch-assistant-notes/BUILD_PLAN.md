# Notch Assistant — build plan

A Windows-only desktop assistant that lives as a notch at the top of the screen,
looks and moves exactly like Coucou's island + Mochi, and handles alarms and
reminders from a small chat. Reference for every visual/behaviour constant:
`ORIGINAL_REPO_REFERENCE.md` (same folder). Working name below: **Notchy**
(placeholder — pick the real name before release).

---

## 1. Requirements → design decisions

| Requirement | Decision |
|---|---|
| Windows only | Tauri 2 + Rust + vanilla TS/Vite, same stack as Coucou's `windows/` build, so the island code ports almost line for line. Linux code paths dropped. Installer: NSIS per-user (no admin). |
| Notch at top-left / top-middle / top-right, user-selectable | New `placement: "left" \| "center" \| "right"` setting (+ `edgeMargin`, default 12 px). Rust computes window `x` per placement; CSS anchors the island inside the window to the same side. See §4.2. |
| Hover the notch → cute face appears | Closed state = small empty black notch (Coucou's `empty` closed style, 120×24). Pointer enters → **compact** (288×32) with Mochi peeking at (40,16), same spring morph. |
| Hover the face → chat options | New rule on top of Coucou's FSM: pointer rests on the face for 0.5 s in compact → **expanded** chat view with quick-action chips. (Coucou only has a whole-island "open on hover"; we restrict it to the face.) Click on the notch still opens too. |
| Hide back into the notch after inactivity | Expanded → compact after `idleCloseSeconds` (default 15, Coucou's value) with **no mouse or keyboard activity** inside the island; compact → closed after `idleHideSeconds` (default 10; Coucou uses 60). Typing / a non-empty input re-arms the timer. Countdown bar identical to Coucou. |
| Set alarms and reminders by chat | Chat → intent parser → confirmation card → stored in Rust scheduler. |
| At trigger time the assistant comes out and reminds / rings | Rust scheduler emits `reminder-due` → island forced to expanded + pinned, Mochi in alert state, sound (looping for alarms) until **Dismiss** or **Snooze**. |
| AI only if needed, smallest local model via LM Studio | Deterministic parser first (handles the vast majority of phrasing); LM Studio is an **optional fallback** for odd phrasing, using JSON-schema structured output. App works fully without LM Studio running. |

---

## 2. Architecture

```
┌──────────────────────── island window (WebView2, transparent, top-most) ───────────────────────┐
│ TS                                                                                              │
│  island/fsm.ts      ← Coucou FSM + face-hover rule + activity re-arm                            │
│  island/island.ts   ← geometry springs, placement, cursor → hover/eyes, views, countdown        │
│  character/         ← Character interface; mochi/engine.ts implementation (swappable)           │
│  views/chat.ts      ← chat + quick chips + confirmation card                                    │
│  views/list.ts      ← upcoming alarms/reminders, delete                                         │
│  views/alert.ts     ← ringing alarm / reminder card (Dismiss, Snooze 5/10)                      │
│  nlu/parse.ts       ← deterministic intent + chrono-node date parsing                           │
│  nlu/llm.ts         ← LM Studio fallback (via Rust command)                                     │
│  core/sound.ts      ← WebAudio; separate alarm channel with loop + its own volume              │
└──────────── invoke / events ───────────────────────────────────────────────────────────────────┘
┌ Rust (src-tauri) ───────────────────────────────────────────────────────────────────────────────┐
│ island.rs + platform/windows.rs  ← ported: placement, cursor poll, click-through, focus         │
│ scheduler.rs  ← reminders.json store, timer thread, sleep/resume + missed-at-startup handling   │
│ llm.rs        ← POST LM Studio /v1/chat/completions with response_format json_schema            │
│ settings.rs   ← %APPDATA%\Notchy\settings.json (atomic write, defaults)                         │
│ tray.rs       ← Open, Upcoming, Settings, Pause, Quit                                           │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Why the scheduler is in Rust: it must fire while the island is folded and the
page's render loop is asleep, survive sleep/resume, and catch reminders missed
while the app was closed. A single thread sleeps until `min(next_due, 30 s)`
and compares against the wall clock each wake-up, so a laptop waking from sleep
fires anything overdue within 30 s.

---

## 3. Data model

```ts
type Kind = "alarm" | "reminder";
interface Item {
  id: string;            // uuid
  kind: Kind;
  label: string;         // "Call mum", "Wake up"
  dueAt: string;         // ISO 8601 with local offset
  repeat: "none" | "daily" | "weekdays";   // v1 ships "none"; field reserved
  snoozedUntil?: string;
  createdAt: string;
  state: "scheduled" | "ringing" | "done" | "missed";
}
```
Stored in `%APPDATA%\Notchy\reminders.json`, atomic write (temp file + rename), as in
Coucou's `settings.rs`.

Behaviour at trigger:
- **Alarm**: island → expanded, pinned; Mochi `approval` state (amber, `!`, bounce);
  alarm sound loops until Dismiss / Snooze; auto-snooze after 5 min unanswered.
- **Reminder**: island → expanded, pinned; Mochi `question` state + `surprised` emote;
  chime plays once (repeats once after 1 min). Unanswered after 5 min → folds to compact
  but stays pinned with a badge until acknowledged.
- Overdue at startup or after resume → shown as "missed" with the original time.
- Confirmation after setting: Mochi `finished` (happy eyes, roll, sparks) + `proud` emote.

---

## 4. Island & character port

### 4.1 Port as-is (MIT code)
`core/anim.ts`, `island/fsm.ts`, geometry subset of `core/layout.ts` + `core/closed.ts`,
the island core of `island/island.ts` (functions listed in reference §3), `views/dom.ts`,
`views/markdown.ts`, island/card/chat/countdown CSS; Rust `island.rs` (primary monitor only)
and the cursor/window-style functions of `platform/windows.rs`, `tauri.conf.json` window block.

### 4.2 Placement (new)
- Rust `apply_geometry`: `x = left ? m.x + margin : right ? m.x + m.w − pw − margin : m.x + (m.w − pw)/2`
  (physical px, margin × scale). Re-run on `settings-changed`.
- TS: one `islandX(w, viewportW)` returning `0`, `(viewportW − w)/2` or `viewportW − w`, used by
  `applyGeometry`, `islandRect` and the rect sent to Rust. CSS: `html[data-placement]` switches
  `#island`, `#countdown`, `#wake-strip` between `left:0`, centred, `right:0`.
- The island grows from its anchor edge (left-anchored grows rightwards, etc.), so the
  spring morph looks the same but expands away from the screen corner.
- Corner: keep the original `border-radius: 0 0 r r`; the default 12 px margin keeps it from
  looking clipped at the screen corner.

### 4.3 Character
- Define `interface Character { setState; triggerEmote; blink; slap; greet; update(dt); draw(ctx,W,H); lookX; lookY; busy }`.
- Implementation 1 (personal build): lift `mochi/engine.ts`, stub outfits and `Sound`.
- Keep every interaction: eye-follow, blinks, closed-notch glances, hover → love after 1.9 s,
  click → annoyed, 3 clicks → dizzy, launch greeting (`greeting.ts`).
- **Licence gate**: Mochi's design and the WAV sounds are reserved by their author
  (`LICENSE-ASSETS.md`). Fine for running yourself; before sharing/distributing, either get
  written permission or swap in our own character (same `Character` interface, so nothing else
  changes) and our own sounds (synthesized WebAudio, like the prototype's `Snd.lib`).

### 4.4 FSM changes (small, on top of the port)
1. `faceHoverOpen`: in `petit`, pointer inside the face hit-circle for 0.5 s → `home` (chat view).
2. `activity()`: called on mousemove/keydown/input inside the island → re-arms `homeCollapse`;
   with text in the input, collapse is deferred.
3. `petitToHiddenDelay` from settings (default 10 s).
4. `alert(item)`: `forceHome()` + `pinned = true`; Dismiss/Snooze → `pinned = false`, `forcePetit()`.

---

## 5. Understanding instructions

### 5.1 Deterministic first (no AI)
`nlu/parse.ts`:
1. Intent by keywords: `alarm|wake me|ring` → alarm; `remind|reminder|don't let me forget` → reminder;
   `list|what's|upcoming|show` → list; `cancel|delete|remove` → cancel.
2. Date/time with **chrono-node** (handles "in 20 minutes", "tomorrow 7am", "next Friday at 3pm",
   "on 24 Dec at 9", relative to now, `forwardDate: true` so "7am" means the next 7 am).
3. Label = text left after removing the intent words and the date phrase ("remind me to **call mum**
   at 6").
4. Missing time → Mochi asks one follow-up ("When should I remind you?").
5. Always show a confirmation card: "⏰ Alarm · Tue 17 Nov, 07:00 — Wake up  [Set] [Edit]".

### 5.2 LM Studio fallback (only when 5.1 fails)
- Settings: `llmEnabled` (default off until a model is detected), `lmstudioUrl`
  (`http://127.0.0.1:1234`), `llmModel` (picked from `GET /v1/models`).
- Request (Rust, 15 s timeout, non-streaming, `temperature 0`):
  `response_format: {type: "json_schema", json_schema: {name: "intent", strict: true, schema}}`,
  schema `{intent: alarm|reminder|list|cancel|chat, label: string, when: string}`.
- **The model never computes dates.** It only rewrites `when` into a plain phrase
  ("tomorrow at 7:00"), which chrono-node then resolves. Small models are bad at date arithmetic;
  this keeps them out of it. System prompt includes today's date/weekday for phrases like "this weekend".
- Output is validated; on invalid JSON or timeout → "Sorry, I didn't get that — try 'remind me to X at 5pm'".
- Model choice, smallest first: **Qwen2.5-0.5B-Instruct (Q4_K_M, ~0.4 GB)**; if it misreads too often,
  Qwen2.5-1.5B-Instruct or Llama-3.2-1B-Instruct (~1 GB). LM Studio warns structured output is less
  reliable below 7B, which is why the deterministic parser stays primary and the LLM output is validated.
- Mochi shows `thinking` while waiting; `error` on failure.

---

## 6. Settings (separate small window, Coucou settings style)

Placement (left / middle / right) · edge margin · auto-close delay (5–120 s, default 15) ·
hide-to-notch delay (default 10 s) · open on face hover (on) · alarm sound + volume ·
UI sounds on/off + volume · snooze minutes (5) · start with Windows · LM Studio URL / model /
enabled + "Test connection".

---

## 7. Milestones

| # | Deliverable | Done when |
|---|---|---|
| M0 | Tauri 2 scaffold (Windows), single instance, tray, settings store | App starts, tray works, settings persist |
| M1 | Island shell port: window, cursor poll, click-through, focus, FSM, spring morph, countdown | Closed → compact → expanded → back looks and times exactly like Coucou side by side |
| M2 | Placement left/middle/right | Switching in Settings moves the notch live, hover/click hit areas correct on all three, 100–200% DPI |
| M3 | Character port + interactions + launch greeting | Eye-follow, blink, hover-love, slap, dizzy, greeting match Coucou |
| M4 | Face-hover → chat, inactivity hide, chat view + chips, list view | Requirement flow works without clicking |
| M5 | Scheduler (Rust) + alert view + sounds + snooze | Items fire to the second while folded, after sleep/resume, missed-at-startup shown |
| M6 | Deterministic parser + confirmation | Unit tests pass on ~60 phrasings |
| M7 | LM Studio fallback | Unparseable phrasings resolved with Qwen2.5-0.5B; app unaffected when LM Studio is off |
| M8 | Packaging (NSIS per-user), autostart, icon | Installs and runs on a clean Windows 11 |

Tests: `vitest` for the parser and FSM timers (fake timers), `cargo test` for scheduler
ordering, persistence and missed/overdue logic; manual checklist for the island on each
placement and DPI.

---

## 8. Open choices (defaults chosen, easy to change)

- **Name + character for distribution** — default: personal build uses Mochi; a custom
  character is a drop-in later via the `Character` interface.
- **Recurring alarms** (daily / weekdays) — field is in the data model; UI deferred to v1.1.
- **Windows toast fallback** when a fullscreen app/game covers the notch — optional
  (`tauri-plugin-notification`), off by default.
- **Hide-to-notch delay** — 10 s default instead of Coucou's 60 s, to match "hide back into the notch".
