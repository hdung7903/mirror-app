import clsx from 'clsx';
import { DndContext, DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Device, LayoutMode } from '../types';
import { useDeviceStore } from '../stores/deviceStore';
import { DeviceWindow } from './DeviceWindow';

type DeviceGridProps = {
  devices: Device[];
  selectedId?: string;
  layout: LayoutMode;
};

export function DeviceGrid({ devices, selectedId, layout }: DeviceGridProps) {
  const reorderDevices = useDeviceStore((state) => state.reorderDevices);
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    reorderDevices(String(active.id), String(over.id));
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={visibleDevices.map((device) => device.id)} strategy={rectSortingStrategy}>
        <div className={clsx('device-grid', `layout-${layout}`, `count-${visibleDevices.length}`)}>
          {visibleDevices.map((device) => (
            <SortableDeviceWindow key={device.id} device={device} focused={device.id === selectedId} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableDeviceWindow({ device, focused }: { device: Device; focused: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: device.id });
  return (
    <div
      ref={setNodeRef}
      className={clsx('sortable-device', isDragging && 'dragging')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <DeviceWindow device={device} focused={focused} />
    </div>
  );
}
