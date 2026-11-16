# Web app

`apps/web` is the one UI build of irvis: Netlify serves it as the web version, and the desktop app loads the same files. It provides a thermal viewer with synthetic demo and live capture, supported camera profiles, and experimental browser diagnostics.

## Open the web version

- **Production:** the Netlify site, published from the `release` branch. It changes only when someone runs "Promote to release" ([development guide](../guides/development.md#promote-to-release)). TODO(owner): add the site URL once the repository is connected to Netlify.
- **Deploy preview:** Netlify builds every pull request and links the preview in the pull request's checks.

## Run it locally

```sh
npm ci
npm run dev --workspace @irvis/web
```

Vite prints the local address (by default `http://localhost:5173/`) and reloads the page on every change. `npm run build --workspace @irvis/web` writes the production build to `apps/web/dist/`, and `npm run preview --workspace @irvis/web` serves that build.

## What the page shows

- The heading `irvis`, Thermal studio, and source/profile controls.
- While no camera profile is registered: `No camera is supported yet.`
- Registered cameras appear in Camera profile.

## Inspect browser capture

The panel is included in the regular web build and Netlify deployments, not limited to the local spike command.

The **Browser diagnostics — M3** panel inspects camera frames and exports evidence. See [Browser diagnostics](backend-browser-user.md) for camera selection, controls and limitations.

## See also

- [Web app: technical](web-app-technical.md)
- [Cameras](cameras-user.md)

## View thermal images

The home page now offers Demo or Live camera, camera profile selection and the shared [thermal viewer](ui-user.md). Demo needs no camera. Changing Source or Camera profile clears the previous capture error; late errors from the old selection do not appear in the new view. Expand Capture diagnostics to use the existing diagnostic tools after stopping the viewer.

## Recognize the app

The full header logo pairs dark `ir` on amber with light `vis` directly on the app background; narrow screens use the compact amber `ir` mark. The browser tab also uses the compact `ir` mark. Both identify the same app.
