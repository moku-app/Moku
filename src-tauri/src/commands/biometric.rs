#[cfg(target_os = "windows")]
mod windows_hello {
    use windows::{
        core::HSTRING,
        Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier},
        Win32::UI::WindowsAndMessaging::{
            BringWindowToTop, FindWindowW, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
        },
    };

    fn to_wide(s: &str) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn try_focus_hello_dialog() -> bool {
        let cls = to_wide("Credential Dialog Xaml Host");
        unsafe {
            let Ok(hwnd) = FindWindowW(
                windows::core::PCWSTR(cls.as_ptr()),
                windows::core::PCWSTR::null(),
            ) else {
                return false;
            };
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
            true
        }
    }

    fn nudge_focus(retries: u32, delay_ms: u64) {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            for _ in 0..retries {
                if try_focus_hello_dialog() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            }
        });
    }

    pub fn authenticate(reason: &str) -> Result<(), String> {
        nudge_focus(5, 250);
        let result = UserConsentVerifier::RequestVerificationAsync(&HSTRING::from(reason))
            .and_then(|op| {
                nudge_focus(5, 250);
                op.get()
            })
            .map_err(|e| format!("internalError:{e:?}"))?;

        match result {
            UserConsentVerificationResult::Verified => Ok(()),
            UserConsentVerificationResult::Canceled => Err("userCancel".into()),
            UserConsentVerificationResult::RetriesExhausted => Err("biometryLockout".into()),
            UserConsentVerificationResult::DeviceBusy => Err("systemCancel".into()),
            UserConsentVerificationResult::DeviceNotPresent => Err("biometryNotAvailable".into()),
            UserConsentVerificationResult::DisabledByPolicy => Err("biometryNotAvailable".into()),
            UserConsentVerificationResult::NotConfiguredForUser => Err("biometryNotEnrolled".into()),
            _ => Err("authenticationFailed".into()),
        }
    }

    pub fn is_available() -> bool {
        use windows::Security::Credentials::UI::UserConsentVerifierAvailability;
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.get())
            .map(|a| a == UserConsentVerifierAvailability::Available)
            .unwrap_or(false)
    }
}

#[tauri::command]
pub fn windows_hello_authenticate(reason: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return windows_hello::authenticate(&reason);
    #[cfg(not(target_os = "windows"))]
    Err("notSupported".into())
}

#[tauri::command]
pub fn windows_hello_available() -> bool {
    #[cfg(target_os = "windows")]
    return windows_hello::is_available();
    #[cfg(not(target_os = "windows"))]
    false
}