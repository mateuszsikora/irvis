#!/usr/bin/env bash
# Builds the minimal LGPL ffmpeg that the desktop packages ship: the camera
# input of one system (AVFoundation, V4L2 or DirectShow), rawvideo to a pipe,
# no codecs and no --enable-gpl. Why and how it is checked:
# docs/features/desktop-technical.md#bundled-ffmpeg
#
#   apps/desktop/ffmpeg/build.sh [mac-arm64|mac-x64|linux-x64|win-x64|source]
#
# The target defaults to the host. mac-x64 cross-compiles on an arm64 Mac.
# Windows builds run in an MSYS2 UCRT64 shell, or cross-compile from Linux
# with mingw-w64. The result goes to
# apps/desktop/ffmpeg/dist/<target>/; the verified source tarball stays in
# apps/desktop/ffmpeg/dist/ for the GitHub Release.
set -euo pipefail

FFMPEG_VERSION=9.0.2
FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
MACOS_MIN=12.0

here="$(cd "$(dirname "$0")" && pwd)"
dist="$here/dist"

host_target() {
  local arch
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x64 ;;
    *) echo "unsupported architecture: $(uname -m)" >&2 && exit 1 ;;
  esac
  case "$(uname -s)" in
    Darwin) echo "mac-$arch" ;;
    Linux) echo "linux-$arch" ;;
    MINGW* | MSYS* | UCRT* | CLANG*) echo "win-$arch" ;;
    *) echo "unsupported system: $(uname -s)" >&2 && exit 1 ;;
  esac
}

target="${1:-$(host_target)}"
case "$target" in
  mac-arm64 | mac-x64 | linux-x64 | win-x64 | source) ;;
  *)
    echo "unknown target: $target (mac-arm64, mac-x64, linux-x64, win-x64 or source)" >&2
    exit 1
    ;;
esac

sha256() {
  if command -v sha256sum > /dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

mkdir -p "$dist"
tarball="$dist/ffmpeg-${FFMPEG_VERSION}.tar.xz"
if [ ! -f "$tarball" ] || [ "$(sha256 "$tarball")" != "$FFMPEG_SHA256" ]; then
  echo "downloading $FFMPEG_URL"
  curl --fail --location --silent --show-error --retry 3 --output "$tarball.part" "$FFMPEG_URL"
  mv "$tarball.part" "$tarball"
fi
actual="$(sha256 "$tarball")"
if [ "$actual" != "$FFMPEG_SHA256" ]; then
  echo "ffmpeg-${FFMPEG_VERSION}.tar.xz has SHA-256 $actual, expected $FFMPEG_SHA256" >&2
  exit 1
fi

# `source` only downloads and checks the tarball, for the release.
[ "$target" = source ] && echo "verified $tarball" && exit 0

flags=(
  --disable-everything
  --disable-autodetect
  --disable-doc
  --disable-debug
  --disable-network
  --disable-ffplay
  --disable-ffprobe
  --disable-swresample
  --disable-swscale
  --disable-x86asm
  --enable-protocol=pipe
  --enable-demuxer=rawvideo
  --enable-decoder=rawvideo
  --enable-encoder=rawvideo
  --enable-muxer=rawvideo
)
case "$target" in
  mac-arm64 | mac-x64)
    arch="${target#mac-}"
    [ "$arch" = x64 ] && arch=x86_64
    flags+=(
      --enable-pthreads
      --enable-avfoundation
      --enable-indev=avfoundation
      --enable-cross-compile
      --target-os=darwin
      --arch="$arch"
      --extra-cflags="-arch $arch -mmacosx-version-min=$MACOS_MIN"
      --extra-objcflags="-arch $arch -mmacosx-version-min=$MACOS_MIN"
      --extra-ldflags="-arch $arch -mmacosx-version-min=$MACOS_MIN"
    )
    exe=ffmpeg
    ;;
  linux-x64)
    # Static, so the binary runs on any glibc; network is disabled, so the
    # static glibc never needs NSS.
    flags+=(--enable-pthreads --enable-indev=v4l2 --extra-ldflags=-static)
    exe=ffmpeg
    ;;
  win-x64)
    flags+=(--enable-w32threads --enable-indev=dshow --extra-ldflags=-static)
    # From Linux, cross-compile with mingw-w64 (x86_64-w64-mingw32-gcc).
    if [ "$(uname -s)" = Linux ]; then
      flags+=(--enable-cross-compile --target-os=mingw32 --arch=x86_64
        --cross-prefix=x86_64-w64-mingw32-)
    fi
    exe=ffmpeg.exe
    ;;
esac

work="$dist/build/$target"
rm -rf "$work"
mkdir -p "$work"
tar -xJf "$tarball" -C "$work"
src="$work/ffmpeg-${FFMPEG_VERSION}"

jobs="$(getconf _NPROCESSORS_ONLN 2> /dev/null || echo 2)"
(cd "$src" && ./configure "${flags[@]}" && make -j"$jobs" "$exe")

out="$dist/$target"
rm -rf "$out"
mkdir -p "$out"
cp "$src/$exe" "$out/$exe"
cp "$src/COPYING.LGPLv2.1" "$out/COPYING.LGPLv2.1"
{
  echo "ffmpeg ${FFMPEG_VERSION} for irvis ($target)"
  echo
  echo "This ffmpeg is licensed under the GNU Lesser General Public License,"
  echo "version 2.1 or later; the licence text is in COPYING.LGPLv2.1. It is an"
  echo "unmodified FFmpeg release (https://ffmpeg.org), built without GPL or"
  echo "nonfree parts and without codecs, by apps/desktop/ffmpeg/build.sh in"
  echo "https://github.com/mateuszsikora/irvis."
  echo
  echo "Source: ${FFMPEG_URL}"
  echo "SHA-256: ${FFMPEG_SHA256}"
  echo "This tarball and build.sh are published with each irvis release:"
  echo "https://github.com/mateuszsikora/irvis/releases"
  echo
  echo "configure arguments:"
  printf '  %s\n' "${flags[@]}"
} > "$out/README.txt"
rm -rf "$work"
echo "built $out/$exe"
