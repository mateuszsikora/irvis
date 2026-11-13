# Web app

`apps/web` is the one UI build of irvis: Netlify serves it as the web version, and the desktop app will load the same files. Today it is a placeholder page that shows the app is built and deployed: it names the app and lists the cameras that core supports. The viewer replaces it in #17.

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

- The heading `irvis` and the line `A viewer for USB-C thermal cameras. Work in progress.`
- While no camera profile is registered: `No camera is supported yet.`
- Otherwise: `Supported cameras:` and a list of their names.

## See also

- [Web app: technical](web-app-technical.md)
- [Cameras](cameras-user.md)
