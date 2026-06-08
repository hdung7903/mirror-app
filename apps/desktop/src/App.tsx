import { useEffect, useMemo, useState } from 'react';
import { DeviceGrid } from './components/DeviceGrid';
import { DeviceSidebar } from './components/DeviceSidebar';
import { TopBar } from './components/TopBar';
import { useDeviceStore } from './stores/deviceStore';

export function App() {
  const scan = useDeviceStore((state) => state.scan);
  const devices = useDeviceStore((state) => state.devices);
  const selectedId = useDeviceStore((state) => state.selectedId);
  const layout = useDeviceStore((state) => state.layout);
  const notice = useDeviceStore((state) => state.notice);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (!bootstrapped) {
      setBootstrapped(true);
      void scan();
    }
  }, [bootstrapped, scan]);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedId),
    [devices, selectedId],
  );

  return (
    <main className="shell">
      <DeviceSidebar />
      <section className="workspace">
        <TopBar selectedDevice={selectedDevice} />
        {notice ? <div className="notice">{notice}</div> : null}
        <DeviceGrid devices={devices} selectedId={selectedId} layout={layout} />
      </section>
    </main>
  );
}
