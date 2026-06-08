$ErrorActionPreference = "Stop"

$ProjectDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$SrcDir = Join-Path $env:TEMP "uxplay-src"
$OutDir = Join-Path $ProjectDir "tools\uxplay\win32-x64"
$VcpkgRoot = if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { Join-Path $ProjectDir "vcpkg" }
$Toolchain = Join-Path $VcpkgRoot "scripts\buildsystems\vcpkg.cmake"

if (!(Test-Path $Toolchain)) {
  throw "vcpkg toolchain not found at $Toolchain. Set VCPKG_ROOT or install vcpkg in the project root."
}

if (Test-Path $SrcDir) {
  Remove-Item -Recurse -Force $SrcDir
}

git clone https://github.com/FDH2/UxPlay $SrcDir
& vcpkg install openssl plist mdns gstreamer
cmake -S $SrcDir -B (Join-Path $SrcDir "build") `
  -DNO_DISPLAY=1 `
  -DSTANDALONE=1 `
  -DCMAKE_BUILD_TYPE=Release `
  -DCMAKE_TOOLCHAIN_FILE=$Toolchain
cmake --build (Join-Path $SrcDir "build") --config Release

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Built = Get-ChildItem -Path (Join-Path $SrcDir "build") -Recurse -Filter uxplay.exe | Select-Object -First 1
if (!$Built) {
  throw "uxplay.exe was not produced by the build."
}
Copy-Item $Built.FullName (Join-Path $OutDir "uxplay.exe") -Force
Write-Host "UxPlay headless saved to $(Join-Path $OutDir 'uxplay.exe')"
