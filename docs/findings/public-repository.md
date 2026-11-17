# Audit before the repository goes public

Report of the audit for [#26](https://github.com/mateuszsikora/irvis/issues/26), made on 17 November 2026 on `main` at `a59ebfb`. It records what was checked and found then; it does not describe the code, and later changes do not update it.

## What becomes public

Switching the visibility publishes more than `main`: every ref on GitHub, including `refs/pull/<n>/head` of every pull request (the original commits of squash-merged branches, which the owner cannot delete), the issues, pull requests and their comments, the logs of the Actions runs (kept for 90 days) and the artifacts that have not expired (14 days). Local refs of the owner's clones are not published.

The audit covered all of it: a mirror clone of the repository (`git clone --mirror`, 32 refs, 82 commits), 25 issues, 30 pull requests with their comments and reviews, and the logs of all 85 Actions runs.

## Secrets

| Scanned | Tool | Result |
| --- | --- | --- |
| Every commit reachable from any ref of the mirror | gitleaks 8.30.1 (`gitleaks git --log-opts=--all`), trufflehog 3.99.9 (`trufflehog git`) | no findings |
| Issues, pull requests, comments and reviews, exported with `gh` as JSON | gitleaks (`gitleaks dir`), trufflehog (`trufflehog filesystem`) | no findings |
| Logs of the 85 Actions runs | gitleaks, trufflehog | no findings |

The repository has no Actions secrets, variables, environments, deploy keys or webhooks, and no GitHub Release.

## Files and personal data

- **Large files:** none. The largest blobs in the history are `package-lock.json` (249 KB), the static-wall fixture `lossless-v1.irvis` (82 KB) and `docs/decisions/architecture.md` (72 KB).
- **Images and media:** none in the history apart from the gzipped YUYV frames and the `.irvis` file of `fixtures/infiray-p2pro/static-wall/`, which hold a thermal image of a wall. Their gzip headers carry no file name or time, and the `.irvis` metadata holds only the camera profile and conversion. The Android audit captures stayed out of git and out of GitHub attachments, as [decided](../decisions/docs.md#android-audit-captures-remain-private); no issue or pull request has an attachment.
- **E-mail addresses:** all 82 commits carry the owner's personal address as author, and the squash merges made on GitHub carry it too; the committer of those is `GitHub <noreply@github.com>`. No commit has a trailer with an address. Rewriting `main` would not remove the address, because the `refs/pull/*` refs keep the original commits. The files hold only the owner's `users.noreply.github.com` address (the deb maintainer in `apps/desktop/electron-builder.config.mjs`) and `test@example.invalid` in tests.
- **Local paths:** `docs/findings/irvis-codec.md`, `fixtures/infiray-p2pro/static-wall/README.md` and one pull request description name the capture directory `/Users/mateuszsikora/irvis-captures/m1-scenes-1794808411555/`. The user name in it is the owner's GitHub login; left as it is.
- **Runner:** the logs of the self-hosted runs name the runner `hp600g1` and its work directory under `/home/ms`. Nothing else about the machine or the network appears.

## Licences

The project is MIT (`LICENSE`). The lockfile holds 513 third-party packages; all have a licence field. The development tools are under MIT, ISC, Apache-2.0, BSD, BlueOak-1.0.0, MPL-2.0 (lightningcss), Python-2.0 (argparse) and WTFPL or a choice including it; none of them ships.

What ships, and what was missing:

| Shipped in | Third-party code | Licence | Before #26 |
| --- | --- | --- | --- |
| web build, desktop `resources/web/` | react, react-dom, scheduler, fflate | MIT | the minified bundle kept no licence comment; no notice shipped |
| web build, desktop `resources/web/` | mediabunny | MPL-2.0 | no notice and no pointer to its source |
| desktop `main.cjs` | fflate | MIT | as above |
| desktop `app.asar` | node-usb (`usb`) | MIT | its `LICENSE` shipped |
| desktop node-usb prebuild | libusb 1.0.30, linked statically (`use_system_libusb` is `false` in node-usb's `binding.gyp`) | LGPL-2.1-or-later | the package filter dropped `libusb/`, so neither the licence nor the source shipped |
| desktop packages | Electron, Chromium | MIT and the Chromium licences | electron-builder keeps `LICENSE.electron.txt` and `LICENSES.chromium.html` |
| desktop `resources/ffmpeg/` | FFmpeg 9.0.2 | LGPL-2.1-or-later | compliant: built without `--enable-gpl` or `--enable-nonfree` (`build.sh`, checked by `verify.mjs`), `COPYING.LGPLv2.1` and `README.txt` ship, the tarball is attached to each release |

`NOTICE` said that the licences of third-party npm packages "ship with them in node_modules and in the release packages", which was true only of node-usb. Fixed in #26: the web build writes `THIRD-PARTY-LICENSES.md` ([web app](../features/web-app-technical.md#build)), the desktop packages carry `resources/libusb/COPYING` and `AUTHORS` ([packages](../features/desktop-technical.md#packages)), the Release workflow attaches node-usb's source package ([Release](../guides/development.md#release)), and `NOTICE` lists Mediabunny and libusb. The other entries of `NOTICE` stay as they are: P2Pro-Viewer and InfiRayCapture are MIT with the copyright lines quoted there, thermal-cat still states no licence (only facts were taken from it), and the FFmpeg entry matches the build.

## Repository settings

- **Self-hosted runner:** `ci.yml` runs on every `pull_request` on the self-hosted runner. In a public repository a pull request from a fork would run its code there. Moving to GitHub-hosted runners is [#56](https://github.com/mateuszsikora/irvis/issues/56), which must land before the visibility switch.
- **Required checks:** rulesets become available once the repository is public; the ruleset is in `.github/rulesets/main.json` ([decision](../decisions/docs.md#ci-checks-are-required-through-a-ruleset-once-the-repository-is-public), [how to apply it](../guides/development.md#required-checks)).

## Owner steps, in this order

1. Merge #26 and #56.
2. Delete the unexpired `irvis-mac`, `irvis-win` and `irvis-linux` artifacts built before #26, which lack the licence files: `gh api repos/mateuszsikora/irvis/actions/artifacts --paginate --jq '.artifacts[] | select(.name | startswith("irvis-")) | .id' | xargs -I{} gh api -X DELETE repos/mateuszsikora/irvis/actions/artifacts/{}`.
3. Decide about the e-mail address. It stays in the published history whatever is done to `main`. For new commits: GitHub → Settings → Emails → "Keep my email addresses private" and "Block command line pushes that expose my email", and `git config --global user.email <id>+<login>@users.noreply.github.com`.
4. Switch the visibility: Settings → General → Danger Zone → "Change repository visibility".
5. Apply the ruleset ([Required checks](../guides/development.md#required-checks)) and check it with a pull request and a release run.
