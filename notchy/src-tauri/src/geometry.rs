// Pure geometry, no Tauri: where the window goes for each placement, and the
// small numeric rules ported from Coucou's island.rs (MIT). Kept free of
// dependencies so it can be tested on its own (`rustc --test src/geometry.rs`).

/// Logical size of the open window: the largest island view.
pub const PANEL_W: f64 = 720.0;
pub const PANEL_H: f64 = 320.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Anchor {
    Left,
    Center,
    Right,
}

/// The window's physical x on its monitor. Left and right keep `margin_px`
/// from the screen edge; the centre ignores it.
pub fn window_x(anchor: Anchor, monitor_x: i32, monitor_w: u32, window_w: u32, margin_px: i32) -> i32 {
    let free = monitor_w as i32 - window_w as i32;
    match anchor {
        Anchor::Left => monitor_x + margin_px.clamp(0, free.max(0)),
        Anchor::Center => monitor_x + free / 2,
        Anchor::Right => monitor_x + free - margin_px.clamp(0, free.max(0)),
    }
}

/// How far a taskbar docked at the top pushes the island down. Nonsense from
/// the system never pushes it off the display.
pub fn top_inset_from(monitor_y: i32, work_y: i32) -> i32 {
    let inset = work_y - monitor_y;
    if (0..200).contains(&inset) {
        inset
    } else {
        0
    }
}

/// A folded island never grows past the panel, and never below one pixel.
pub fn clamp_collapsed((w, h): (f64, f64)) -> (f64, f64) {
    let ok = |v: f64, max: f64| if v.is_finite() { v.clamp(1.0, max) } else { max };
    (ok(w, PANEL_W), ok(h, PANEL_H))
}

/// WebView2 zoom so one CSS px is one logical px again when its
/// devicePixelRatio disagrees with the window's scale (text scaling, mixed DPI).
pub fn zoom_correction(current_zoom: f64, scale: f64, dpr: f64) -> Option<f64> {
    if dpr <= 0.0 || !dpr.is_finite() || scale <= 0.0 || !scale.is_finite() {
        return None;
    }
    if (dpr - scale).abs() / scale < 0.02 {
        return None;
    }
    Some((current_zoom * (scale / dpr)).clamp(0.25, 4.0))
}

/// Around the window, how far the cursor is still worth telling the page about.
pub const NEAR_ZONE: f64 = 420.0;

pub fn is_near(x: f64, y: f64, size: (f64, f64)) -> bool {
    x >= -NEAR_ZONE && x <= size.0 + NEAR_ZONE && y >= -NEAR_ZONE && y <= size.1 + NEAR_ZONE
}

/// Margin around the island that still counts as on it, logical px.
pub const HIT_MARGIN: f64 = 14.0;

#[derive(Clone, Copy, Default, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn on_island(r: Rect, x: f64, y: f64) -> bool {
    r.w > 0.0
        && x >= r.x - HIT_MARGIN
        && x <= r.x + r.w + HIT_MARGIN
        && y >= r.y - HIT_MARGIN
        && y <= r.y + r.h + HIT_MARGIN
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_anchor_puts_the_window_where_expected() {
        // 1920 px monitor at x = 0, 720 px window, 12 px margin.
        assert_eq!(window_x(Anchor::Left, 0, 1920, 720, 12), 12);
        assert_eq!(window_x(Anchor::Center, 0, 1920, 720, 12), 600);
        assert_eq!(window_x(Anchor::Right, 0, 1920, 720, 12), 1188);
        // A second monitor to the left of the main one.
        assert_eq!(window_x(Anchor::Right, -1920, 1920, 120, 12), -132);
        // A margin bigger than the room left never pushes the window off screen.
        assert_eq!(window_x(Anchor::Left, 0, 800, 720, 500), 80);
        assert_eq!(window_x(Anchor::Right, 0, 800, 720, 500), 0);
    }

    #[test]
    fn a_top_taskbar_moves_the_island_down_and_nothing_else_does() {
        assert_eq!(top_inset_from(0, 0), 0);
        assert_eq!(top_inset_from(-1080, -1032), 48);
        assert_eq!(top_inset_from(0, -20), 0);
        assert_eq!(top_inset_from(0, 900), 0);
    }

    #[test]
    fn a_closed_island_stays_inside_the_panel() {
        assert_eq!(clamp_collapsed((120.0, 24.0)), (120.0, 24.0));
        assert_eq!(clamp_collapsed((5000.0, 900.0)), (PANEL_W, PANEL_H));
        assert_eq!(clamp_collapsed((0.0, -3.0)), (1.0, 1.0));
        assert_eq!(clamp_collapsed((f64::NAN, 24.0)), (PANEL_W, 24.0));
    }

    #[test]
    fn zoom_is_only_corrected_on_a_real_mismatch() {
        assert_eq!(zoom_correction(1.0, 1.25, 1.25), None);
        assert_eq!(zoom_correction(1.0, 1.0, 1.01), None);
        assert_eq!(zoom_correction(1.0, 1.0, 1.25), Some(0.8));
        assert_eq!(zoom_correction(1.0, 1.5, 1.0), Some(1.5));
        assert_eq!(zoom_correction(1.0, f64::NAN, 1.0), None);
    }

    #[test]
    fn hit_test_includes_the_margin() {
        let r = Rect { x: 216.0, y: 0.0, w: 288.0, h: 32.0 };
        assert!(on_island(r, 216.0 - 14.0, 10.0));
        assert!(!on_island(r, 216.0 - 15.0, 10.0));
        assert!(on_island(r, 300.0, 46.0));
        assert!(!on_island(Rect::default(), 0.0, 0.0));
    }

    #[test]
    fn only_a_cursor_near_the_island_is_followed() {
        let size = (PANEL_W, PANEL_H);
        assert!(is_near(360.0, 10.0, size));
        assert!(!is_near(-500.0, 10.0, size));
    }
}
