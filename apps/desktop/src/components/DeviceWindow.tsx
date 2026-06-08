import { useDeviceStore } from '../stores/deviceStore';
import type { Device } from '../types';
import { StreamCanvas } from './StreamCanvas';
import { TouchOverlay } from './TouchOverlay';

type DeviceWindowProps = {
  device: Device;
  focused: boolean;
};

export function DeviceWindow({ device, focused }: DeviceWindowProps) {
  const select = useDeviceStore((state) => state.select);
  const startMirror = useDeviceStore((state) => state.startMirror);

  const resolution = device.resolution
    ? `${device.resolution.width} x ${device.resolution.height}`
    : 'Unknown resolution';

  return (
    <article className={`device-window ${focused ? 'focused' : ''}`} onClick={() => select(device.id)}>
      <header className="device-header">
        <div>
          <strong>{device.name}</strong>
          <span>{resolution}</span>
        </div>
        <div className="device-metrics">
          <span>{device.fps ?? 0} fps</span>
          <span>{device.latencyMs ? `${device.latencyMs} ms` : '-- ms'}</span>
        </div>
      </header>

      <div className="screen-frame">
        <StreamCanvas device={device} />
        {!device.viewOnly ? <TouchOverlay device={device} /> : <span className="view-only">View only</span>}
      </div>

      <footer className="device-toolbar">
        <button type="button" onClick={() => void startMirror(device.id)} disabled={device.viewOnly}>
          {device.status === 'streaming' ? 'Restart' : 'Mirror'}
        </button>
        <button type="button" disabled>
          Rotate
        </button>
        <button type="button" disabled>
          Shot
        </button>
        <span className={`status-label ${device.status}`}>{device.status}</span>
      </footer>
    </article>
  );
}
