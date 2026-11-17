# irvis

An open-source viewer for USB-C thermal cameras: a desktop app for macOS, Windows and Linux, and an experimental web version for Chrome, Edge and Safari, sharing one TypeScript core and one UI. It shows live temperatures with palettes, measurements and alarms, saves photos, and records `.irvis` files that it plays back and exports as MP4 ([viewer](docs/features/ui-user.md), [recordings](docs/features/media-user.md)). Work in progress.

## Supported cameras

- **TOOLTOP T7**, a rebrand of the InfiRay P2 Pro (USB `0x0bda:0x5830` or `0x0bda:0x5840`): temperatures in high and low gain; in the desktop app also gain switching and the camera's own emissivity, reflected temperature, ambient temperature and atmospheric transmittance. Tested on macOS; Linux and Windows are not yet tested with the camera.

The TOPDON TC001 reports the same USB ID (`0x0bda:0x5830`) but has no profile of its own and has not been tested. What works with each camera and how a new model is added: [cameras](docs/features/cameras-user.md#supported-cameras).

## Desktop app

Each version's packages are attached to its release on [GitHub Releases](https://github.com/mateuszsikora/irvis/releases), together with the sources of the LGPL ffmpeg and libusb that each package carries. No release is published yet. The packages are unsigned:

| System | Packages |
| --- | --- |
| macOS 13 or later, Apple silicon or Intel | dmg |
| Windows 10 or later, x64 | installer or zip |
| Linux, x64 | deb or AppImage |

How to install them and get past the warnings for unsigned apps: [install a package](docs/features/desktop-user.md#install-a-package). On Linux, the deb installs the udev rule that lets you send camera commands without root. With the AppImage (which needs FUSE 2 or `APPIMAGE_EXTRACT_AND_RUN=1`, and on Ubuntu 24.04 may need `--no-sandbox`: [details](docs/features/desktop-user.md#install-a-package)), install it yourself and plug the camera in again:

```sh
./irvis-<version>-linux-x86_64.AppImage --appimage-extract resources/60-irvis.rules
sudo install -m 644 squashfs-root/resources/60-irvis.rules /etc/udev/rules.d/60-irvis.rules
sudo udevadm control --reload-rules
rm -r squashfs-root
```

If a package has no ffmpeg, or you want another one, start irvis with `IRVIS_FFMPEG` set to an ffmpeg executable: [instructions](docs/features/desktop-user.md#use-your-own-ffmpeg).

## Web version

The web version runs in desktop Chrome, Edge and Safari:

| Browser | Minimum version |
| --- | --- |
| Chrome or Edge, on macOS, Windows or Linux | 111 |
| Safari, on macOS | 18 |
| Firefox | not supported |
| Browsers on iPhone, iPad or Android | not supported |

Tested in Chrome 157 and Safari 27.0.1 on macOS; the minimum versions come from browser compatibility data. Even in a supported browser, temperatures are rebuilt from the browser's video frames instead of read exactly, readings assume high gain until you declare the camera mode, and camera commands are available only in the desktop app. Why these versions, and the features that need newer ones (MP4 export with audio in Safari needs 26): [supported browsers](docs/features/web-app-user.md#supported-browsers).

Open it at [no-plan.dev/irvis](https://no-plan.dev/irvis/), which GitHub Pages publishes from the latest release ([details](docs/features/web-app-user.md#open-the-web-version)). Before the first release the site does not exist yet; [run it locally](docs/features/web-app-user.md#run-it-locally) instead.

## Documentation

- What is planned and in which order: [roadmap](docs/roadmap.md)
- Every document and where it lives: [docs/README.md](docs/README.md)
- Setup, build targets and CI: [development guide](docs/guides/development.md)
- How changes reach `main`: [CONTRIBUTING.md](CONTRIBUTING.md)
- Bugs and feature requests: [issues](https://github.com/mateuszsikora/irvis/issues/new/choose); vulnerabilities: [security policy](.github/SECURITY.md), never a public issue

Licence: [MIT](LICENSE). Third-party material: [NOTICE](NOTICE).
