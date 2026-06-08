import clsx from 'clsx';
import type { Device, LayoutMode } from '../types';
import { DeviceWindow } from './DeviceWindow';

type DeviceGridProps = {
  devices: Device[];
  selectedId?: string;
  layout: LayoutMode;
};

export function DeviceGrid({ devices, selectedId, layout }: DeviceGridProps) {
  const visibleDevices =
    layout === 'single' && selectedId
      ? devices.filter((device) => device.id === selectedId)
      : devices;

  if (devices.length === 0) {
    return (
      <div className="empty-state">
        <h2>No devices found</h2>
        <p>Connect an Android phone with USB debugging enabled, or add a WiFi ADB address.</p>
      </div>
    );
  }

  return (
    <div className={clsx('device-grid', `layout-${layout}`, `count-${visibleDevices.length}`)}>
      {visibleDevices.map((device) => (
        <DeviceWindow key={device.id} device={device} focused={device.id === selectedId} />
      ))}
    </div>
  );
}
