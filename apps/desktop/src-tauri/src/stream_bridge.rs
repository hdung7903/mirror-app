use bytes::{BufMut, BytesMut};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Duration};
use tauri::State;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{broadcast, Mutex},
    task::JoinHandle,
    time::{sleep, timeout},
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

const SCRCPY_DEVICE_NAME_LEN: usize = 64;
const SCRCPY_VIDEO_META_LEN: usize = 12;
const SCRCPY_PACKET_HEADER_LEN: usize = 12;
const SCRCPY_CONNECT_TIMEOUT: Duration = Duration::from_secs(18);
const SCRCPY_CONNECT_ATTEMPT_TIMEOUT: Duration = Duration::from_millis(900);
const SCRCPY_META_ATTEMPT_TIMEOUT: Duration = Duration::from_millis(1600);

#[derive(Default)]
pub struct BridgeRegistry {
    bridges: Arc<Mutex<HashMap<String, BridgeHandle>>>,
}

struct BridgeHandle {
    shutdown: broadcast::Sender<()>,
    task: JoinHandle<()>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeMeta {
    #[serde(rename = "type")]
    message_type: &'static str,
    device_name: String,
    width: u32,
    height: u32,
}

#[tauri::command]
pub async fn start_stream_bridge(
    serial: String,
    scrcpy_tcp_port: u16,
    registry: State<'_, BridgeRegistry>,
) -> Result<u16, String> {
    validate_serial(&serial)?;
    validate_port(scrcpy_tcp_port, "scrcpy_tcp_port")?;

    if let Some(previous) = remove_bridge(&registry, &serial).await {
        shutdown_bridge(previous).await;
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("Failed to bind stream bridge WebSocket server: {error}"))?;
    let ws_port = listener
        .local_addr()
        .map_err(|error| format!("Failed to read stream bridge local address: {error}"))?
        .port();

    let (shutdown, shutdown_rx) = broadcast::channel(8);
    let serial_for_task = serial.clone();
    let shutdown_for_task = shutdown.clone();
    let task = tokio::spawn(async move {
        if let Err(error) = run_bridge_server(
            serial_for_task.clone(),
            listener,
            scrcpy_tcp_port,
            shutdown_for_task,
            shutdown_rx,
        )
        .await
        {
            eprintln!("Stream bridge for {serial_for_task} stopped with error: {error}");
        }
    });

    let handle = BridgeHandle {
        shutdown,
        task,
    };

    registry.bridges.lock().await.insert(serial, handle);
    Ok(ws_port)
}

#[tauri::command]
pub async fn stop_stream_bridge(
    serial: String,
    registry: State<'_, BridgeRegistry>,
) -> Result<(), String> {
    validate_serial(&serial)?;
    if let Some(handle) = remove_bridge(&registry, &serial).await {
        shutdown_bridge(handle).await;
    }
    Ok(())
}

async fn remove_bridge(registry: &BridgeRegistry, serial: &str) -> Option<BridgeHandle> {
    registry.bridges.lock().await.remove(serial)
}

async fn shutdown_bridge(handle: BridgeHandle) {
    let _ = handle.shutdown.send(());
    handle.task.abort();
}

async fn run_bridge_server(
    serial: String,
    listener: TcpListener,
    scrcpy_tcp_port: u16,
    shutdown: broadcast::Sender<()>,
    mut shutdown_rx: broadcast::Receiver<()>,
) -> Result<(), String> {
    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                let (client, address) = accept_result
                    .map_err(|error| format!("Failed to accept WebSocket client: {error}"))?;
                let connection_shutdown = shutdown.subscribe();
                let connection_serial = serial.clone();
                tokio::spawn(async move {
                    if let Err(error) = handle_ws_client(
                        connection_serial.clone(),
                        address,
                        client,
                        scrcpy_tcp_port,
                        connection_shutdown,
                    ).await {
                        eprintln!("Stream bridge client for {connection_serial} failed: {error}");
                    }
                });
            }
            shutdown_result = shutdown_rx.recv() => {
                match shutdown_result {
                    Ok(()) | Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                }
            }
        }
    }

    Ok(())
}

