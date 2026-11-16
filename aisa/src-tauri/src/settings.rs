// Preferences in %APPDATA%\app.notchy.assistant\settings.json: camelCase JSON,
// missing or invalid fields fall back to defaults, atomic writes, a corrupt
// file is set aside rather than lost (same rules as Coucou's settings.rs).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::geometry::Anchor;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Placement {
    Left,
    #[default]
    Center,
    Right,
}

impl Placement {
    pub fn anchor(self) -> Anchor {
        match self {
            Placement::Left => Anchor::Left,
            Placement::Center => Anchor::Center,
            Placement::Right => Anchor::Right,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub placement: Placement,
    /// Gap between the notch and the screen corner for left / right, logical px.
    pub edge_margin: f64,
    /// Open island → compact after this many idle seconds.
    pub auto_close_interval: f64,
    /// Compact → folded notch after this many idle seconds.
    pub hide_delay: f64,
    pub face_hover_open: bool,
    pub sound_enabled: bool,
    pub sound_volume: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            placement: Placement::Center,
            edge_margin: 12.0,
            auto_close_interval: 15.0,
            hide_delay: 10.0,
            face_hover_open: true,
            sound_enabled: true,
            sound_volume: 0.12,
        }
    }
}

impl Settings {
    /// Keeps every number in its range; NaN takes the default.
    pub fn sanitized(mut self) -> Self {
        let d = Settings::default();
        let fix = |v: f64, lo: f64, hi: f64, def: f64| if v.is_finite() { v.clamp(lo, hi) } else { def };
        self.edge_margin = fix(self.edge_margin, 0.0, 200.0, d.edge_margin);
        self.auto_close_interval = fix(self.auto_close_interval, 5.0, 120.0, d.auto_close_interval);
        self.hide_delay = fix(self.hide_delay, 2.0, 600.0, d.hide_delay);
        self.sound_volume = fix(self.sound_volume, 0.0, 0.2, d.sound_volume);
        self
    }

    /// Reads settings; anything unreadable gives the defaults.
    pub fn parse(text: &str) -> Option<Self> {
        serde_json::from_str::<Settings>(text).ok().map(Settings::sanitized)
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    let Some(file) = path(app) else { return Settings::default() };
    let Ok(text) = fs::read_to_string(&file) else { return Settings::default() };
    match Settings::parse(&text) {
        Some(s) => s,
        None => {
            // Kept for the user to look at, never silently overwritten.
            let _ = fs::rename(&file, file.with_extension("json.bad"));
            Settings::default()
        }
    }
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let file = path(app).ok_or("no config folder")?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_take_defaults() {
        let s = Settings::parse(r#"{"placement":"right"}"#).unwrap();
        assert_eq!(s.placement, Placement::Right);
        assert_eq!(s.auto_close_interval, 15.0);
        assert!(s.face_hover_open);
    }

    #[test]
    fn out_of_range_values_are_clamped() {
        let s = Settings::parse(r#"{"autoCloseInterval":1,"soundVolume":5,"hideDelay":99999}"#).unwrap();
        assert_eq!(s.auto_close_interval, 5.0);
        assert_eq!(s.sound_volume, 0.2);
        assert_eq!(s.hide_delay, 600.0);
    }

    #[test]
    fn garbage_is_rejected() {
        assert!(Settings::parse("not json").is_none());
        assert!(Settings::parse(r#"{"placement":"diagonal"}"#).is_none());
    }

    #[test]
    fn round_trips_in_camel_case() {
        let text = serde_json::to_string(&Settings::default()).unwrap();
        assert!(text.contains("\"edgeMargin\":12"));
        assert!(text.contains("\"placement\":\"center\""));
        assert_eq!(Settings::parse(&text), Some(Settings::default()));
    }
}
