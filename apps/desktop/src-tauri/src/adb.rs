use serde::Serialize;
use std::{path::PathBuf, process::Stdio};
use tokio::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    id: String,
    serial: String,
    name: String,
    model: String,
    kind: String,
    connection: String,
    resolution: Option<Resolution>,
    android_version: Option<String>,
    battery: Option<u8>,
    status: String,
    stream_port: Option<u16>,
    latency_ms: Option<u32>,
    fps: Option<u32>,
    view_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    devices: Vec<Device>,
    adb_available: bool,
    message: Option<String>,
}

#[tauri::command]
pub async fn scan_devices() -> Result<ScanResult, String> {
    match adb(["devices", "-l"]).await {
        Ok(output) => {
            let serials = parse_device_serials(&output);
            let mut devices = Vec::with_capacity(serials.len());
            for serial in serials {
                devices.push(read_device(serial).await);
            }

            Ok(ScanResult {
                adb_available: true,
                message: if devices.is_empty() {
                    Some("ADB is available, but no authorized Android devices were found.".to_string())
                } else {
                    None
                },
                devices,
            })
        }
        Err(error) => Ok(ScanResult {
            devices: Vec::new(),
            adb_available: false,
            message: Some(format!(
                "ADB is not available. Install Android Platform Tools and make sure adb is on PATH. {error}"
            )),
        }),
    }
}

#[tauri::command]
pub async fn connect_wifi_device(address: String) -> Result<ScanResult, String> {
    let trimmed = address.trim();
    if trimmed.is_empty() {
        return Err("WiFi ADB address is empty.".to_string());
    }

    let output = adb(["connect", trimmed]).await?;
    let mut scan = scan_devices().await?;
    scan.message = Some(output.trim().to_string());
    Ok(scan)
}

#[tauri::command]
pub async fn start_android_mirror(serial: String) -> Result<u16, String> {
    let port = stable_port_for_serial(&serial);
    adb_owned(vec![
        "-s".to_string(),
        serial.clone(),
        "forward".to_string(),
        format!("tcp:{port}"),
        "localabstract:scrcpy".to_string(),
    ])
    .await?;

    let server_path = find_scrcpy_server().ok_or_else(|| {
        "Missing tools/scrcpy-server/scrcpy-server.jar. Download scrcpy server before starting real streaming."
            .to_string()
    })?;

    adb_owned(vec![
        "-s".to_string(),
        serial.clone(),
        "push".to_string(),
        server_path.to_string_lossy().to_string(),
        "/data/local/tmp/scrcpy-server.jar".to_string(),
    ])
    .await?;

    Command::new("adb")
        .args([
            "-s",
            &serial,
            "shell",
            "CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 3.1 tunnel_forward=true video=true audio=false control=true cleanup=false max_size=1080 video_codec=h264",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to start scrcpy server: {error}"))?;

    Ok(port)
}

#[tauri::command]
pub async fn send_tap(serial: String, x: i32, y: i32) -> Result<(), String> {
    validate_serial(&serial)?;
    adb_owned(vec![
        "-s".to_string(),
        serial,
        "shell".to_string(),
        "input".to_string(),
        "tap".to_string(),
        x.to_string(),
        y.to_string(),
    ])
    .await
    .map(|_| ())
}

#[tauri::command]
pub async fn send_swipe(
    serial: String,
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    duration_ms: u32,
) -> Result<(), String> {
    validate_serial(&serial)?;
    adb_owned(vec![
        "-s".to_string(),
        serial,
        "shell".to_string(),
        "input".to_string(),
        "swipe".to_string(),
        x1.to_string(),
        y1.to_string(),
        x2.to_string(),
        y2.to_string(),
        duration_ms.to_string(),
    ])
    .await
    .map(|_| ())
}

async fn read_device(serial: String) -> Device {
    let model = adb_device_prop(&serial, "ro.product.model")
        .await
        .unwrap_or_else(|| "Android device".to_string());
    let android_version = adb_device_prop(&serial, "ro.build.version.release").await;
    let resolution = read_resolution(&serial).await;
    let battery = read_battery(&serial).await;
    let connection = if serial.contains(':') { "wifi" } else { "usb" };

    Device {
        id: serial.clone(),
        serial,
        name: model.clone(),
        model,
        kind: "android".to_string(),
        connection: connection.to_string(),
        resolution,
        android_version,
        battery,
        status: "ready".to_string(),
        stream_port: None,
        latency_ms: None,
        fps: Some(0),
        view_only: false,
    }
}

async fn adb_device_prop(serial: &str, prop: &str) -> Option<String> {
    adb_owned(vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "getprop".to_string(),
        prop.to_string(),
    ])
    .await
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

async fn read_resolution(serial: &str) -> Option<Resolution> {
    let output = adb_owned(vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "wm".to_string(),
        "size".to_string(),
    ])
    .await
    .ok()?;

    let marker = "Physical size:";
    let size = output
        .lines()
        .find_map(|line| line.trim().strip_prefix(marker))
        .map(str::trim)?;
    let (width, height) = size.split_once('x')?;
    Some(Resolution {
        width: width.trim().parse().ok()?,
        height: height.trim().parse().ok()?,
    })
}

async fn read_battery(serial: &str) -> Option<u8> {
    let output = adb_owned(vec![
        "-s".to_string(),
        serial.to_string(),
        "shell".to_string(),
        "dumpsys".to_string(),
        "battery".to_string(),
    ])
    .await
    .ok()?;

    output.lines().find_map(|line| {
        let trimmed = line.trim();
        let value = trimmed.strip_prefix("level:")?.trim();
        value.parse::<u8>().ok()
    })
}

fn parse_device_serials(output: &str) -> Vec<String> {
    output
        .lines()
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?;
            let state = parts.next()?;
            (state == "device").then(|| serial.to_string())
        })
        .collect()
}

async fn adb<const N: usize>(args: [&str; N]) -> Result<String, String> {
    let output = Command::new("adb")
        .args(args)
        .output()
        .await
        .map_err(|error| error.to_string())?;
    command_output(output)
}

async fn adb_owned(args: Vec<String>) -> Result<String, String> {
    let output = Command::new("adb")
        .args(args)
        .output()
        .await
        .map_err(|error| error.to_string())?;
    command_output(output)
}

fn command_output(output: std::process::Output) -> Result<String, String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("Command exited with status {}", output.status))
        } else {
            Err(stderr)
        }
    }
}

fn stable_port_for_serial(serial: &str) -> u16 {
    let hash = serial.bytes().fold(0u16, |acc, byte| acc.wrapping_add(byte as u16));
    27183 + (hash % 2000)
}

fn validate_serial(serial: &str) -> Result<(), String> {
    if serial.trim().is_empty() {
        return Err("Device serial is empty.".to_string());
    }
    Ok(())
}

fn find_scrcpy_server() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("../../../tools/scrcpy-server/scrcpy-server.jar"),
        PathBuf::from("../../tools/scrcpy-server/scrcpy-server.jar"),
        PathBuf::from("tools/scrcpy-server/scrcpy-server.jar"),
    ];

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .and_then(|candidate| candidate.canonicalize().ok())
}
