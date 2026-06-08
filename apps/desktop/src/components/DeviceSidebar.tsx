import { FormEvent, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useDeviceStore } from '../stores/deviceStore';
import type { WifiDevice } from '../types';
import {
  checkUxPlay,
  pairWifiDevice,
  scanLocalNetwork,
  scanWifiDevices,
  startIosMirror,
  stopIosMirror,
} from '../services/adb.service';

const RECENT_WIFI_KEY = 'phantomMirror.recentWifiDevices';
const MAX_RECENT_WIFI = 10;

type PairDialogState = {
  ip: string;
  port: string;
  code: string;
};

type AirPlayClientChanged = {
  message?: string;
};

const isTauri = () => Boolean('__TAURI_INTERNALS__' in window);

export function DeviceSidebar() {
  const devices = useDeviceStore((state) => state.devices);
  const selectedId = useDeviceStore((state) => state.selectedId);
  const select = useDeviceStore((state) => state.select);
  const remove = useDeviceStore((state) => state.remove);
  const upsertDevice = useDeviceStore((state) => state.upsertDevice);
  const connectWifi = useDeviceStore((state) => state.connectWifi);
  const [address, setAddress] = useState('');
  const [tab, setTab] = useState<'android' | 'ios'>('android');
  const [wifiResults, setWifiResults] = useState<WifiDevice[]>([]);
  const [recentWifi, setRecentWifi] = useState<WifiDevice[]>(() => readRecentWifi());
  const [scanProgress, setScanProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [pairDialog, setPairDialog] = useState<PairDialogState | undefined>();
  const [streamStatuses, setStreamStatuses] = useState<Record<string, { status: string; fps: number }>>({});
  const [airplayName, setAirplayName] = useState('PhantomMirror');
  const [iosQuality, setIosQuality] = useState<'balanced' | 'high' | '4k'>('high');
  const [uxplayStatus, setUxplayStatus] = useState<{ installed: boolean; path?: string; version?: string } | undefined>();
  const [airplaySession, setAirplaySession] = useState<{ sessionId: string; wsPort: number; deviceName: string } | undefined>();
  const [iosNotice, setIosNotice] = useState<string | undefined>();

  useEffect(() => {
    let timer: number | undefined;
    if (scanning) {
      setScanProgress(15);
      timer = window.setInterval(() => {
        setScanProgress((value) => Math.min(92, value + 8));
      }, 250);
    }
    return () => {
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [scanning]);

  useEffect(() => {
    function handleStreamStatus(event: Event) {
      const detail = (event as CustomEvent<{ serial: string; status: string; fps: number }>).detail;
      setStreamStatuses((current) => ({
        ...current,
        [detail.serial]: { status: detail.status, fps: detail.fps },
      }));
    }

    window.addEventListener('phantommirror:stream-status', handleStreamStatus);
    return () => window.removeEventListener('phantommirror:stream-status', handleStreamStatus);
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | undefined;
    void listen<AirPlayClientChanged>('ios-client-connected', () => {
      if (airplaySession) {
        window.dispatchEvent(
          new CustomEvent('phantommirror:start-stream', {
            detail: { serial: `ios-${airplaySession.sessionId}` },
          }),
        );
      }
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });

    return () => unlisten?.();
  }, [airplaySession]);

  useEffect(() => {
    if (tab !== 'ios') {
      return;
    }
    void checkUxPlay().then(setUxplayStatus);
  }, [tab]);

  function submitWifi(event: FormEvent) {
    event.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) {
      return;
    }
    void connectWifiAddress(trimmed);
    setAddress('');
  }

  async function connectWifiAddress(value: string, name?: string) {
    const target = value.includes(':') ? value : `${value}:5555`;
    await connectWifi(target);
    const [ip, port = '5555'] = target.split(':');
    saveRecentWifi({ ip, port: Number(port), name: name ?? target });
    setRecentWifi(readRecentWifi());
    window.dispatchEvent(new CustomEvent('phantommirror:start-stream', { detail: { serial: target } }));
  }

  async function autoScan() {
    setScanning(true);
    setWifiResults([]);
    try {
      const mdnsResults = await scanWifiDevices();
      if (mdnsResults.length > 0) {
        setWifiResults(mdnsResults);
        return;
      }

      const ips = await scanLocalNetwork();
      setWifiResults(ips.map((ip) => ({ ip, port: 5555, name: 'ADB over WiFi' })));
    } finally {
      setScanProgress(100);
      window.setTimeout(() => {
        setScanning(false);
        setScanProgress(0);
      }, 350);
    }
  }

  async function submitPair(event: FormEvent) {
    event.preventDefault();
    if (!pairDialog) {
      return;
    }

    const ip = pairDialog.ip.trim();
    const port = Number(pairDialog.port);
    const code = pairDialog.code.trim();
    await pairWifiDevice(ip, port, code);
    setPairDialog(undefined);
    await connectWifiAddress(`${ip}:${port}`, `Paired ${ip}`);
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">PM</span>
        <div>
          <strong>Devices</strong>
          <span>{devices.length} connected</span>
        </div>
      </div>

      <div className="sidebar-tabs">
        <button type="button" className={tab === 'android' ? 'active' : ''} onClick={() => setTab('android')}>
          Android
        </button>
        <button type="button" className={tab === 'ios' ? 'active' : ''} onClick={() => setTab('ios')}>
          iOS
        </button>
      </div>

      {tab === 'android' ? (
        <>
          <form className="wifi-form" onSubmit={submitWifi}>
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="192.168.1.20:5555"
              aria-label="WiFi ADB address"
            />
            <button type="submit">Connect</button>
          </form>

          <div className="wifi-actions">
            <button type="button" onClick={() => void autoScan()} disabled={scanning}>
              {scanning ? 'Scanning' : 'Auto Scan'}
            </button>
            <button type="button" onClick={() => setPairDialog({ ip: '', port: '37099', code: '' })}>
              Pair
            </button>
          </div>

          {scanning ? (
            <div className="scan-progress" aria-label="WiFi scan progress">
              <span style={{ width: `${scanProgress}%` }} />
            </div>
          ) : null}

          {wifiResults.length > 0 ? (
            <section className="wifi-results">
              <strong>Discovered</strong>
              {wifiResults.map((result) => (
                <button
                  key={`${result.ip}:${result.port}`}
                  type="button"
                  onClick={() => void connectWifiAddress(`${result.ip}:${result.port}`, result.name)}
                >
                  <span>
                    {result.name}
                    <small>{result.ip}:{result.port}</small>
                  </span>
                  <em>Connect</em>
                </button>
              ))}
            </section>
          ) : null}

          {recentWifi.length > 0 ? (
            <section className="wifi-results">
              <strong>Recent devices</strong>
              {recentWifi.map((device) => (
                <button
                  key={`${device.ip}:${device.port}`}
                  type="button"
                  onClick={() => void connectWifiAddress(`${device.ip}:${device.port}`, device.name)}
                >
                  <span>
                    {device.name}
                    <small>{device.ip}:{device.port}</small>
                  </span>
                  <em>Reconnect</em>
                </button>
              ))}
            </section>
          ) : null}
        </>
      ) : (
        <section className="ios-panel">
          <p>
            {uxplayStatus?.installed
              ? `UxPlay installed: ${uxplayStatus.path ?? 'system'}${uxplayStatus.version ? ` (${uxplayStatus.version})` : ''}`
              : 'UxPlay headless runtime not found.'}
          </p>
          <input
            value={airplayName}
            onChange={(event) => setAirplayName(event.target.value)}
            aria-label="AirPlay receiver name"
          />
          <select value={iosQuality} onChange={(event) => setIosQuality(event.target.value as typeof iosQuality)}>
            <option value="balanced">Balanced 1080p30</option>
            <option value="high">High 1080p60</option>
            <option value="4k">4K H.265</option>
          </select>
          {!uxplayStatus?.installed ? (
            <button type="button" onClick={() => setIosNotice('Run tools/scripts/download-uxplay-prebuilt.mjs or build with tools/scripts/build-uxplay for this OS.')}>
              Download UxPlay
            </button>
          ) : null}
          <button type="button" onClick={() => void startIosReceiver()}>
            Start AirPlay Receiver
          </button>
          {airplaySession ? (
            <>
              <p>On iPhone: Control Center → Screen Mirroring → {airplaySession.deviceName}</p>
              <button type="button" onClick={() => void stopIosReceiver()}>
                Stop Receiver
              </button>
            </>
          ) : null}
          {iosNotice ? <p>{iosNotice}</p> : null}
        </section>
      )}

      <div className="device-list">
        {devices.map((device) => (
          (() => {
            const status = deviceStatus(device, streamStatuses[device.serial]);
            return (
          <button
            key={device.id}
            type="button"
            className={`device-row ${selectedId === device.id ? 'selected' : ''}`}
            onClick={() => select(device.id)}
          >
            <span className="platform">{device.connection === 'wifi' ? '📶' : device.connection === 'usb' ? '🔌' : 'iOS'}</span>
            <span className="device-row-body">
              <strong>{device.name}</strong>
              <small>{device.model}</small>
            </span>
            <span className="device-status">
              <span className={`status-dot ${status.kind}`} />
              <span className="device-status-text">{status.label}</span>
            </span>
          </button>
            );
          })()
        ))}
      </div>

      {selectedId ? (
        <button className="ghost-button" type="button" onClick={() => remove(selectedId)}>
          Remove selected
        </button>
      ) : null}

      {pairDialog ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="pair-dialog" onSubmit={submitPair}>
            <strong>Wireless pairing</strong>
            <input
              value={pairDialog.ip}
              placeholder="192.168.1.20"
              onChange={(event) => setPairDialog({ ...pairDialog, ip: event.target.value })}
              aria-label="Pairing IP"
            />
            <input
              value={pairDialog.port}
              placeholder="Pairing port"
              onChange={(event) => setPairDialog({ ...pairDialog, port: event.target.value })}
              aria-label="Pairing port"
            />
            <input
              value={pairDialog.code}
              placeholder="6-digit code"
              onChange={(event) => setPairDialog({ ...pairDialog, code: event.target.value })}
              aria-label="Pairing code"
            />
            <div>
              <button type="button" onClick={() => setPairDialog(undefined)}>
                Cancel
              </button>
              <button type="submit">Pair & Connect</button>
            </div>
          </form>
        </div>
      ) : null}
    </aside>
  );

  async function startIosReceiver() {
    setIosNotice(undefined);
    const uxplay = await checkUxPlay();
    setUxplayStatus(uxplay);
    if (!uxplay.installed) {
      setIosNotice('UxPlay headless runtime is not installed. Run tools/scripts/download-uxplay-prebuilt.mjs or build it into tools/uxplay/{os-arch}.');
      return;
    }

    const session = await startIosMirror(airplayName, iosQuality);
    setAirplaySession(session);

    const id = `ios-${session.sessionId}`;
    upsertDevice({
      id,
      serial: id,
      name: session.deviceName,
      model: 'AirPlay Receiver',
      kind: 'ios',
      connection: 'airplay',
      status: 'ready',
      viewOnly: true,
      streamPort: session.wsPort,
      codec: session.codec,
      airplaySessionId: session.sessionId,
    });
    setIosNotice(`Ready: choose ${session.deviceName} in iPhone Screen Mirroring.`);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('phantommirror:start-stream', { detail: { serial: id } }));
    }, 300);
  }

  async function stopIosReceiver() {
    if (!airplaySession) {
      return;
    }
    await stopIosMirror(airplaySession.sessionId);
    setAirplaySession(undefined);
    setIosNotice('AirPlay receiver stopped.');
  }
}

function readRecentWifi(): WifiDevice[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_WIFI_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_WIFI) : [];
  } catch {
    return [];
  }
}

function saveRecentWifi(device: WifiDevice) {
  const next = [
    device,
    ...readRecentWifi().filter((item) => `${item.ip}:${item.port}` !== `${device.ip}:${device.port}`),
  ].slice(0, MAX_RECENT_WIFI);
  localStorage.setItem(RECENT_WIFI_KEY, JSON.stringify(next));
}

function deviceStatus(device: { status: string; fps?: number }, stream?: { status: string; fps: number }) {
  if (stream?.status === 'ready' || stream?.status === 'connecting' || (stream?.fps ?? 0) > 0) {
    return {
      kind: stream?.status === 'connecting' ? 'connecting' : 'streaming',
      label: stream?.fps ? `${stream.fps}fps` : 'Streaming',
    };
  }
  if (device.status === 'ready') {
    return { kind: 'connecting', label: 'Connected' };
  }
  return { kind: 'error', label: 'Offline' };
}
