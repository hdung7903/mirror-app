import { PointerEvent, useRef, useState } from 'react';
import type { Device, TouchPoint } from '../types';
import { sendSwipe, sendTap } from '../services/adb.service';

type TouchOverlayProps = {
  device: Device;
};

type PointerStart = {
  point: TouchPoint;
  time: number;
};

export function TouchOverlay({ device }: TouchOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const pointerStart = useRef<PointerStart | null>(null);
  const [ripple, setRipple] = useState<TouchPoint | null>(null);

  function toDevicePoint(event: PointerEvent<HTMLDivElement>): TouchPoint {
    const element = overlayRef.current;
    const rect = element?.getBoundingClientRect();
    const resolution = device.resolution ?? { width: 1080, height: 1920 };
    if (!rect) {
      return { x: 0, y: 0 };
    }

    const x = ((event.clientX - rect.left) / rect.width) * resolution.width;
    const y = ((event.clientY - rect.top) / rect.height) * resolution.height;
    return {
      x: Math.max(0, Math.min(resolution.width, x)),
      y: Math.max(0, Math.min(resolution.height, y)),
    };
  }

  function toLocalPoint(event: PointerEvent<HTMLDivElement>): TouchPoint {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = {
      point: toDevicePoint(event),
      time: performance.now(),
    };
    setRipple(toLocalPoint(event));
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    setTimeout(() => setRipple(null), 180);
    if (!start) {
      return;
    }

    const end = toDevicePoint(event);
    const distance = Math.hypot(end.x - start.point.x, end.y - start.point.y);
    if (distance < 18) {
      void sendTap(device.serial, end);
      return;
    }

    void sendSwipe(device.serial, {
      from: start.point,
      to: end,
      durationMs: Math.max(80, Math.min(900, Math.round(performance.now() - start.time))),
    });
  }

  return (
    <div
      ref={overlayRef}
      className="touch-overlay"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {ripple ? <span className="touch-ripple" style={{ left: ripple.x, top: ripple.y }} /> : null}
    </div>
  );
}
