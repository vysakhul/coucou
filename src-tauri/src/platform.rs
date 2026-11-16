// The Win32 calls the island needs, ported from Coucou's platform/windows.rs
// (MIT). AISA is Windows-only; the stubs below only keep `cargo check`
// working elsewhere.

use tauri::WebviewWindow;

#[cfg(windows)]
mod imp {
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::{HWND, POINT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_APPWINDOW,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    /// Cursor position in physical screen pixels.
    pub fn cursor_physical() -> Option<(f64, f64)> {
        let mut p = POINT::default();
        unsafe { GetCursorPos(&mut p).ok()? };
        Some((p.x as f64, p.y as f64))
    }

    fn hwnd_of(win: &WebviewWindow) -> Option<HWND> {
        let raw = win.hwnd().ok()?.0 as isize;
        if raw == 0 {
            return None;
        }
        Some(HWND(raw as *mut _))
    }

    /// An overlay, not an app: a tool window without WS_EX_APPWINDOW, so neither
    /// the taskbar nor Alt+Tab lists it.
    fn overlay_bits(ex: isize) -> isize {
        (ex | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize)
    }

    /// WS_EX_NOACTIVATE: clicking the island never steals focus from the app you're in.
    pub fn make_non_activating(win: &WebviewWindow) {
        let Some(hwnd) = hwnd_of(win) else { return };
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, overlay_bits(ex | WS_EX_NOACTIVATE.0 as isize));
        }
    }

    /// Allows activation while the chat field needs the keyboard.
    pub fn set_activating(win: &WebviewWindow, activating: bool) {
        let Some(hwnd) = hwnd_of(win) else { return };
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let want = overlay_bits(if activating {
                ex & !(WS_EX_NOACTIVATE.0 as isize)
            } else {
                ex | WS_EX_NOACTIVATE.0 as isize
            });
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
        }
    }

    /// Click-through on or off. Tao rebuilds the extended style when it does
    /// this and drops the overlay bits, so they are put back right after, on the
    /// UI thread (the cursor poll calls this from its own thread).
    pub fn set_click_through(win: &WebviewWindow, ignore: bool) {
        let _ = win.set_ignore_cursor_events(ignore);
        let w = win.clone();
        let _ = win.run_on_main_thread(move || {
            let Some(hwnd) = hwnd_of(&w) else { return };
            unsafe {
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let want = overlay_bits(ex);
                if want != ex {
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
                }
            }
        });
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::WebviewWindow;

    pub fn cursor_physical() -> Option<(f64, f64)> {
        None
    }
    pub fn make_non_activating(_win: &WebviewWindow) {}
    pub fn set_activating(_win: &WebviewWindow, _activating: bool) {}
    pub fn set_click_through(win: &WebviewWindow, ignore: bool) {
        let _ = win.set_ignore_cursor_events(ignore);
    }
}

pub fn cursor_physical() -> Option<(f64, f64)> {
    imp::cursor_physical()
}

pub fn make_non_activating(win: &WebviewWindow) {
    imp::make_non_activating(win)
}

pub fn set_activating(win: &WebviewWindow, activating: bool) {
    imp::set_activating(win, activating)
}

pub fn set_click_through(win: &WebviewWindow, ignore: bool) {
    imp::set_click_through(win, ignore)
}
