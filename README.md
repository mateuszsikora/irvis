# irvis

An open-source viewer for USB-C thermal cameras: a desktop app for macOS, Windows and Linux, and an experimental web version, sharing one TypeScript core and one UI. Work in progress: the repository has the toolchain, the core types and YUYV decoders, the camera registry with its first profile, the TOOLTOP T7 (InfiRay P2 Pro), a capture tool for the hardware spikes and a placeholder web page.

- What is planned and in which order: [roadmap](docs/roadmap.md)
- Every document and where it lives: [docs/README.md](docs/README.md)
- Setup, build targets and CI: [development guide](docs/guides/development.md)
- How changes reach `main`: [CONTRIBUTING.md](CONTRIBUTING.md)

## Desktop packages

The desktop app is packaged for macOS (dmg), Windows (installer and zip) and Linux (AppImage and deb), unsigned, with its own LGPL ffmpeg: [how to install them](docs/features/desktop-user.md#install-a-package). On Linux, the deb installs the udev rule that lets you send camera commands without root. With the AppImage, install it yourself and plug the camera in again:

```sh
./irvis-<version>-linux-x86_64.AppImage --appimage-extract resources/60-irvis.rules
sudo install -m 644 squashfs-root/resources/60-irvis.rules /etc/udev/rules.d/60-irvis.rules
sudo udevadm control --reload-rules
```

If a package has no ffmpeg, or you want another one, start irvis with `IRVIS_FFMPEG` set to an ffmpeg executable: [instructions](docs/features/desktop-user.md#use-your-own-ffmpeg).

Licence: [MIT](LICENSE). Third-party material: [NOTICE](NOTICE).
