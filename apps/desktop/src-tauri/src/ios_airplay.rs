use bytes::{BufMut, BytesMut};
use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    collections::HashMap,
    env,
    path::PathBuf,
    process::Stdio,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    net::{TcpListener, UdpSocket},
    process::{Child, Command},
    sync::{broadcast, Mutex},
    task::JoinHandle,
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

const RTP_CLOCK_HZ: u64 = 90_000;
const RTP_PACKET_MAX: usize = 65_536;
const WS_CHANNEL_CAPACITY: usize = 256;

static IOS_SESSIONS: Lazy<Arc<Mutex<HashMap<String, IosSession>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

pub struct AirPlayRegistry;

impl Default for AirPlayRegistry {
    fn default() -> Self {
        Self
    }
}

struct IosSession {
    _session_id: String,
    _device_name: String,
    uxplay_process: Child,
    _rtp_port: u16,
    _ws_port: u16,
    bridge_handle: JoinHandle<()>,
}

#[derive(Clone)]
struct IosBridgeMeta {
    device_name: String,
    width: u32,
    height: u32,
    codec: String,
    fps: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosMirrorInfo {
    session_id: String,
    ws_port: u16,
    rtp_port: u16,
    codec: String,
    device_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UxPlayStatus {
    installed: bool,
    path: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IosMeta {
    #[serde(rename = "type")]
    message_type: &'static str,
    device_name: String,
    width: u32,
    height: u32,
    codec: String,
    fps: u32,
}

#[derive(Clone, Copy)]
struct QualityPreset {
    width: u32,
    height: u32,
    fps: u32,
    codec: &'static str,
    h265: bool,
}

#[derive(Default)]
struct H264FuState {
    timestamp: u32,
    started: bool,
    data: Vec<u8>,
}

#[derive(Default)]
struct H265FuState {
    timestamp: u32,
    started: bool,
    data: Vec<u8>,
}

#[tauri::command]
pub async fn start_ios_mirror(
    app: AppHandle,
    device_name: String,
    quality: String,
) -> Result<IosMirrorInfo, String> {
    let uxplay_bin = find_uxplay_binary(&app)?;
    let preset = quality_preset(&quality);
    let name = if device_name.trim().is_empty() {
        "PhantomMirror".to_string()
    } else {
        device_name.trim().to_string()
    };

    let rtp_port = bind_free_udp_port().await?;
    let meta = IosBridgeMeta {
        device_name: name.clone(),
        width: preset.width,
        height: preset.height,
        codec: preset.codec.to_string(),
        fps: preset.fps,
    };
    let (ws_port, bridge_handle) = start_rtp_to_ws_bridge(rtp_port, meta).await?;
    let session_id = format!("ios-{}", now_millis());

    let mut command = Command::new(&uxplay_bin);
    if let Some(parent) = uxplay_bin.parent() {
        command.current_dir(parent);
    }
    if preset.h265 {
        command.arg("-h265");
    }
    let resolution = format!("{}x{}@{}", preset.width, preset.height, preset.fps);
    let rtp_pipeline = if preset.h265 {
        format!("pt=96 ! udpsink host=127.0.0.1 port={rtp_port}")
    } else {
        format!("config-interval=1 pt=96 ! udpsink host=127.0.0.1 port={rtp_port}")
    };
    command
        .args(["-n", &name, "-nh"])
        .args(["-s", &resolution, "-fps", &preset.fps.to_string()])
        .args(["-vs", "0", "-as", "0"])
        .args(["-vp", preset.codec])
        .args(["-vrtp", &rtp_pipeline])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let mut uxplay_process = command
        .spawn()
        .map_err(|error| format!("Failed to start bundled UxPlay headless receiver: {error}"))?;

    if let Some(stdout) = uxplay_process.stdout.take() {
        spawn_uxplay_log_reader(app.clone(), BufReader::new(stdout));
    }
    if let Some(stderr) = uxplay_process.stderr.take() {
        spawn_uxplay_log_reader(app.clone(), BufReader::new(stderr));
    }

    IOS_SESSIONS.lock().await.insert(
        session_id.clone(),
        IosSession {
            _session_id: session_id.clone(),
            _device_name: name.clone(),
            uxplay_process,
            _rtp_port: rtp_port,
            _ws_port: ws_port,
            bridge_handle,
        },
    );

    Ok(IosMirrorInfo {
        session_id,
        ws_port,
        rtp_port,
        codec: preset.codec.to_string(),
        device_name: name,
    })
}

#[tauri::command]
pub async fn stop_ios_mirror(session_id: String) -> Result<(), String> {
    if let Some(mut session) = IOS_SESSIONS.lock().await.remove(&session_id) {
        let _ = session.uxplay_process.kill().await;
        session.bridge_handle.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn check_uxplay(app: AppHandle) -> UxPlayStatus {
    match find_uxplay_binary(&app) {
        Ok(path) => {
            let version = read_uxplay_version(&path).await;
            UxPlayStatus {
                installed: true,
                path: Some(path.to_string_lossy().to_string()),
                version,
            }
        }
        Err(_) => UxPlayStatus {
            installed: false,
            path: None,
            version: None,
        },
    }
}

async fn start_rtp_to_ws_bridge(
    rtp_port: u16,
    meta: IosBridgeMeta,
) -> Result<(u16, JoinHandle<()>), String> {
    let udp = UdpSocket::bind(("127.0.0.1", rtp_port))
        .await
        .map_err(|error| format!("Failed to bind iOS RTP UDP socket: {error}"))?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("Failed to bind iOS WebSocket bridge: {error}"))?;
    let ws_port = listener
        .local_addr()
        .map_err(|error| format!("Failed to read iOS WebSocket bridge port: {error}"))?
        .port();
    let (tx, _rx) = broadcast::channel::<Vec<u8>>(WS_CHANNEL_CAPACITY);
    let ws_tx = tx.clone();
    let ws_meta = meta.clone();

    let task = tokio::spawn(async move {
        tokio::spawn(async move {
            loop {
                let Ok((client, _)) = listener.accept().await else {
                    continue;
                };
                let mut rx = ws_tx.subscribe();
                let client_meta = ws_meta.clone();
                tokio::spawn(async move {
                    let Ok(websocket) = accept_async(client).await else {
                        return;
                    };
                    let (mut writer, _) = websocket.split();
                    let meta_json = serde_json::to_string(&IosMeta {
                        message_type: "meta",
                        device_name: client_meta.device_name,
                        width: client_meta.width,
                        height: client_meta.height,
                        codec: client_meta.codec,
                        fps: client_meta.fps,
                    });
                    let Ok(meta_json) = meta_json else {
                        return;
                    };
                    if writer.send(Message::Text(meta_json)).await.is_err() {
                        return;
                    }
                    while let Ok(frame) = rx.recv().await {
                        if writer.send(Message::Binary(frame)).await.is_err() {
                            break;
                        }
                    }
                });
            }
        });

        let mut buf = vec![0u8; RTP_PACKET_MAX];
        let mut h264_fu = H264FuState::default();
        let mut h265_fu = H265FuState::default();
        loop {
            let Ok(read) = udp.recv(&mut buf).await else {
                break;
            };
            let packet = &buf[..read];
            let Some(rtp) = parse_rtp_packet(packet) else {
                continue;
            };
            let nal_units = if meta.codec == "h265" {
                depacketize_h265(rtp.payload, rtp.timestamp, &mut h265_fu)
            } else {
                depacketize_h264(rtp.payload, rtp.timestamp, &mut h264_fu)
            };
            let pts_us = (u64::from(rtp.timestamp) * 1_000_000) / RTP_CLOCK_HZ;
            for nal in nal_units {
                let frame = build_video_frame(pts_us, &nal);
                let _ = tx.send(frame);
            }
        }
    });

    Ok((ws_port, task))
}

fn parse_rtp_packet(packet: &[u8]) -> Option<RtpPacket<'_>> {
    if packet.len() < 12 || packet[0] >> 6 != 2 {
        return None;
    }
    let csrc_count = usize::from(packet[0] & 0x0f);
    let has_extension = (packet[0] & 0x10) != 0;
    let timestamp = u32::from_be_bytes([packet[4], packet[5], packet[6], packet[7]]);
    let mut offset = 12 + csrc_count * 4;
    if packet.len() < offset {
        return None;
    }
    if has_extension {
        if packet.len() < offset + 4 {
            return None;
        }
        let ext_len_words = usize::from(u16::from_be_bytes([packet[offset + 2], packet[offset + 3]]));
        offset += 4 + ext_len_words * 4;
    }
    if packet.len() < offset {
        return None;
    }
    Some(RtpPacket {
        timestamp,
        payload: &packet[offset..],
    })
}

struct RtpPacket<'a> {
    timestamp: u32,
    payload: &'a [u8],
}

fn depacketize_h264(payload: &[u8], timestamp: u32, fu: &mut H264FuState) -> Vec<Vec<u8>> {
    if payload.is_empty() {
        return Vec::new();
    }
    let nal_type = payload[0] & 0x1f;
    match nal_type {
        1..=23 => vec![annex_b(payload)],
        24 => parse_h264_stap_a(&payload[1..]),
        28 => parse_h264_fu_a(payload, timestamp, fu).into_iter().collect(),
        _ => Vec::new(),
    }
}

fn parse_h264_stap_a(mut payload: &[u8]) -> Vec<Vec<u8>> {
    let mut units = Vec::new();
    while payload.len() >= 2 {
        let size = usize::from(u16::from_be_bytes([payload[0], payload[1]]));
        payload = &payload[2..];
        if payload.len() < size {
            break;
        }
        units.push(annex_b(&payload[..size]));
        payload = &payload[size..];
    }
    units
}

fn parse_h264_fu_a(payload: &[u8], timestamp: u32, fu: &mut H264FuState) -> Option<Vec<u8>> {
    if payload.len() < 2 {
        return None;
    }
    let indicator = payload[0];
    let header = payload[1];
    let start = (header & 0x80) != 0;
    let end = (header & 0x40) != 0;
    let nal_type = header & 0x1f;
    if start {
        fu.timestamp = timestamp;
        fu.started = true;
        fu.data.clear();
        fu.data.push((indicator & 0xe0) | nal_type);
        fu.data.extend_from_slice(&payload[2..]);
        return None;
    }
    if !fu.started || fu.timestamp != timestamp {
        return None;
    }
    fu.data.extend_from_slice(&payload[2..]);
    if end {
        fu.started = false;
        return Some(annex_b(&fu.data));
    }
    None
}

fn depacketize_h265(payload: &[u8], timestamp: u32, fu: &mut H265FuState) -> Vec<Vec<u8>> {
    if payload.len() < 2 {
        return Vec::new();
    }
    let nal_type = (payload[0] >> 1) & 0x3f;
    match nal_type {
        0..=47 => vec![annex_b(payload)],
        48 => parse_h265_ap(&payload[2..]),
        49 => parse_h265_fu(payload, timestamp, fu).into_iter().collect(),
        _ => Vec::new(),
    }
}

fn parse_h265_ap(mut payload: &[u8]) -> Vec<Vec<u8>> {
    let mut units = Vec::new();
    while payload.len() >= 2 {
        let size = usize::from(u16::from_be_bytes([payload[0], payload[1]]));
        payload = &payload[2..];
        if payload.len() < size {
            break;
        }
        units.push(annex_b(&payload[..size]));
        payload = &payload[size..];
    }
    units
}

fn parse_h265_fu(payload: &[u8], timestamp: u32, fu: &mut H265FuState) -> Option<Vec<u8>> {
    if payload.len() < 3 {
        return None;
    }
    let fu_header = payload[2];
    let start = (fu_header & 0x80) != 0;
    let end = (fu_header & 0x40) != 0;
    let nal_type = fu_header & 0x3f;
    if start {
        fu.timestamp = timestamp;
        fu.started = true;
        fu.data.clear();
        fu.data.push((payload[0] & 0x81) | (nal_type << 1));
        fu.data.push(payload[1]);
        fu.data.extend_from_slice(&payload[3..]);
        return None;
    }
    if !fu.started || fu.timestamp != timestamp {
        return None;
    }
    fu.data.extend_from_slice(&payload[3..]);
    if end {
        fu.started = false;
        return Some(annex_b(&fu.data));
    }
    None
}

fn annex_b(nal: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(4 + nal.len());
    output.extend_from_slice(&[0, 0, 0, 1]);
    output.extend_from_slice(nal);
    output
}

fn build_video_frame(pts_us: u64, annex_b: &[u8]) -> Vec<u8> {
    let size = u32::try_from(annex_b.len()).unwrap_or(u32::MAX);
    let mut frame = BytesMut::with_capacity(12 + annex_b.len());
    frame.put_u64(pts_us);
    frame.put_u32(size);
    frame.extend_from_slice(annex_b);
    frame.to_vec()
}

fn quality_preset(quality: &str) -> QualityPreset {
    match quality {
        "high" => QualityPreset {
            width: 1920,
            height: 1080,
            fps: 60,
            codec: "h264",
            h265: false,
        },
        "4k" => QualityPreset {
            width: 3840,
            height: 2160,
            fps: 60,
            codec: "h265",
            h265: true,
        },
        _ => QualityPreset {
            width: 1920,
            height: 1080,
            fps: 30,
            codec: "h264",
            h265: false,
        },
    }
}

async fn bind_free_udp_port() -> Result<u16, String> {
    let socket = UdpSocket::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("Failed to allocate local UDP port: {error}"))?;
    let port = socket
        .local_addr()
        .map_err(|error| format!("Failed to read local UDP port: {error}"))?
        .port();
    drop(socket);
    Ok(port)
}

fn find_uxplay_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let exe = if cfg!(windows) { "uxplay.exe" } else { "uxplay" };
    let platform_dir = os_arch_dir();
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("tools").join("uxplay").join(platform_dir).join(exe));
    }
    candidates.push(workspace_path(["tools", "uxplay", platform_dir, exe]));
    candidates.push(PathBuf::from("tools").join("uxplay").join(platform_dir).join(exe));

    if let Some(path_binary) = find_on_path(exe) {
        candidates.push(path_binary);
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .and_then(|candidate| candidate.canonicalize().ok())
        .ok_or_else(|| format!("UxPlay headless binary not found for {platform_dir}. Build it with tools/scripts/build-uxplay."))
}