async fn handle_ws_client(
    serial: String,
    address: SocketAddr,
    client: TcpStream,
    scrcpy_tcp_port: u16,
    mut shutdown_rx: broadcast::Receiver<()>,
) -> Result<(), String> {
    let websocket = accept_async(client)
        .await
        .map_err(|error| format!("Failed to upgrade WebSocket client {address}: {error}"))?;

    let (mut scrcpy_video, mut scrcpy_control, meta) =
        open_scrcpy_session_with_retry(scrcpy_tcp_port).await?;

    let (mut ws_writer, mut ws_reader) = websocket.split();

    let meta_json = serde_json::to_string(&meta)
        .map_err(|error| format!("Failed to serialize stream metadata: {error}"))?;
    ws_writer
        .send(Message::Text(meta_json))
        .await
        .map_err(|error| format!("Failed to send stream metadata to WebSocket: {error}"))?;

    loop {
        tokio::select! {
            packet = read_scrcpy_video_packet(&mut scrcpy_video) => {
                let packet = packet?;
                ws_writer
                    .send(Message::Binary(packet))
                    .await
                    .map_err(|error| format!("Failed to relay video packet to WebSocket: {error}"))?;
            }
            ws_message = ws_reader.next() => {
                match ws_message {
                    Some(Ok(Message::Binary(payload))) => {
                        validate_control_message(&payload)?;
                        scrcpy_control
                            .write_all(&payload)
                            .await
                            .map_err(|error| format!("Failed to write control payload to scrcpy: {error}"))?;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) | Some(Ok(Message::Text(_))) => {}
                    Some(Ok(Message::Frame(_))) => {}
                    Some(Err(error)) => {
                        return Err(format!("WebSocket read error for {serial}: {error}"));
                    }
                }
            }
            shutdown_result = shutdown_rx.recv() => {
                match shutdown_result {
                    Ok(()) | Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                }
            }
        }
    }

    let _ = scrcpy_control.shutdown().await;
    let _ = scrcpy_video.shutdown().await;
    let _ = ws_writer.send(Message::Close(None)).await;
    Ok(())
}

async fn open_scrcpy_session_with_retry(
    scrcpy_tcp_port: u16,
) -> Result<(TcpStream, TcpStream, BridgeMeta), String> {
    let started_at = tokio::time::Instant::now();
    let mut last_error = "scrcpy server did not accept a session".to_string();

    while started_at.elapsed() < SCRCPY_CONNECT_TIMEOUT {
        match open_scrcpy_session_once(scrcpy_tcp_port).await {
            Ok(session) => return Ok(session),
            Err(error) => {
                last_error = error;
                sleep(Duration::from_millis(220)).await;
            }
        }
    }

    Err(format!(
        "Failed to open scrcpy session on ADB forwarded port {scrcpy_tcp_port}: {last_error}"
    ))
}

async fn open_scrcpy_session_once(
    scrcpy_tcp_port: u16,
) -> Result<(TcpStream, TcpStream, BridgeMeta), String> {
    let mut video = timeout(
        SCRCPY_CONNECT_ATTEMPT_TIMEOUT,
        TcpStream::connect(("127.0.0.1", scrcpy_tcp_port)),
    )
    .await
    .map_err(|_| "Timed out connecting scrcpy video socket.".to_string())?
    .map_err(|error| format!("Failed to connect scrcpy video socket: {error}"))?;

    let control = timeout(
        SCRCPY_CONNECT_ATTEMPT_TIMEOUT,
        TcpStream::connect(("127.0.0.1", scrcpy_tcp_port)),
    )
    .await
    .map_err(|_| "Timed out connecting scrcpy control socket.".to_string())?
    .map_err(|error| format!("Failed to connect scrcpy control socket: {error}"))?;

    let meta = timeout(SCRCPY_META_ATTEMPT_TIMEOUT, read_scrcpy_meta(&mut video))
        .await
        .map_err(|_| "Timed out waiting for scrcpy metadata.".to_string())??;

    Ok((video, control, meta))
}

