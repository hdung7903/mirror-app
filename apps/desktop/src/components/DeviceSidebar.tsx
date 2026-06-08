import { FormEvent, useState } from 'react';
import { useDeviceStore } from '../stores/deviceStore';

export function DeviceSidebar() {
  const devices = useDeviceStore((state) => state.devices);
  const selectedId = useDeviceStore((state) => state.selectedId);
  const select = useDeviceStore((state) => state.select);
  const remove = useDeviceStore((state) => state.remove);
  const connectWifi = useDeviceStore((state) => state.connectWifi);
  const [address, setAddress] = useState('');

  function submitWifi(event: FormEvent) {
    event.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) {
      return;
    }
    void connectWifi(trimmed);
    setAddress('');
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

      <form className="wifi-form" onSubmit={submitWifi}>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="192.168.1.20:5555"
          aria-label="WiFi ADB address"
        />
        <button type="submit">Connect</button>
      </form>

      <div className="device-list">
        {devices.map((device) => (
          <button
            key={device.id}
            type="button"
            className={`device-row ${selectedId === device.id ? 'selected' : ''}`}
            onClick={() => select(device.id)}
          >
            <span className="platform">{device.kind === 'android' ? 'A' : 'iOS'}</span>
            <span className="device-row-body">
              <strong>{device.name}</strong>
              <small>{device.model}</small>
            </span>
            <span className={`status-dot ${device.status}`} />
          </button>
        ))}
      </div>

      {selectedId ? (
        <button className="ghost-button" type="button" onClick={() => remove(selectedId)}>
          Remove selected
        </button>
      ) : null}
    </aside>
  );
}
