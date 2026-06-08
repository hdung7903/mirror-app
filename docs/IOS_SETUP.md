# iOS AirPlay Setup

PhantomMirror uses a headless UxPlay runtime for iOS mirroring. The receiver is started by the Tauri backend, UxPlay emits RTP video to localhost, and PhantomMirror bridges that RTP stream into the app canvas over WebSocket.

## Install UxPlay Runtime

Preferred layout:

```text
tools/uxplay/linux-x64/uxplay
tools/uxplay/linux-arm64/uxplay
tools/uxplay/darwin-x64/uxplay
tools/uxplay/darwin-arm64/uxplay
tools/uxplay/win32-x64/uxplay.exe
```

Try a prebuilt download first:

```bash
node tools/scripts/download-uxplay-prebuilt.mjs
```

If no matching prebuilt exists, build from source:

```bash
bash tools/scripts/build-uxplay.sh
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File tools/scripts/build-uxplay.ps1
```

PhantomMirror also checks `PATH` for `uxplay` or `uxplay.exe`.

## Run

1. Open PhantomMirror.
2. Go to the iOS tab.
3. Confirm UxPlay status shows installed.
4. Choose quality:
   - Balanced: 1080p30 H.264
   - High: 1080p60 H.264
   - 4K H.265
5. Click `Start AirPlay Receiver`.
6. On iPhone: Control Center -> Screen Mirroring -> PhantomMirror.

## Network

The iPhone and PC must be on the same LAN. A PC connected by Ethernet works as long as the iPhone Wi-Fi is on the same router/subnet. Avoid guest Wi-Fi or AP/client isolation.

Windows Firewall or distro firewalls must allow PhantomMirror and UxPlay inbound traffic on private networks.

## Troubleshooting

- iPhone cannot see PhantomMirror: check same subnet, disable guest Wi-Fi isolation, allow firewall prompts, and make sure mDNS/Bonjour traffic is not blocked.
- Receiver starts but no video in app: verify UxPlay was built headless and supports `-vrtp`; avoid the old `uxplay-windows.exe` GUI package.
- 4K does not decode: switch to High 1080p60. H.265 requires iPhone support plus WebCodecs HEVC support in the desktop WebView.
- Missing dependencies when building: install CMake, Git, GStreamer, OpenSSL, plist/libplist, and mDNS/Bonjour development packages for your OS.
