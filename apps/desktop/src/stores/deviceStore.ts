import { create } from 'zustand';
import type { Device, LayoutMode } from '../types';
import * as adb from '../services/adb.service';

type DeviceStore = {
  devices: Device[];
  selectedId?: string;
  layout: LayoutMode;
  deviceOrder: string[];
  busy: boolean;
  notice?: string;
  scan: () => Promise<void>;
  connectWifi: (address: string) => Promise<void>;
  startMirror: (id: string) => Promise<void>;
  select: (id: string) => void;
  setLayout: (layout: LayoutMode) => void;
  upsertDevice: (device: Device) => void;
  remove: (id: string) => void;
};

const LAYOUT_KEY = 'phantomMirror.layout';
const ORDER_KEY = 'phantomMirror.deviceOrder';

function readLayout(): LayoutMode {
  const value = localStorage.getItem(LAYOUT_KEY);
  return value === 'grid' || value === 'focus' || value === 'single' ? value : 'grid';
}

function readOrder(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function sortDevicesByOrder(devices: Device[], order: string[]): Device[] {
  const index = new Map(order.map((id, position) => [id, position]));
  return [...devices].sort((a, b) => {
    const aIndex = index.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = index.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aIndex === bIndex ? a.name.localeCompare(b.name) : aIndex - bIndex;
  });
}

function persistOrder(devices: Device[]) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(devices.map((device) => device.id)));
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: [],
  selectedId: undefined,
  layout: readLayout(),
  deviceOrder: readOrder(),
  busy: false,
  notice: undefined,

  async scan() {
    set({ busy: true, notice: undefined });
    try {
      const result = await adb.scanDevices();
      const sorted = sortDevicesByOrder(result.devices, get().deviceOrder);
      const nextSelected =
        sorted.find((device) => device.id === get().selectedId)?.id ?? sorted[0]?.id;
      persistOrder(sorted);
      set({
        devices: sorted,
        deviceOrder: sorted.map((device) => device.id),
        selectedId: nextSelected,
        notice: result.message,
      });
    } catch (error) {
      set({ notice: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: false });
    }
  },

  async connectWifi(address) {
    set({ busy: true, notice: undefined });
    try {
      const result = await adb.connectWifiDevice(address);
      const sorted = sortDevicesByOrder(result.devices, get().deviceOrder);
      persistOrder(sorted);
      set({
        devices: sorted,
        deviceOrder: sorted.map((device) => device.id),
        selectedId: sorted[0]?.id,
        notice: result.message,
      });
    } catch (error) {
      set({ notice: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: false });
    }
  },

  async startMirror(id) {
    const device = get().devices.find((item) => item.id === id);
    if (!device || device.kind !== 'android') {
      return;
    }

    set((state) => ({
      devices: state.devices.map((item) =>
        item.id === id ? { ...item, status: 'connecting' } : item,
      ),
    }));

    try {
      const streamPort = await adb.startMirror(device.serial);
      set((state) => ({
        devices: state.devices.map((item) =>
          item.id === id ? { ...item, streamPort, status: 'streaming' } : item,
        ),
      }));
    } catch (error) {
      set((state) => ({
        notice: error instanceof Error ? error.message : String(error),
        devices: state.devices.map((item) =>
          item.id === id ? { ...item, status: 'error' } : item,
        ),
      }));
    }
  },

  select(id) {
    set({ selectedId: id });
  },

  setLayout(layout) {
    localStorage.setItem(LAYOUT_KEY, layout);
    set({ layout });
  },

  upsertDevice(device) {
    set((state) => {
      const exists = state.devices.some((item) => item.id === device.id);
      const devices = exists
        ? state.devices.map((item) => (item.id === device.id ? { ...item, ...device } : item))
        : [...state.devices, device];
      persistOrder(devices);
      return {
        devices,
        deviceOrder: devices.map((item) => item.id),
        selectedId: device.id,
      };
    });
  },

  remove(id) {
    set((state) => {
      const devices = state.devices.filter((item) => item.id !== id);
      return {
        devices,
        deviceOrder: devices.map((device) => device.id),
        selectedId: state.selectedId === id ? devices[0]?.id : state.selectedId,
      };
    });
    persistOrder(get().devices);
  },
}));
