# Publishing a new version

New versions are built automatically by GitHub (free for public repositories) and appear on the **Releases** page. Installed apps notice the update by themselves.

## Release in 3 clicks

1. Go to the repository on GitHub → **Actions** → **Release** → **Run workflow**.
2. Type the new version number (for example `0.3.0`) and click **Run workflow**.
3. Wait about 15 minutes. The Mac and Windows apps appear under **Releases**.

(Developers can also push a tag: `git tag v0.3.0 && git push origin v0.3.0`.)

**If the Mac (or Windows) build fails or gets stuck:** GitHub sometimes runs short of Mac machines. The release is still published with whichever app built. Open the run in **Actions** and click **Re-run failed jobs** later; the missing app is added to the same release.

The download links in the README always point to the latest release, so they never need changing.

## How updates reach students

- **Windows:** the app downloads updates in the background and asks to restart.
- **Mac:** the app shows "LectureLab 0.3.0 is available" with a **Download** button. (Fully automatic Mac updates need an Apple Developer ID; see below.)
- Courses, files and progress are stored separately from the app, so updates never touch them.

## What students see the first time they open the app

Without paid code-signing certificates, Mac and Windows show a one-time warning, because the app isn't from a "registered developer" yet:

- **Mac:** "LectureLab can't be opened…". Fix: open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** (on older macOS: right-click the app → **Open**). This is needed only once.
- **Windows:** "Windows protected your PC". Fix: click **More info → Run anyway**. Also needed only once.

The README explains this to students.

## Removing the warnings (optional, costs money)

| | Cost | What you get |
|---|---|---|
| **Apple Developer Program** | $99/year | No Mac warning, automatic Mac updates |
| **Windows code signing** (Azure Trusted Signing, or an OV certificate) | ~$10/month, or ~$100–300/year | The Windows warning goes away (OV certificates build trust over time) |

To use an Apple Developer ID once you have one:

1. Export your "Developer ID Application" certificate as a `.p12` file.
2. In GitHub → **Settings → Secrets and variables → Actions**, add `CSC_LINK` (the .p12 file, base64-encoded), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.
3. In `desktop/electron-builder.yml`, delete the `identity: "-"` and `hardenedRuntime: false` lines, and add `notarize: true` under `mac:`.
4. In `.github/workflows/release.yml`, remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"` and pass the secrets as environment variables.
5. Then auto-update can be turned on for Mac in `desktop/main.js` (use `electron-updater` for both platforms).

## Building locally (developers)

```bash
npm run desktop:start
```

That runs the desktop app from source. To build an installer for your own computer:

```bash
npm run desktop:dist
```

The result is in `desktop/dist/`.
