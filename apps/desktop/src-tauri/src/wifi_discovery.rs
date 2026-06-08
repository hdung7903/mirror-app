use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use std::{collections::BTreeSet, net::Ipv4Addr, time::Duration};
use tokio::{net::TcpStream, sync::Semaphore, time::timeout};

const ADB_TLS_SERVICE: &str = "_adb-tls-connect._tcp.local.";
const MDNS_TIMEOUT: Duration = Duration::from_secs(3);
const PORT_SCAN_TIMEOUT: Duration = Duration::from_millis(450);
const PORT_SCAN_CONCURRENCY: usize = 50;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiDevice {
    ip: String,
    port: u16,
    name: String,
}

#[tauri::command]
pub async fn scan_wifi_devices() -> Result<Vec<WifiDevice>, String> {
    tokio::task::spawn_blocking(scan_mdns_blocking)
        .await
        .map_err(|error| format!("mDNS discovery task failed: {error}"))?
}

#[tauri::command]
pub async fn scan_local_network() -> Result<Vec<String>, String> {
    let base = local_subnet_base().unwrap_or_else(|| "192.168.1".to_string());
    let semaphore = std::sync::Arc::new(Semaphore::new(PORT_SCAN_CONCURRENCY));
    let mut tasks = Vec::with_capacity(254);

    for host in 1..=254u16 {
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|error| format!("Port scan semaphore failed: {error}"))?;
        let ip = format!("{base}.{host}");
        tasks.push(tokio::spawn(async move {
            let _permit = permit;
            match timeout(PORT_SCAN_TIMEOUT, TcpStream::connect((ip.as_str(), 5555))).await {
                Ok(Ok(_stream)) => Some(ip),
                Ok(Err(_)) | Err(_) => None,
            }
        }));
    }

    let mut found = Vec::new();
    for task in tasks {
        if let Ok(Some(ip)) = task.await {
            found.push(ip);
        }
    }
    found.sort();
    Ok(found)
}

fn scan_mdns_blocking() -> Result<Vec<WifiDevice>, String> {
    let daemon = ServiceDaemon::new().map_err(|error| format!("Failed to create mDNS daemon: {error}"))?;
    let receiver = daemon
        .browse(ADB_TLS_SERVICE)
        .map_err(|error| format!("Failed to browse {ADB_TLS_SERVICE}: {error}"))?;

    let deadline = std::time::Instant::now() + MDNS_TIMEOUT;
    let mut devices = Vec::new();
    let mut seen = BTreeSet::new();

    while std::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        match receiver.recv_timeout(remaining.min(Duration::from_millis(250))) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let port = info.get_port();
                let name = info
                    .get_hostname()
                    .trim_end_matches(".local.")
                    .trim_end_matches('.')
                    .to_string();

                for address in info.get_addresses() {
                    if let std::net::IpAddr::V4(ip) = address {
                        let key = format!("{ip}:{port}");
                        if seen.insert(key) {
                            devices.push(WifiDevice {
                                ip: ip.to_string(),
                                port,
                                name: if name.is_empty() {
                                    info.get_fullname().to_string()
                                } else {
                                    name.clone()
                                },
                            });
                        }
                    }
                }
            }
            Ok(_) => {}
            Err(error) => {
                if error.to_string().to_ascii_lowercase().contains("timed out") {
                    continue;
                }
                break;
            }
        }
    }

    let _ = daemon.stop_browse(ADB_TLS_SERVICE);
    let _ = daemon.shutdown();
    devices.sort_by(|a, b| a.ip.cmp(&b.ip).then(a.port.cmp(&b.port)));
    Ok(devices)
}

fn local_subnet_base() -> Option<String> {
    let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect(("8.8.8.8", 80)).ok()?;
    let ip = match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) => ip,
        std::net::IpAddr::V6(_) => return None,
    };
    let octets = ip.octets();
    if octets[0] == 192 && octets[1] == 168 {
        Some(format!("{}.{}.{}", octets[0], octets[1], octets[2]))
    } else {
        None
    }
}
