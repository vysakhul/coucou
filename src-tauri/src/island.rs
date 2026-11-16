// Island window: placement on the main display (left, centre or right), the
// two window sizes (open panel / folded notch), click-through and the cursor
// poll. Ported from Coucou's island.rs (MIT), without the display picker and
// the file-drop handling.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::geometry::{self, Rect, PANEL_H, PANEL_W};
use crate::platform;
use crate::settings::Settings;

pub const WINDOW_LABEL: &str = "island";

/// The poll's period while the cursor is near / far from the island, in ms.
const NEAR_PERIOD_MS: u64 = 16;
const FAR_PERIOD_MS: u64 = 50;

#[derive(Serialize, Clone)]
struct CursorPayload {
    x: f64,
    y: f64,
}

/// Wakes / parks the cursor poll thread so a folded island costs nothing.
pub struct PollGate {
    active: Mutex<bool>,
    cv: Condvar,
    pub collapsed: AtomicBool,
    /// The window's logical size while folded: the notch the page draws.
    pub collapsed_size: Mutex<(f64, f64)>,
    pub rect: Mutex<Rect>,
    /// Mirrors the window flag so the OS is only called when it changes.
    ignoring: AtomicBool,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(false),
            cv: Condvar::new(),
            collapsed: AtomicBool::new(false),
            collapsed_size: Mutex::new((120.0, 24.0)),
            rect: Mutex::new(Rect::default()),
            ignoring: AtomicBool::new(false),
        }
    }

    pub fn set_active(&self, on: bool) {
        *self.active.lock().unwrap() = on;
        self.cv.notify_all();
    }

    fn wait_active_for(&self, timeout: Duration) -> bool {
        let guard = self.active.lock().unwrap();
        if *guard {
            return true;
        }
        let (guard, _) = self.cv.wait_timeout(guard, timeout).unwrap();
        *guard
    }

    fn is_active(&self) -> bool {
        *self.active.lock().unwrap()
    }

    /// Forces the next poll tick to re-apply the flag (after a resize).
    pub fn forget_ignore_state(&self) {
        self.ignoring.store(false, Ordering::Relaxed);
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

/// AISA lives on the main display.
fn target_monitor(app: &AppHandle) -> Option<Monitor> {
    if let Ok(Some(m)) = app.primary_monitor() {
        return Some(m);
    }
    app.available_monitors().ok()?.into_iter().next()
}

/// How far a taskbar docked at the top pushes the island down.
fn top_inset(m: &Monitor) -> i32 {
    geometry::top_inset_from(m.position().y, m.work_area().position.y)
}

/// Places and sizes the window: the full panel, or `collapsed` to the notch.
pub fn apply_geometry(app: &AppHandle, settings: &Settings, collapsed: Option<(f64, f64)>) {
    let Some(win) = window(app) else { return };
    let Some(m) = target_monitor(app) else { return };

    let scale = m.scale_factor();
    let mp = *m.position();
    let ms = *m.size();

    let (lw, lh) = collapsed.map(geometry::clamp_collapsed).unwrap_or((PANEL_W, PANEL_H));
    let pw = (lw * scale).round().max(1.0) as u32;
    let ph = (lh * scale).round().max(1.0) as u32;
    let margin = (settings.edge_margin * scale).round() as i32;
    let x = geometry::window_x(settings.placement.anchor(), mp.x, ms.width, pw, margin);
    let y = mp.y + top_inset(&m);

    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    // Moving across displays can rescale the window: re-assert the physical size.
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_always_on_top(true);
}

/// Position, size and scale of the display: any change means placing again.
fn current_screen_key(app: &AppHandle) -> Option<(i32, i32, u32, u32, u64)> {
    let m = target_monitor(app)?;
    let p = m.position();
    let s = m.size();
    Some((p.x, p.y + top_inset(&m), s.width, s.height, m.scale_factor().to_bits()))
}

/// Emits `cursor` (window-logical coordinates) at ~60 Hz while the island is
/// open, and flips click-through so only the island shape takes the mouse.
/// Parked while folded, glancing at the cursor four times a second.
pub fn spawn_cursor_poll(app: AppHandle, gate: Arc<PollGate>) {
    std::thread::spawn(move || {
        let mut last_screen = None;
        loop {
            loop {
                if gate.wait_active_for(Duration::from_millis(250)) {
                    break;
                }
                if gate.collapsed.load(Ordering::Relaxed) {
                    wake_if_hovered(&app, &gate);
                }
            }
            let mut last = (f64::MIN, f64::MIN);
            let mut ticks: u32 = 0;
            let mut far = false;
            while gate.is_active() {
                std::thread::sleep(Duration::from_millis(if far { FAR_PERIOD_MS } else { NEAR_PERIOD_MS }));
                if !gate.is_active() {
                    break;
                }

                ticks = ticks.wrapping_add(1);
                if ticks % 30 == 0 {
                    let now = current_screen_key(&app);
                    if now.is_some() && now != last_screen {
                        let first = last_screen.is_none();
                        last_screen = now;
                        if !first {
                            let _ = app.emit_to(WINDOW_LABEL, "screen-changed", ());
                        }
                    }
                }

                let Some(win) = window(&app) else { continue };
                let Ok(origin) = win.outer_position() else { continue };
                let scale = win.scale_factor().unwrap_or(1.0);
                let Some((cx, cy)) = platform::cursor_physical() else { continue };
                let x = (cx - origin.x as f64) / scale;
                let y = (cy - origin.y as f64) / scale;
                let size = match win.inner_size() {
                    Ok(s) => (s.width as f64 / scale, s.height as f64 / scale),
                    Err(_) => (PANEL_W, PANEL_H),
                };
                if (x - last.0).abs() < 1.0 && (y - last.1).abs() < 1.0 {
                    continue;
                }
                last = (x, y);

                let accept = geometry::on_island(*gate.rect.lock().unwrap(), x, y);
                if gate.ignoring.load(Ordering::Relaxed) == accept {
                    // Under the gate's lock and only while it is open: a tick still
                    // running as the island folds must not make the notch
                    // click-through, or nothing could ever wake it again.
                    let active = gate.active.lock().unwrap();
                    if !*active {
                        break;
                    }
                    gate.ignoring.store(!accept, Ordering::Relaxed);
                    platform::set_click_through(&win, !accept);
                }

                // Far from the island: the page hears it once, then nothing.
                let near = geometry::is_near(x, y, size);
                if !near && far {
                    continue;
                }
                far = !near;
                let _ = win.emit("cursor", CursorPayload { x, y });
            }
        }
    });
}

/// The cursor is on the folded notch: it takes the mouse and the page hears
/// `closed-hover` (the face peeks out).
fn wake_if_hovered(app: &AppHandle, gate: &PollGate) {
    let Some(win) = window(app) else { return };
    let (Ok(origin), Ok(size), Some((cx, cy))) = (win.outer_position(), win.inner_size(), platform::cursor_physical()) else {
        return;
    };
    let x = cx - origin.x as f64;
    let y = cy - origin.y as f64;
    if x >= 0.0 && y >= 0.0 && x <= size.width as f64 && y <= size.height as f64 + 2.0 {
        gate.ignoring.store(false, Ordering::Relaxed);
        platform::set_click_through(&win, false);
        let _ = win.emit("closed-hover", ());
    }
}

/// After a resize the window takes the mouse again and the next tick decides.
pub fn refresh_click_through(app: &AppHandle, gate: &PollGate) {
    if let Some(win) = window(app) {
        platform::set_click_through(&win, false);
    }
    gate.forget_ignore_state();
}
