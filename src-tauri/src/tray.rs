// Tray icon: open the chat, move the notch (top-left / middle / right), quit.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::island::WINDOW_LABEL;
use crate::settings::Placement;

/// The three placement items, kept to tick the current one.
pub struct PlacementItems {
    left: CheckMenuItem<Wry>,
    center: CheckMenuItem<Wry>,
    right: CheckMenuItem<Wry>,
}

impl PlacementItems {
    pub fn show(&self, placement: Placement) {
        let _ = self.left.set_checked(placement == Placement::Left);
        let _ = self.center.set_checked(placement == Placement::Center);
        let _ = self.right.set_checked(placement == Placement::Right);
    }
}

pub fn build(app: &AppHandle, placement: Placement) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open chat", true, None::<&str>)?;
    let left = CheckMenuItem::with_id(app, "place-left", "Top left", true, placement == Placement::Left, None::<&str>)?;
    let center = CheckMenuItem::with_id(app, "place-center", "Top middle", true, placement == Placement::Center, None::<&str>)?;
    let right = CheckMenuItem::with_id(app, "place-right", "Top right", true, placement == Placement::Right, None::<&str>)?;
    let position = Submenu::with_items(app, "Position", true, &[&left, &center, &right])?;
    let quit = MenuItem::with_id(app, "quit", "Quit AISA", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &PredefinedMenuItem::separator(app)?, &position, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    app.manage(PlacementItems { left, center, right });

    let mut tray = TrayIconBuilder::with_id("main").tooltip("AISA").menu(&menu);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        "open" => {
            let _ = app.emit_to(WINDOW_LABEL, "tray", "open");
        }
        "place-left" => crate::set_placement(app, Placement::Left),
        "place-center" => crate::set_placement(app, Placement::Center),
        "place-right" => crate::set_placement(app, Placement::Right),
        "quit" => app.exit(0),
        _ => {}
    })
    .build(app)?;
    Ok(())
}
