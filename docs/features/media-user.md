# Recording and video export

The viewer saves temperature recordings as `.irvis` files. They can be reopened for measurements or exported as ordinary MP4 video.

## Record a clip

Start the camera or Demo, then select **Check recording storage**. Read the storage notice before choosing **Record .irvis**. The threshold defaults to the profile's first conversion; 0 stores lossless temperatures. Stop recording to finalize the file and save a copy through a destination picker or download. The elapsed counter shows seconds since recording started. Slow storage can cause dropped frames; their host receipt timestamps keep the clip's timing. Each accepted frame is flushed before another is accepted; a write taking more than one second stops recording with an error. After a crash, recover the flushed prefix from the gallery (normally losing less than one second). The memory-only fallback cannot survive closing the page.

The recording list includes files left by an earlier session. Open an unfinished file to recover its complete frames. Empty or damaged files report an error. Download backups; browser storage can be cleared or evicted. Without OPFS, a notice explains that recordings remain in memory and closing the page loses them.

## Include microphone audio

Microphone is Off by default. Enable it before recording; the browser asks for permission when recording starts. Denial reports an error. Stop releases the microphone. Audio is kept beside the recording; **Download audio sidecar** saves a backup of it. MP4 includes audio when the sidecar is available locally. Opening a downloaded `.irvis` alone does not restore its audio. This path requires AudioWorklet support. Audio packets and thermal frames share a host clock; export removes audio before the first frame, preserves gaps and ends audio with the video. Output is AAC mono at 44.1 kHz. The app does not calibrate physical camera/microphone acquisition latency. See the [audio sidecar format](../audio-sidecar-format.md) for raw storage and timing details.

Enable **Export MP4 after recording** to export automatically after finalization. Cancelling a save does not remove the local clip.

## Play and export

Use **Open recording** for an external `.irvis` file, or **Open** beside a saved recording. Play, pause, seek and choose 0.25×–4× speed. Change palettes and measurements with the viewer controls.

**Download .irvis** copies the original recording. Where the browser supports a save picker it asks for a destination; otherwise it downloads a file. **Export MP4** uses recorded appearance by default. Turn that option off to use the current palette, range, units and overlays. Choose 1×, 2× or 4× enlargement and optional smoothing. Export needs WebCodecs H.264 encoding support and sufficient memory for the resulting file. The MP4 has no temperature data.

**Delete recording** removes the local recording, not downloaded copies. Errors retain the list entry. A recording currently being played may become unreadable if its backing desktop file is deleted.

## See also

- [Viewer](ui-user.md)
- [Media implementation](media-technical.md)