fn find_on_path(exe: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(exe);
        if candidate.exists() {
            return Some(candidate);
        }
        if cfg!(windows) && !exe.to_ascii_lowercase().ends_with(".exe") {
            let candidate = dir.join(format!("{exe}.exe"));
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn os_arch_dir() -> &'static str {
    match (env::consts::OS, env::consts::ARCH) {
        ("windows", "x86_64") => "win32-x64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("macos", "aarch64") => "darwin-arm64",
        _ => "unknown",
    }
}

async fn read_uxplay_version(path: &PathBuf) -> Option<String> {
    let output = Command::new(path)
        .arg("--version")
        .output()
        .await
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stdout.is_empty() {
        Some(stdout)
    } else if !stderr.is_empty() {
        Some(stderr)
    } else {
        None
    }
}

fn spawn_uxplay_log_reader<R>(app: AppHandle, reader: BufReader<R>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let lower = line.to_ascii_lowercase();
            if lower.contains("waiting for connection") || lower.contains("initialized server") {
                let _ = app.emit("ios-ready", line.clone());
            } else if lower.contains("client connected") || lower.contains("accepted") {
                let _ = app.emit("ios-client-connected", line.clone());
            } else if lower.contains("client disconnected") || lower.contains("stopping") {
                let _ = app.emit("ios-client-disconnected", line.clone());
            }
            eprintln!("UxPlay: {line}");
        }
    });
}

fn workspace_path<const N: usize>(parts: [&str; N]) -> PathBuf {
    let mut path = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for _ in 0..3 {
        if path.join("MIRROR_APP_PROJECT.md").exists() || path.join("tools").exists() {
            break;
        }
        if !path.pop() {
            break;
        }
    }
    for part in parts {
        path.push(part);
    }
    path
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