async fn read_scrcpy_meta<R>(reader: &mut R) -> Result<BridgeMeta, String>
where
    R: AsyncReadExt + Unpin,
{
    let mut name_buf = [0u8; SCRCPY_DEVICE_NAME_LEN];
    reader
        .read_exact(&mut name_buf)
        .await
        .map_err(|error| format!("Failed to read scrcpy device name: {error}"))?;

    let mut display_buf = [0u8; SCRCPY_VIDEO_META_LEN];
    reader
        .read_exact(&mut display_buf)
        .await
        .map_err(|error| format!("Failed to read scrcpy video metadata: {error}"))?;

    let codec_id = String::from_utf8_lossy(&display_buf[0..4]).to_string();
    let width = u32::from_be_bytes(
        display_buf[4..8]
            .try_into()
            .map_err(|_| "Invalid scrcpy width bytes.".to_string())?,
    );
    let height = u32::from_be_bytes(
        display_buf[8..12]
            .try_into()
            .map_err(|_| "Invalid scrcpy height bytes.".to_string())?,
    );
    if codec_id != "h264" {
        return Err(format!("Unsupported scrcpy video codec: {codec_id}"));
    }

    Ok(BridgeMeta {
        message_type: "meta",
        device_name: parse_device_name(&name_buf),
        width,
        height,
    })
}

async fn read_scrcpy_video_packet<R>(reader: &mut R) -> Result<Vec<u8>, String>
where
    R: AsyncReadExt + Unpin,
{
    let mut header = [0u8; SCRCPY_PACKET_HEADER_LEN];
    reader
        .read_exact(&mut header)
        .await
        .map_err(|error| format!("Failed to read scrcpy video packet header: {error}"))?;

    let pts = u64::from_be_bytes(
        header[0..8]
            .try_into()
            .map_err(|_| "Invalid scrcpy packet pts bytes.".to_string())?,
    );
    let size = u32::from_be_bytes(
        header[8..12]
            .try_into()
            .map_err(|_| "Invalid scrcpy packet size bytes.".to_string())?,
    );
    let payload_size = usize::try_from(size)
        .map_err(|_| format!("Scrcpy packet size {size} does not fit this platform."))?;

    let mut packet = BytesMut::with_capacity(SCRCPY_PACKET_HEADER_LEN + payload_size);
    packet.put_u64(pts);
    packet.put_u32(size);
    packet.resize(SCRCPY_PACKET_HEADER_LEN + payload_size, 0);

    reader
        .read_exact(&mut packet[SCRCPY_PACKET_HEADER_LEN..])
        .await
        .map_err(|error| format!("Failed to read scrcpy video packet payload: {error}"))?;

    Ok(packet.to_vec())
}

fn parse_device_name(buf: &[u8; SCRCPY_DEVICE_NAME_LEN]) -> String {
    let end = buf
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(SCRCPY_DEVICE_NAME_LEN);
    String::from_utf8_lossy(&buf[..end]).trim().to_string()
}

fn validate_control_message(payload: &[u8]) -> Result<(), String> {
    if payload.is_empty() {
        return Err("Ignoring empty scrcpy control message.".to_string());
    }

    let message_type = payload[0];
    if message_type == 0x02 && payload.len() != 28 {
        return Err(format!(
            "Invalid scrcpy touch control message length: expected 28 bytes, got {}.",
            payload.len()
        ));
    }

    Ok(())
}

fn validate_serial(serial: &str) -> Result<(), String> {
    if serial.trim().is_empty() {
        return Err("Device serial is empty.".to_string());
    }
    Ok(())
}

fn validate_port(port: u16, name: &str) -> Result<(), String> {
    if port == 0 {
        return Err(format!("{name} must be a non-zero TCP port."));
    }
    Ok(())
}
