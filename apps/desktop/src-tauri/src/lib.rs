mod adb;
mod extended_display;
mod ios_airplay;
mod stream_bridge;
mod wifi_discovery;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ios_airplay::AirPlayRegistry::default())
        .manage(extended_display::ExtendedDisplayRegistry::default())
        .manage(stream_bridge::BridgeRegistry::default())
        .setup(|app| {
            adb::spawn_device_tracker(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            adb::scan_devices,
            adb::connect_wifi_device,
            adb::start_android_mirror,
            adb::send_tap,
            adb::send_swipe,
            adb::get_device_info,
            adb::rotate_device,
            adb::restore_portrait_if_home,
            adb::pair_wifi_device,
            adb::is_device_connected,
            ios_airplay::start_ios_mirror,
            ios_airplay::stop_ios_mirror,
            ios_airplay::check_uxplay,
            extended_display::start_extended_display,
            extended_display::stop_extended_display,
            extended_display::open_extended_display_window,
            stream_bridge::start_stream_bridge,
            stream_bridge::stop_stream_bridge,
            wifi_discovery::scan_wifi_devices,
            wifi_discovery::scan_local_network,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run PhantomMirror");
}
