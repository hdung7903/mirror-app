import { PointerEvent, RefObject, useRef, useState } from 'react';
import type { Device, TouchPoint } from '../types';
import type { H264Decoder } from '../h264decoder';

type TouchOverlayProps = {
  device: Device;
  decoderRef: RefObject<H264Decoder | null>;
};

export function TouchOverlay({ device, decoderRef }: TouchOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const pressed = useRef(false);
  const [ripple, setRipple] = useState<TouchPoint | null>(null);

  function toRelativePoint(event: PointerEvent<HTMLDivElement>): TouchPoint {
    const element = overlayRef.current;
    const rect = element?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
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
    pressed.current = true;
    const point = toRelativePoint(event);
    decoderRef.current?.sendTouch(point.x, point.y, 'down');
    setRipple(toLocalPoint(event));
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pressed.current) {
      return;
    }
    const point = toRelativePoint(event);
    decoderRef.current?.sendTouch(point.x, point.y, 'move');
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!pressed.current) {
      return;
    }
    pressed.current = false;
    const point = toRelativePoint(event);
    decoderRef.current?.sendTouch(point.x, point.y, 'up');
    setTimeout(() => setRipple(null), 180);
  }

  function handlePointerLeave(event: PointerEvent<HTMLDivElement>) {
    if (!pressed.current) {
      return;
    }
    pressed.current = false;
    const point = toRelativePoint(event);
    decoderRef.current?.sendTouch(point.x, point.y, 'up');
    setTimeout(() => setRipple(null), 180);
  }

  return (
    <div
      ref={overlayRef}
      className="touch-overlay"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {ripple ? <span className="touch-ripple" style={{ left: ripple.x, top: ripple.y }} /> : null}
    </div>
  );
}
