import { useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

type SettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
};

type SettingsTab = 'streaming' | 'interface' | 'connection';

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTab>('streaming');
  const streaming = useSettingsStore((state) => state.streaming);
  const ui = useSettingsStore((state) => state.interface);
  const connection = useSettingsStore((state) => state.connection);
  const setStreaming = useSettingsStore((state) => state.setStreaming);
  const setInterface = useSettingsStore((state) => state.setInterface);
  const setConnection = useSettingsStore((state) => state.setConnection);

  if (!open) {
    return null;
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <aside className="settings-drawer" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>Settings</strong>
          <button type="button" onClick={onClose} aria-label="Close settings">
            X
          </button>
        </header>

        <div className="settings-tabs">
          {(['streaming', 'interface', 'connection'] as const).map((item) => (
            <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </div>

        {tab === 'streaming' ? (
          <section className="settings-section">
            <label>
              <span>Video quality</span>
              <select value={streaming.videoQuality} onChange={(event) => setStreaming({ videoQuality: event.target.value as typeof streaming.videoQuality })}>
                <option value="480p">480p</option>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="native">Native</option>
              </select>
            </label>
            <label>
              <span>FPS target</span>
              <select value={streaming.fpsTarget} onChange={(event) => setStreaming({ fpsTarget: Number(event.target.value) as 30 | 60 })}>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </label>
            <label>
              <span>Bitrate: {streaming.bitrateMbps} Mbps</span>
              <input
                type="range"
                min={2}
                max={12}
                step={1}
                value={streaming.bitrateMbps}
                onChange={(event) => setStreaming({ bitrateMbps: Number(event.target.value) })}
              />
            </label>
            <label className="toggle-row">
              <span>H.265</span>
              <input type="checkbox" checked={streaming.h265} onChange={(event) => setStreaming({ h265: event.target.checked })} />
            </label>
          </section>
        ) : null}

        {tab === 'interface' ? (
          <section className="settings-section">
            <label>
              <span>Theme</span>
              <select value={ui.theme} onChange={(event) => setInterface({ theme: event.target.value as typeof ui.theme })}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </label>
            <label>
              <span>Default layout</span>
              <select value={ui.defaultLayout} onChange={(event) => setInterface({ defaultLayout: event.target.value as typeof ui.defaultLayout })}>
                <option value="grid">Grid</option>
                <option value="focus">Focus</option>
                <option value="single">Single</option>
              </select>
            </label>
            <label className="toggle-row">
              <span>Show FPS counter</span>
              <input type="checkbox" checked={ui.showFpsCounter} onChange={(event) => setInterface({ showFpsCounter: event.target.checked })} />
            </label>
            <label className="toggle-row">
              <span>Show device info on hover</span>
              <input type="checkbox" checked={ui.showDeviceInfoOnHover} onChange={(event) => setInterface({ showDeviceInfoOnHover: event.target.checked })} />
            </label>
          </section>
        ) : null}

        {tab === 'connection' ? (
          <section className="settings-section">
            <label className="toggle-row">
              <span>Auto-reconnect</span>
              <input type="checkbox" checked={connection.autoReconnect} onChange={(event) => setConnection({ autoReconnect: event.target.checked })} />
            </label>
            <label>
              <span>Reconnect attempts</span>
              <select value={connection.reconnectAttempts} onChange={(event) => setConnection({ reconnectAttempts: Number(event.target.value) as 1 | 3 | 5 })}>
                <option value={1}>1</option>
                <option value={3}>3</option>
                <option value={5}>5</option>
              </select>
            </label>
            <label>
              <span>WiFi scan timeout</span>
              <select value={connection.wifiScanTimeoutSec} onChange={(event) => setConnection({ wifiScanTimeoutSec: Number(event.target.value) as 2 | 3 | 5 })}>
                <option value={2}>2s</option>
                <option value={3}>3s</option>
                <option value={5}>5s</option>
              </select>
            </label>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
