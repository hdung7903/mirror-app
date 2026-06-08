import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { DeviceGrid } from './components/DeviceGrid';
import { DeviceSidebar } from './components/DeviceSidebar';
import { TopBar } from './components/TopBar';
import { ExtendedDisplayWindow } from './components/ExtendedDisplayWindow';
import { useDeviceStore } from './stores/deviceStore';
import { rotateDevice } from './services/adb.service';
import { screenshotAllDevices } from './services/canvasRegistry';
import type { DeviceChangedEvent } from './types';

const isTauri = () => Boolean('__TAURI_INTERNALS__' in window);

export function App() {
  if (new URLSearchParams(window.location.search).get('view') === 'extended') {
    return <ExtendedDisplayWindow />;
  }

  const scan = useDeviceStore((state) => state.scan);
  const devices = useDeviceStore((state) => state.devices);
  const selectedId = useDeviceStore((state) => state.selectedId);
  const layout = useDeviceStore((state) => state.layout);
  const setLayout = useDeviceStore((state) => state.setLayout);
  const notice = useDeviceStore((state) => state.notice);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (!bootstrapped) {
      setBootstrapped(true);
      void scan();
    }
  }, [bootstrapped, scan]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | undefined;
    void listen<DeviceChangedEvent>('device-changed', (event) => {
      window.dispatchEvent(
        new CustomEvent('phantommirror:device-changed', {
          detail: event.payload,
        }),
      );
      void scan();
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });

    return () => unlisten?.();
  }, [scan]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'F11') {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }

      if (event.key === 'Escape') {
        void document.exitFullscreen?.();
        return;
      }

      if (!event.ctrlKey) {
        return;
      }

      const selectedDevice = devices.find((device) => device.id === selectedId);
      if (event.key === '1') {
        event.preventDefault();
        setLayout('single');
      } else if (event.key === '2') {
        event.preventDefault();
        setLayout('grid');
      } else if (event.key === '3') {
        event.preventDefault();
        setLayout('focus');
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        screenshotAllDevices();
      } else if (event.key.toLowerCase() === 'r' && selectedDevice) {
        event.preventDefault();
        void rotateDevice(selectedDevice.serial);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [devices, selectedId, setLayout]);

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

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen?.();
    return;
  }

  await document.documentElement.requestFullscreen?.();
}
