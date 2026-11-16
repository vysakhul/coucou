# AISA

A little assistant that lives in a notch at the top of your Windows screen.
Hover the notch and the face peeks out; rest on the face and the chat opens;
leave it alone and it folds back into the notch.

Build plan and the notes on the app it is modelled on: `docs/`.

## Run it (Windows 10/11)

Needs [Node 20+](https://nodejs.org), [Rust](https://rustup.rs) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (WebView2 ships with Windows 11).

```
npm install
npm run tauri dev        # run
npm run tauri build      # installer in src-tauri/target/release/bundle/nsis
```

Without Windows, `npm run dev` shows the island in a browser at
http://127.0.0.1:1420 (`?placement=left|center|right`); the page's own mouse
events stand in for the cursor poll.

Checks: `npm test` (state machine, layout), `npm run typecheck`,
`cargo check` in `src-tauri/`.

## Using it

| You | AISA |
|---|---|
| Point at the notch | The face peeks out |
| Rest on the face ½ s, or click the notch | The chat opens |
| Leave it (default 15 s open, 10 s peeking) | It folds back into the notch |
| ✕ or `Esc` | Back to the peeking face |
| Rest on the face in the chat | Hearts |
| Click the face (3× fast = dizzy) | It gets annoyed |
| Tray → Position | Top left / middle / right |

Settings live in `%APPDATA%\app.aisa.assistant\settings.json`:
`placement`, `edgeMargin`, `autoCloseInterval`, `hideDelay`, `faceHoverOpen`,
`soundEnabled`, `soundVolume`.

## Character, sounds and licence

The island, state machine and Win32 code are adapted from
[Coucou](https://github.com/Louis-CFM/coucou) (MIT, © Louis Raillé; its licence
is in `third-party/coucou-LICENSE-MIT.txt`).
`src/mochi/engine.ts` is Coucou's Mochi character unchanged. **The Mochi design
and Coucou's sounds are not MIT** (Coucou's `LICENSE-ASSETS.md`): fine to build
and use yourself, not to distribute without the author's written permission.
To share AISA, replace `src/mochi/` with a character of your own.

`public/sounds/` ships empty and missing sounds are silent. For a personal
build you can copy Coucou's WAVs there (`peek.wav`, `open.wav`, `close.wav`,
`hover.wav`, `love.wav`, `slap.wav`, `annoyed.wav`, `dizzy.wav`, `greet.wav`,
`send.wav`, `finish.wav`, …), or drop in your own with those names.

The app icon is a placeholder drawn by `scripts/make-icon.mjs`
(`npm run icons` regenerates the set).
