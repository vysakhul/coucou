mod geometry;
mod island;
mod platform;
mod settings;
mod tray;

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use island::{PollGate, WINDOW_LABEL};
use settings::{Placement, Settings};

pub struct Shared {
    settings: Mutex<Settings>,
    gate: Arc<PollGate>,
}

#[derive(Serialize)]
struct Boot {
    settings: Settings,
}

#[tauri::command]
fn boot(shared: State<Shared>) -> Boot {
    Boot { settings: shared.settings.lock().unwrap().clone() }
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    apply_settings(&app, settings.sanitized())
}

/// Saves, re-places the window and tells the page and the tray.
fn apply_settings(app: &AppHandle, settings: Settings) -> Result<(), String> {
    let shared = app.state::<Shared>();
    *shared.settings.lock().unwrap() = settings.clone();
    let saved = settings::save(app, &settings);
    place(app, &shared);
    if let Some(items) = app.try_state::<tray::PlacementItems>() {
        items.show(settings.placement);
    }
    let _ = app.emit_to(WINDOW_LABEL, "settings-changed", &settings);
    saved
}

pub(crate) fn set_placement(app: &AppHandle, placement: Placement) {
    let current = app.state::<Shared>().settings.lock().unwrap().clone();
    let _ = apply_settings(app, Settings { placement, ..current });
}

fn place(app: &AppHandle, shared: &Shared) {
    let settings = shared.settings.lock().unwrap().clone();
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    let size = *shared.gate.collapsed_size.lock().unwrap();
    island::apply_geometry(app, &settings, collapsed.then_some(size));
    island::refresh_click_through(app, &shared.gate);
}

/// Folded → the window shrinks to the notch and the cursor poll parks;
/// anything else → full panel and 60 Hz polling.
#[tauri::command]
fn set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool, width: Option<f64>, height: Option<f64>) {
    shared.gate.collapsed.store(collapsed, Ordering::Relaxed);
    if let (Some(w), Some(h)) = (width, height) {
        *shared.gate.collapsed_size.lock().unwrap() = geometry::clamp_collapsed((w, h));
    }
    // The poll stops first: a late tick could make the notch click-through again.
    if collapsed {
        shared.gate.set_active(false);
    }
    place(&app, &shared);
    shared.gate.set_active(!collapsed);
}

/// The page pushes the island shape; the poll decides click-through from it.
#[tauri::command]
fn set_island_rect(shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    *shared.gate.rect.lock().unwrap() = geometry::Rect { x, y, w: width, h: height };
}

#[tauri::command]
fn focus_window(app: AppHandle, focused: bool) {
    let Some(win) = island::window(&app) else { return };
    platform::set_activating(&win, focused);
    if focused {
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn reposition(app: AppHandle, shared: State<Shared>) {
    place(&app, &shared);
}

/// One CSS px must be one logical px: correct WebView2's zoom when its pixel
/// ratio disagrees with the window's scale.
#[tauri::command]
fn fit_zoom(app: AppHandle, dpr: f64) -> bool {
    let Some(win) = island::window(&app) else { return false };
    let scale = win.scale_factor().unwrap_or(1.0);
    static ZOOM: Mutex<f64> = Mutex::new(1.0);
    let mut zoom = ZOOM.lock().unwrap();
    match geometry::zoom_correction(*zoom, scale, dpr) {
        Some(next) => {
            *zoom = next;
            let _ = win.set_zoom(next);
            true
        }
        None => false,
    }
}

pub fn run() {
    let gate = Arc::new(PollGate::new());
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Launched again: open the chat of the one already running.
            let _ = app.emit_to(WINDOW_LABEL, "tray", "open");
        }))
        .invoke_handler(tauri::generate_handler![
            boot,
            save_settings,
            set_collapsed,
            set_island_rect,
            focus_window,
            reposition,
            fit_zoom,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let loaded = settings::load(&handle);
            app.manage(Shared { settings: Mutex::new(loaded.clone()), gate: gate.clone() });
            tray::build(&handle, loaded.placement)?;

            if let Some(win) = island::window(&handle) {
                platform::make_non_activating(&win);
                island::apply_geometry(&handle, &loaded, None);
                let _ = win.show();
            }
            gate.set_active(true);
            island::spawn_cursor_poll(handle, gate.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AISA");
}
