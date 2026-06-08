mod adb;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            adb::scan_devices,
            adb::connect_wifi_device,
            adb::start_android_mirror,
            adb::send_tap,
            adb::send_swipe,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run PhantomMirror");
}
