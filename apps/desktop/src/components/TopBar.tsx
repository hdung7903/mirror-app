import type { Device } from '../types';
import { useDeviceStore } from '../stores/deviceStore';

type TopBarProps = {
  selectedDevice?: Device;
};

export function TopBar({ selectedDevice }: TopBarProps) {
  const layout = useDeviceStore((state) => state.layout);
  const setLayout = useDeviceStore((state) => state.setLayout);
  const scan = useDeviceStore((state) => state.scan);
  const busy = useDeviceStore((state) => state.busy);

  return (
    <header className="topbar">
      <div>
        <h1>PhantomMirror</h1>
        <p>
          {selectedDevice
            ? `${selectedDevice.name} - ${selectedDevice.connection.toUpperCase()}`
            : 'No device selected'}
        </p>
      </div>

      <div className="topbar-actions">
        <div className="segmented" aria-label="Layout">
          {(['grid', 'focus', 'single'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={layout === mode ? 'active' : ''}
              onClick={() => setLayout(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <button className="primary-button" type="button" onClick={() => void scan()} disabled={busy}>
          {busy ? 'Scanning' : 'Scan'}
        </button>
      </div>
    </header>
  );
}
