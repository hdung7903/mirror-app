# 📱 PhantomMirror — Dự án tự xây dựng app Mirror đa thiết bị

> **Phiên bản:** 1.0.0 | **Ngày:** 2026-06-08  
> Tài liệu research, kiến trúc, tech stack và prompt để khởi tạo dự án

---

## 📌 Mục lục

1. [Tổng quan dự án](#1-tổng-quan-dự-án)
2. [Research & So sánh giải pháp](#2-research--so-sánh-giải-pháp)
3. [Kiến trúc hệ thống](#3-kiến-trúc-hệ-thống)
4. [Tech Stack chi tiết](#4-tech-stack-chi-tiết)
5. [Cấu trúc thư mục](#5-cấu-trúc-thư-mục)
6. [Roadmap phát triển](#6-roadmap-phát-triển)
7. [Setup môi trường](#7-setup-môi-trường)
8. [Prompts tạo dự án](#8-prompts-tạo-dự-án)
9. [Rủi ro & Giải pháp](#9-rủi-ro--giải-pháp)

---

## 1. Tổng quan dự án

### Tên dự án: **PhantomMirror**

### Mục tiêu
Xây dựng ứng dụng **phản chiếu màn hình đa thiết bị** (nhiều điện thoại/tablet cùng lúc) lên laptop/PC, hỗ trợ:

- Mirror realtime từ Android & iOS lên màn hình PC/Laptop
- Điều khiển touch/swipe/click từ PC xuống thiết bị (Android)
- Nhiều thiết bị hiển thị đồng thời trên một màn hình (tiling layout)
- Dùng điện thoại/tablet như màn hình thứ 2 cho PC (extended display)
- Kết nối qua USB (ổn định) và WiFi LAN (không dây)
- Chạy trên Windows, macOS, Linux

### Điểm khác biệt so với app thương mại
| Tính năng | PhantomMirror | scrcpy | AnyDesk | ApowerMirror |
|---|---|---|---|---|
| Miễn phí hoàn toàn | ✅ | ✅ | ❌ | ❌ |
| Multi-device UI | ✅ | ❌ | ❌ | Trả phí |
| Android control | ✅ | ✅ | ✅ | ✅ |
| iOS mirror | ✅ (AirPlay) | ❌ | ✅ | ✅ |
| Extended display | ✅ (Android) | ❌ | ❌ | ❌ |
| Mã nguồn mở | ✅ | ✅ | ❌ | ❌ |
| Custom UI/UX | ✅ | Minimal | ❌ | ❌ |

---

## 2. Research & So sánh giải pháp

### 2.1 Tại sao không dùng app có sẵn?

**scrcpy** — Tốt nhất cho Android nhưng:
- Không có multi-device UI (chỉ từng cửa sổ riêng lẻ)
- Không hỗ trợ iOS
- UI rất thô sơ, không có tiling/grid view

**AnyDesk / ApowerMirror** — Trả phí cao:
- ~$15-20/tháng cho tính năng multi-device
- Không tùy biến được
- Phụ thuộc server của họ

**Giải pháp:** Fork/extend scrcpy làm lõi cho Android + tích hợp UxPlay cho iOS

### 2.2 Nghiên cứu Protocol

#### Android Streaming (Kết luận: H.264 qua ADB)
```
Các lựa chọn:
1. ADB (Android Debug Bridge)
   ✅ Ổn định, low-level, không cần app phía Android
   ✅ Hỗ trợ USB và WiFi (adb connect <ip>)
   ✅ scrcpy đã chứng minh hiệu quả
   Latency: ~30-80ms qua USB, ~50-150ms qua WiFi

2. WebRTC (qua app Android)
   ✅ Cross-network (không cần cùng mạng)
   ❌ Cần cài app phía Android
   ❌ Phức tạp hơn
   Latency: ~80-200ms

3. RTSP/RTMP
   ❌ Latency cao (~500ms+)
   ❌ Không phù hợp realtime control

→ Chọn: ADB cho USB, WebSocket+H.264 cho WiFi LAN
```

#### iOS Streaming (Kết luận: AirPlay + ReplayKit)
```
Các lựa chọn:
1. AirPlay (Apple protocol)
   ✅ Native iOS support, không cần jailbreak
   ✅ UxPlay (open source AirPlay receiver) chạy trên Linux/Mac/Win
   ❌ Không thể inject touch (Apple sandbox)
   Latency: ~100-300ms

2. QuickTime qua USB (libimobiledevice)
   ✅ Ổn định, không lag
   ✅ Không cần app phía iOS
   ❌ Chỉ mirror, không control
   Latency: ~50-100ms

3. ReplayKit (iOS app)
   ✅ Capture screen chính xác
   ❌ Cần app phía iOS + Apple Developer account

→ Chọn: QuickTime USB (primary) + AirPlay WiFi (secondary)
   Control iOS: Chỉ khi dùng WebDriverAgent (dev mode)
```

#### Extended Display Android
```
Giải pháp:
- Android Presentation API: Cho phép app render lên màn hình thứ 2
- Virtual Display (adb shell wm): Tạo màn hình ảo
- spacedesk protocol: Có thể reverse-engineer

→ Chọn: Virtual Display API + custom Android agent app
```

### 2.3 Các thư viện mã nguồn mở làm nền tảng

| Thư viện | Mục đích | License |
|---|---|---|
| scrcpy | Android mirror/control core | Apache 2.0 |
| UxPlay | AirPlay receiver (iOS WiFi) | GPL 3.0 |
| libimobiledevice | iOS USB communication | LGPL |
| adblib | ADB protocol trong JVM/Node | Apache 2.0 |
| WebRTC (libwebrtc) | Streaming protocol | BSD |

---

## 3. Kiến trúc hệ thống

```
╔═══════════════════════════════════════════════════════════════╗
║                    LAPTOP / PC (HOST)                         ║
║                                                               ║
║  ┌─────────────────────────────────────────────────────────┐  ║
║  │              PhantomMirror Desktop App                   │  ║
║  │                  (Tauri + React)                         │  ║
║  │                                                          │  ║
║  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │  ║
║  │  │Android 1 │  │Android 2 │  │ iPhone 1 │  │ Tab 1  │  │  ║
║  │  │[stream]  │  │[stream]  │  │[stream]  │  │[stream]│  │  ║
║  │  │[control] │  │[control] │  │[view only│  │[control│  │  ║
║  │  └──────────┘  └──────────┘  └──────────┘  └────────┘  │  ║
║  │                                                          │  ║
║  │  ┌────────────────────────────────────────────────────┐  │  ║
║  │  │  Device Manager | Layout Manager | Settings        │  │  ║
║  │  └────────────────────────────────────────────────────┘  │  ║
║  └─────────────────────────────────────────────────────────┘  ║
║          ↕                    ↕                   ↕           ║
║    ┌───────────┐        ┌───────────┐       ┌───────────┐     ║
║    │ADB Service│        │iOS Service│       │WiFi Server│     ║
║    │(Rust/Node)│        │(libimob.) │       │(WebSocket)│     ║
║    └───────────┘        └───────────┘       └───────────┘     ║
╚═══════════════════════════════════════════════════════════════╝
         │ USB/WiFi              │ USB                │ WiFi
         ▼                       ▼                    ▼
  ┌─────────────┐        ┌─────────────┐     ┌─────────────┐
  │Android Phone│        │  iPhone     │     │Android/iOS  │
  │  + Agent    │        │ (no app)    │     │  (WiFi)     │
  │    APK      │        │             │     │             │
  └─────────────┘        └─────────────┘     └─────────────┘
```

### 3.1 Luồng dữ liệu Streaming

```
[Android Screen] 
    → MediaProjection API (capture frames)
    → MediaCodec (encode H.264, hardware)
    → ADB socket / WebSocket
    → Desktop App (decode H.264)
    → Render lên Canvas/WebGL
    → Hiển thị ~30-60 FPS

[User Click/Swipe trên PC]
    → TouchOverlay component (capture mouse events)
    → Tính toán tọa độ tương đối với màn hình device
    → Gửi qua ADB: "adb shell input tap X Y"
    → Android thực thi touch event
    → Latency: ~20-50ms (USB)
```

### 3.2 Multi-device Management

```
DeviceManager
├── scanDevices()           → Quét USB + WiFi
├── registerDevice(device)  → Thêm device vào pool
├── removeDevice(id)        → Xử lý disconnect
├── getStream(id)           → Lấy video stream
└── sendInput(id, event)    → Gửi touch event

Layout Engine
├── GridLayout (2x2, 3x3, custom)
├── FocusLayout (1 main + nhiều thumbnail)
├── SingleLayout (1 device fullscreen)
└── DragResize (kéo thả resize từng ô)
```

---

## 4. Tech Stack chi tiết

### 4.1 Desktop App — **Tauri v2** (khuyến nghị)

```toml
# Tại sao Tauri thay vì Electron?
# - Bundle size: Tauri ~10MB vs Electron ~150MB
# - RAM: Tauri ~50MB vs Electron ~200MB+
# - Native performance với Rust backend
# - WebView2 (Win) / WebKit (Mac/Linux) — không bundle Chromium

[dependencies]
tauri = { version = "2.0", features = ["shell-open"] }
tokio = { version = "1", features = ["full"] }    # Async runtime
serde = { version = "1", features = ["derive"] }   # Serialization
adb-client = "0.x"                                 # ADB protocol
```

```json
// Frontend: React + TypeScript
{
  "dependencies": {
    "react": "^18",
    "typescript": "^5",
    "zustand": "^4",           // State management (nhẹ hơn Redux)
    "@tanstack/react-query": "^5",  // Server state
    "framer-motion": "^11",    // Animations
    "tailwindcss": "^3"        // Styling
  }
}
```

### 4.2 Android Agent App — **Kotlin**

```kotlin
// Công nghệ chính:
// - MediaProjection API: Capture màn hình
// - MediaCodec: Hardware H.264 encoder
// - Foreground Service: Chạy nền liên tục
// - WebSocket (OkHttp): Giao tiếp WiFi
// - ADB mode: Không cần app (dùng scrcpy server)

// build.gradle.kts
dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.java-websocket:Java-WebSocket:1.5.6")
}

// Permission cần thiết:
// FOREGROUND_SERVICE
// MEDIA_PROJECTION (runtime permission)
// INTERNET
```

### 4.3 iOS Mirror — **Swift + ReplayKit**

```swift
// Chỉ mirror (không control được do Apple sandbox)
// Sử dụng:
// - RPSystemBroadcastPickerView: Trigger screen recording
// - ReplayKit broadcast extension: Capture + stream
// - Network framework: Gửi stream qua WebSocket/TCP

// Thay thế không cần app:
// - QuickTime via USB (libimobiledevice)
// - AirPlay via UxPlay (open source)
```

### 4.4 Communication — **Protocol Stack**

```
┌─────────────────────────────────────┐
│         Application Layer           │
│  JSON messages (control commands)   │
│  Binary frames (H.264 video data)   │
├─────────────────────────────────────┤
│         Transport Layer             │
│  USB: ADB forward (port tunneling)  │
│  WiFi: WebSocket (ws://lan-ip:port) │
├─────────────────────────────────────┤
│           Video Codec               │
│  H.264 Baseline Profile             │
│  Resolution: 720p/1080p adaptive    │
│  Bitrate: 2-8 Mbps adaptive         │
│  FPS: 30/60 (cấu hình được)         │
└─────────────────────────────────────┘
```

### 4.5 Video Rendering — **WebCodecs API**

```typescript
// Dùng WebCodecs API (mới, hiệu năng cao)
// Thay thế: Broadway.js (H.264 JS decoder, cũ hơn)

const decoder = new VideoDecoder({
  output: (frame) => {
    ctx.drawImage(frame, 0, 0);
    frame.close();
  },
  error: (e) => console.error(e),
});

decoder.configure({
  codec: 'avc1.42001E',  // H.264 Baseline
  hardwareAcceleration: 'prefer-hardware',
});
```

---

## 5. Cấu trúc thư mục

```
phantom-mirror/
│
├── README.md
├── package.json                    # Workspace root
├── turbo.json                      # Turborepo (monorepo manager)
│
├── apps/
│   ├── desktop/                    # Tauri Desktop App
│   │   ├── src/                    # React frontend
│   │   │   ├── components/
│   │   │   │   ├── layout/
│   │   │   │   │   ├── DeviceGrid.tsx       # Grid nhiều device
│   │   │   │   │   ├── DeviceWindow.tsx     # Một ô device
│   │   │   │   │   ├── TouchOverlay.tsx     # Xử lý mouse → touch
│   │   │   │   │   └── LayoutSwitcher.tsx   # Đổi layout
│   │   │   │   ├── device/
│   │   │   │   │   ├── DeviceCard.tsx       # Card thông tin device
│   │   │   │   │   ├── Devicetoolbar.tsx    # Controls cho device
│   │   │   │   │   └── StreamCanvas.tsx     # Render H.264 stream
│   │   │   │   └── ui/                      # Reusable UI components
│   │   │   ├── stores/
│   │   │   │   ├── deviceStore.ts           # Danh sách devices
│   │   │   │   ├── streamStore.ts           # Stream states
│   │   │   │   └── settingsStore.ts         # App settings
│   │   │   ├── services/
│   │   │   │   ├── adb.service.ts           # Gọi Tauri ADB commands
│   │   │   │   ├── stream.service.ts        # Decode H.264
│   │   │   │   ├── input.service.ts         # Touch/swipe injection
│   │   │   │   └── device.manager.ts        # Quản lý devices
│   │   │   ├── hooks/
│   │   │   │   ├── useDeviceStream.ts
│   │   │   │   ├── useInputCapture.ts
│   │   │   │   └── useDeviceDetection.ts
│   │   │   └── App.tsx
│   │   │
│   │   └── src-tauri/                       # Rust backend
│   │       ├── Cargo.toml
│   │       └── src/
│   │           ├── main.rs
│   │           ├── adb/
│   │           │   ├── mod.rs
│   │           │   ├── client.rs            # ADB client
│   │           │   ├── device.rs            # Device model
│   │           │   └── commands.rs          # Tauri commands
│   │           ├── ios/
│   │           │   ├── mod.rs
│   │           │   └── libimobile.rs        # iOS USB bridge
│   │           └── stream/
│   │               ├── mod.rs
│   │               └── websocket.rs         # WiFi stream server
│   │
│   ├── android-agent/              # Android Kotlin App
│   │   └── app/src/main/
│   │       ├── java/com/phantommirror/
│   │       │   ├── services/
│   │       │   │   ├── ScreenCaptureService.kt   # MediaProjection
│   │       │   │   ├── StreamingService.kt        # H.264 encode + send
│   │       │   │   └── InputReceiver.kt           # Nhận touch events
│   │       │   ├── network/
│   │       │   │   ├── WebSocketClient.kt
│   │       │   │   └── StreamSender.kt
│   │       │   └── MainActivity.kt
│   │       └── AndroidManifest.xml
│   │
│   └── ios-agent/                  # iOS Swift App (optional)
│       └── PhantomMirrorAgent/
│           ├── BroadcastExtension/
│           │   ├── SampleHandler.swift      # ReplayKit capture
│           │   └── StreamSender.swift
│           └── ContentView.swift
│
├── packages/
│   ├── shared-types/               # TypeScript types dùng chung
│   │   └── src/
│   │       ├── device.types.ts
│   │       ├── stream.types.ts
│   │       └── input.types.ts
│   └── protocol/                   # Message protocol definitions
│       └── src/
│           ├── messages.ts
│           └── codec.ts
│
├── tools/
│   ├── scrcpy-server/              # scrcpy server JAR (prebuilt)
│   │   └── scrcpy-server-v3.1.jar
│   └── scripts/
│       ├── setup.sh                # Setup môi trường
│       ├── build-android.sh
│       └── build-desktop.sh
│
└── docs/
    ├── ARCHITECTURE.md
    ├── PROTOCOL.md
    ├── CONTRIBUTING.md
    └── SETUP.md
```

---

## 6. Roadmap phát triển

### Phase 1 — Foundation (Tuần 1-2)
```
[x] Setup monorepo (Turborepo)
[x] Tauri app boilerplate
[x] Tích hợp scrcpy server (dùng JAR có sẵn)
[x] Hiển thị stream 1 Android device
[x] Touch/swipe cơ bản từ PC → Android qua ADB
[x] Basic UI (dark theme, single device view)
```

### Phase 2 — Multi-device (Tuần 3-4)
```
[ ] Auto-detect devices khi cắm USB
[ ] Grid layout (2x2 mặc định)
[ ] Drag-resize từng ô
[ ] Label/rename device
[ ] Screenshot từng device
[ ] Quản lý kết nối (reconnect tự động)
```

### Phase 3 — WiFi & iOS (Tuần 5-6)
```
[ ] WiFi mode cho Android (adb connect + stream)
[ ] iOS USB mirror (libimobiledevice)
[ ] iOS WiFi mirror (tích hợp UxPlay)
[ ] Auto-discovery thiết bị cùng LAN (mDNS)
[ ] Settings panel (resolution, FPS, bitrate)
```

### Phase 4 — Advanced (Tuần 7-10)
```
[ ] Android Extended Display (Virtual Display API)
[ ] Layout presets (save/load cấu hình)
[ ] Recording từng device hoặc toàn màn hình
[ ] Keyboard shortcut mapping
[ ] File transfer (kéo thả file vào cửa sổ device)
[ ] Clipboard sync (PC ↔ Android)
```

---

## 7. Setup môi trường

### 7.1 Prerequisites

```bash
# Node.js 20+
node --version   # v20.x.x

# Rust (cho Tauri)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup update stable

# Android SDK + ADB
# Cài Android Studio hoặc standalone SDK tools
adb version      # Android Debug Bridge version 1.0.41

# (macOS/Linux) libimobiledevice cho iOS
# Ubuntu/Debian:
sudo apt install libimobiledevice-utils ifuse
# macOS:
brew install libimobiledevice

# Tauri CLI
cargo install tauri-cli --version "^2.0"
```

### 7.2 Khởi tạo dự án

```bash
# Clone hoặc tạo mới
mkdir phantom-mirror && cd phantom-mirror

# Init monorepo
npm init -y
npx create-turbo@latest

# Tạo Tauri app
cd apps
npm create tauri-app@latest desktop -- --template react-ts

# Install dependencies
cd desktop
npm install zustand @tanstack/react-query framer-motion
npm install -D tailwindcss @tauri-apps/cli

# Init Tailwind
npx tailwindcss init -p
```

### 7.3 Cấu hình ADB

```bash
# Trên điện thoại Android:
# 1. Bật Developer Options: Settings > About > Tap "Build number" 7 lần
# 2. Bật USB Debugging: Developer Options > USB Debugging

# Kiểm tra kết nối
adb devices
# List of devices attached
# R3CN90XXXXX    device

# Cho phép ADB qua WiFi (Android 11+)
# Settings > Developer Options > Wireless Debugging > Pair device

# Kết nối WiFi
adb connect 192.168.1.100:5555
```

### 7.4 Download scrcpy server

```bash
# Tải scrcpy server JAR (không cần cài scrcpy đầy đủ)
mkdir -p tools/scrcpy-server
wget https://github.com/Genymobile/scrcpy/releases/download/v3.1/scrcpy-server-v3.1 \
  -O tools/scrcpy-server/scrcpy-server.jar

# Deploy lên device và start
adb push tools/scrcpy-server/scrcpy-server.jar /data/local/tmp/scrcpy-server.jar
adb shell CLASSPATH=/data/local/tmp/scrcpy-server.jar \
  app_process / com.genymobile.scrcpy.Server 3.1 \
  tunnel_forward=true video_codec=h264 max_size=1080
```

### 7.5 Chạy development

```bash
# Terminal 1: Start Tauri dev
cd apps/desktop
npm run tauri dev

# Terminal 2: Build Android agent (nếu dùng WiFi mode)
cd apps/android-agent
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

---

## 8. Prompts tạo dự án

> Copy các prompt sau vào Claude Code, Cursor, Windsurf, hoặc bất kỳ AI coding assistant nào

---

### 🔵 PROMPT 1 — Khởi tạo toàn bộ dự án

```
Tôi muốn xây dựng một desktop app tên "PhantomMirror" để phản chiếu màn hình
điện thoại Android/iOS lên laptop/PC với các tính năng:

1. Mirror nhiều thiết bị Android cùng lúc (tiling layout)
2. Điều khiển touch/swipe/keyboard từ PC xuống Android qua ADB
3. Mirror iOS qua AirPlay (chỉ xem, không điều khiển)
4. Kết nối qua USB và WiFi LAN
5. Giao diện dark theme, grid layout có thể kéo-thả resize

Tech stack:
- Desktop: Tauri v2 (Rust backend) + React 18 + TypeScript
- State: Zustand
- Styling: Tailwind CSS + Framer Motion
- Video decode: WebCodecs API
- Video codec: H.264 từ scrcpy server
- Communication: ADB (USB) + WebSocket (WiFi)

Hãy tạo:
1. Cấu trúc thư mục đầy đủ cho monorepo (Turborepo)
2. Tauri app với cấu hình cơ bản
3. React component DeviceGrid.tsx để hiển thị grid layout
4. React component StreamCanvas.tsx để decode và render H.264 stream bằng WebCodecs API
5. Service adb.service.ts để giao tiếp với Tauri backend
6. Rust module trong src-tauri/src/adb/ để:
   - List connected ADB devices
   - Start scrcpy server trên device
   - Forward ADB port
   - Send touch/swipe events

Sử dụng WebCodecs API để decode H.264 với hardware acceleration.
```

---

### 🔵 PROMPT 2 — ADB Service (Rust)

```
Tạo Rust module cho Tauri app để quản lý ADB connections với các chức năng:

1. Struct Device { id, serial, model, resolution, connected_via: USB|WiFi }
2. async fn list_devices() -> Vec<Device>
   - Chạy "adb devices -l" và parse output
   - Detect model name từ "adb -s {serial} shell getprop ro.product.model"
   - Detect resolution từ "adb -s {serial} shell wm size"

3. async fn start_scrcpy_server(serial: &str) -> Result<u16>
   - Push scrcpy-server.jar lên device nếu chưa có
   - Start server với params: video_codec=h264, max_size=1080, tunnel_forward=true
   - Tạo ADB forward: adb forward tcp:{local_port} localabstract:scrcpy
   - Return local_port để frontend connect

4. async fn send_touch(serial: &str, x: f32, y: f32, action: TouchAction)
   - action: Down | Up | Move
   - Dùng "adb shell input tap {x} {y}" hoặc inject qua scrcpy protocol

5. async fn send_swipe(serial: &str, x1: f32, y1: f32, x2: f32, y2: f32, duration_ms: u32)

6. Tauri commands expose các function trên cho frontend

Error handling đầy đủ, async với tokio.
```

---

### 🔵 PROMPT 3 — Multi-device Grid UI

```
Tạo React component PhantomMirrorApp với layout quản lý nhiều device:

Components cần tạo:

1. DeviceGrid.tsx
   - Hiển thị danh sách devices trong grid layout
   - Layouts: 1x1, 2x2, 3x3, 2+1 (1 main + sidebar), custom
   - Mỗi ô có thể drag để đổi chỗ (dùng @dnd-kit/core)
   - Resize từng ô bằng cách kéo border

2. DeviceWindow.tsx (props: device: Device, stream: MediaStream)
   - StreamCanvas: render H.264 video
   - TouchOverlay: capture mouse events, convert sang device coordinates
   - Toolbar: screenshot, rotate, fullscreen, disconnect buttons
   - Header: device name, FPS counter, latency indicator

3. TouchOverlay.tsx
   - Capture: click (→ tap), drag (→ swipe), scroll (→ scroll)
   - Convert mouse coordinates → device coordinates (tính theo tỉ lệ)
   - Gọi adb.service.sendTouch() / sendSwipe()
   - Visual feedback: ripple effect tại điểm touch

4. StreamCanvas.tsx (props: port: number)
   - Kết nối WebSocket đến scrcpy server trên port đã forward
   - Dùng WebCodecs VideoDecoder để decode H.264
   - Render frame lên <canvas> bằng drawImage
   - Hiển thị FPS và bitrate realtime

5. DeviceManager sidebar
   - Hiển thị tất cả connected devices
   - Add device (scan USB, enter WiFi IP)
   - Remove device
   - Device info (model, Android version, battery)

Dark theme, dùng CSS variables, smooth animations.
```

---

### 🔵 PROMPT 4 — WebCodecs H.264 Decoder

```
Tạo TypeScript class H264Decoder để decode H.264 stream từ scrcpy server:

class H264Decoder {
  private decoder: VideoDecoder
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private ws: WebSocket
  private frameCount: number = 0
  private lastFpsTime: number = 0
  public fps: number = 0

  constructor(canvas: HTMLCanvasElement, wsPort: number)

  async connect(): Promise<void>
  // - Mở WebSocket đến ws://localhost:{wsPort}
  // - Parse scrcpy binary protocol:
  //   * 12 bytes header đầu tiên: device name
  //   * 8 bytes meta: width, height
  //   * Sau đó là các video packets

  private processPacket(data: ArrayBuffer): void
  // - Parse scrcpy packet header (pts, size)
  // - Detect SPS/PPS NAL units (dùng để configure decoder)
  // - Enqueue EncodedVideoChunk vào VideoDecoder

  private setupDecoder(): void
  // - VideoDecoder config: codec='avc1.42001E', hardwareAcceleration='prefer-hardware'
  // - Output callback: drawImage frame lên canvas, update FPS counter

  disconnect(): void
  getStats(): { fps: number, latency: number, resolution: {w,h} }
}

Xử lý reconnect tự động khi mất kết nối.
Emit events: 'connected', 'disconnected', 'frame', 'error'.
```

---

### 🔵 PROMPT 5 — iOS Mirror (AirPlay)

```
Tích hợp UxPlay vào Tauri app để nhận AirPlay stream từ iOS:

1. Rust module src-tauri/src/ios/airplay.rs:
   - Wrap UxPlay binary (prebuilt) hoặc compile từ source
   - Start UxPlay server: uxplay -n "PhantomMirror" -p {port}
   - UxPlay sẽ tạo RTSP stream tại rtsp://localhost:{port}/

2. Tauri commands:
   - start_airplay_receiver(device_name: &str) -> Result<u16> (returns RTSP port)
   - stop_airplay_receiver()
   - list_airplay_devices() -> Vec<AirPlayDevice>

3. Frontend RTSPPlayer.tsx:
   - Nhận RTSP URL từ backend
   - Dùng ffmpeg.wasm hoặc hls.js để play stream
   - Hoặc: Tauri backend convert RTSP → WebSocket H.264 → frontend decode

4. Hướng dẫn user trên iOS:
   - Control Center → Screen Mirroring → Chọn "PhantomMirror"

Note: iOS không cho phép inject touch từ bên ngoài, nên đây là view-only.
Thêm visual indicator "View Only" cho iOS devices.
```

---

### 🔵 PROMPT 6 — Android Extended Display

```
Tạo tính năng "Extended Display" để dùng Android/tablet làm màn hình thứ 2:

Android Agent (Kotlin):
1. ExtendedDisplayService.kt
   - Dùng Presentation class để render nội dung lên màn hình thứ 2
   - Nhận display content từ PC qua WebSocket
   - Render: video, image, web content (WebView)

2. VirtualDisplayManager.kt  
   - Tạo VirtualDisplay qua DisplayManager
   - Stream VirtualDisplay content về PC (như screen capture bình thường)
   - PC có thể render app window lên đây

Desktop (Tauri + React):
3. ExtendedDisplayWindow.tsx
   - Cửa sổ riêng biệt, drag được ra màn hình thứ 2
   - Content render ở đây sẽ được stream sang Android/tablet
   - Ví dụ: mở video player, browser, document viewer ở đây

4. Rust backend:
   - Tạo Tauri window thứ 2 (secondary window)
   - Capture content của window thứ 2
   - Stream H.264 về Android agent qua WebSocket

Setup flow:
1. User chọn device → "Use as Extended Display"
2. Android app bật VirtualDisplay mode  
3. PC tạo secondary window
4. Stream content 2 chiều được thiết lập
```

---

### 🔵 PROMPT 7 — Settings & Polish

```
Thêm Settings panel và các tính năng hoàn thiện cho PhantomMirror:

1. SettingsPanel.tsx với các tùy chọn:
   Streaming:
   - Video quality: 480p / 720p / 1080p / Native
   - FPS: 30 / 60
   - Bitrate: 2/4/8 Mbps (auto adaptive)
   - H.265 support (nếu device hỗ trợ)
   
   Interface:
   - Default layout: 1x1, 2x2, focus mode
   - Theme: Dark / Light / System
   - Hotkeys configuration
   
   Connection:
   - WiFi scan range (subnet)
   - Auto-reconnect: on/off
   - USB polling interval

2. Global Hotkeys (Rust - tauri-plugin-global-shortcut):
   - Ctrl+1/2/3: Switch layout
   - Ctrl+F: Fullscreen focused device
   - Ctrl+S: Screenshot tất cả devices
   - Ctrl+R: Rotate device
   - Ctrl+W: Disconnect selected device

3. Screenshot & Recording:
   - Screenshot từng device → save PNG
   - Record stream → save MP4 (dùng ffmpeg)
   - Timestamp trong tên file

4. Device Profiles:
   - Save layout configuration (vị trí, size từng device)
   - Load lại khi cắm cùng bộ devices
   - Export/Import profile

5. Performance Monitor:
   - FPS counter mỗi device
   - Latency (ping đến device)
   - CPU/RAM usage của app
   - Network bandwidth

Tất cả settings persist qua tauri-plugin-store.
```

---

## 9. Rủi ro & Giải pháp

| Rủi ro | Mức độ | Giải pháp |
|---|---|---|
| iOS không cho control | Cao | Chấp nhận view-only, document rõ |
| scrcpy server update | Thấp | Pin version, test kỹ trước upgrade |
| Latency WiFi cao | Trung bình | Adaptive bitrate, khuyến nghị USB |
| Apple thay đổi AirPlay | Trung bình | Fallback sang QuickTime USB |
| Extended display Android khó | Cao | Làm sau (Phase 4), core không phụ thuộc |
| libimobiledevice không stable | Trung bình | Fallback QuickTime, test nhiều iOS version |

---

## 📚 Tài nguyên tham khảo

```
scrcpy (core inspiration):
  https://github.com/Genymobile/scrcpy

UxPlay (AirPlay receiver):
  https://github.com/FDH2/UxPlay

libimobiledevice (iOS USB):
  https://libimobiledevice.org

WebCodecs API (H.264 decode):
  https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API

Tauri v2 docs:
  https://v2.tauri.app

Android MediaProjection API:
  https://developer.android.com/media/grow/media-projection

scrcpy protocol documentation:
  https://github.com/Genymobile/scrcpy/blob/master/DEVELOP.md
```

---

*Tài liệu này được tạo ngày 2026-06-08. Cập nhật khi có thay đổi kiến trúc.*
