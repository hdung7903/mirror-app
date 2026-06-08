use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{broadcast, Mutex},
    task::JoinHandle,
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

#[derive(Default)]
pub struct ExtendedDisplayRegistry {
    sessions: Arc<Mutex<HashMap<u16, ExtendedDisplayHandle>>>,
}

struct ExtendedDisplayHandle {
    shutdown: broadcast::Sender<()>,
    task: JoinHandle<()>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtendedTouchEvent {
    #[serde(rename = "type")]
    event_type: String,
    x: f32,
    y: f32,
    action: String,
}

#[tauri::command]
pub async fn start_extended_display(
    width: u32,
    height: u32,
    app: AppHandle,
    registry: State<'_, ExtendedDisplayRegistry>,
) -> Result<u16, String> {
    if width == 0 || height == 0 {
        return Err("Extended display dimensions must be non-zero.".to_string());
    }
    let listener = TcpListener::bind(("0.0.0.0", 0))
        .await
        .map_err(|error| format!("Failed to bind extended display server: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Failed to read extended display port: {error}"))?
        .port();
    let (shutdown, shutdown_rx) = broadcast::channel(8);
    let shutdown_for_task = shutdown.clone();
    let task = tokio::spawn(async move {
        if let Err(error) = run_extended_server(app, listener, shutdown_for_task, shutdown_rx).await {
            eprintln!("Extended display server stopped: {error}");
        }
    });

    registry
        .sessions
        .lock()
        .await
        .insert(port, ExtendedDisplayHandle { shutdown, task });

    Ok(port)
}

#[tauri::command]
pub async fn stop_extended_display(
    port: u16,
    registry: State<'_, ExtendedDisplayRegistry>,
) -> Result<(), String> {
    if let Some(handle) = registry.sessions.lock().await.remove(&port) {
        let _ = handle.shutdown.send(());
        handle.task.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn open_extended_display_window(
    port: u16,
    width: u32,
    height: u32,
    app: AppHandle,
) -> Result<(), String> {
    let label = format!("extended-display-{port}");
    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_focus()
            .map_err(|error| format!("Failed to focus extended display window: {error}"))?;
        return Ok(());
    }

    let url = format!("index.html?view=extended&port={port}&width={width}&height={height}");
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title("PhantomMirror Extended Display")
        .inner_size(width as f64, height as f64)
        .resizable(true)
        .build()
        .map_err(|error| format!("Failed to open extended display window: {error}"))?;
    Ok(())
}

async fn run_extended_server(
    app: AppHandle,
    listener: TcpListener,
    shutdown: broadcast::Sender<()>,
    mut shutdown_rx: broadcast::Receiver<()>,
) -> Result<(), String> {
    let (frame_tx, _) = broadcast::channel::<Vec<u8>>(24);

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                let (client, _) = accept_result
                    .map_err(|error| format!("Failed to accept extended display client: {error}"))?;
                let app_for_client = app.clone();
                let tx = frame_tx.clone();
                let rx = frame_tx.subscribe();
                let connection_shutdown = shutdown.subscribe();
                tokio::spawn(async move {
                    if let Err(error) = handle_extended_client(app_for_client, client, tx, rx, connection_shutdown).await {
                        eprintln!("Extended display client failed: {error}");
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

async fn handle_extended_client(
    app: AppHandle,
    client: TcpStream,
    frame_tx: broadcast::Sender<Vec<u8>>,
    mut frame_rx: broadcast::Receiver<Vec<u8>>,
    mut shutdown_rx: broadcast::Receiver<()>,
) -> Result<(), String> {
    let websocket = accept_async(client)
        .await
        .map_err(|error| format!("Failed to upgrade extended display WebSocket: {error}"))?;
    let (mut writer, mut reader) = websocket.split();

    loop {
        tokio::select! {
            incoming = reader.next() => {
                match incoming {
                    Some(Ok(Message::Binary(frame))) => {
                        let _ = frame_tx.send(frame);
                    }
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(event) = serde_json::from_str::<ExtendedTouchEvent>(&text) {
                            if event.event_type == "touch" {
                                app.emit("ext-touch", event)
                                    .map_err(|error| format!("Failed to emit ext-touch: {error}"))?;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) | Some(Ok(Message::Frame(_))) => {}
                    Some(Err(error)) => return Err(format!("Extended WebSocket read failed: {error}")),
                }
            }
            frame = frame_rx.recv() => {
                match frame {
                    Ok(bytes) => {
                        writer
                            .send(Message::Binary(bytes))
                            .await
                            .map_err(|error| format!("Failed to relay extended display frame: {error}"))?;
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
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

    let _ = writer.send(Message::Close(None)).await;
    Ok(())
}
