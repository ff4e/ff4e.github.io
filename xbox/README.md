# Fish Fillets 4ever — Xbox (UWP + WebView2)

A fully **self-contained** console build: the entire game (HTML, JS bundle and ~350 MB of
game data) ships **inside the MSIX** and is served to WebView2 from a local virtual host.
The app never touches the network.

## How it works

| Piece | Role |
| --- | --- |
| `Ff4eXbox` (UWP C#) | Thin host window. No game logic. |
| `Microsoft.UI.Xaml.Controls.WebView2` | Chromium engine — **hardware-accelerated WebGL2** on Xbox. |
| `SetVirtualHostNameToFolderMapping` | Maps the packaged `wwwroot` onto `https://ff4e.example`. |
| `wwwroot/` | The built site, staged by `tools/stage-xbox-wwwroot.mjs`. Not committed. |

Two Xbox-specific behaviours live in the host (`App.xaml.cs`):

- **`RequiresPointerMode = WhenRequested`** — Xbox otherwise turns the controller into an
  emulated mouse pointer, which would swallow the gamepad before the web app's Gamepad API
  ever saw it.
- **`SetDesiredBoundsMode(UseCoreWindow)`** — draw edge to edge. The app already renders its
  own 5% title-safe margin in TV mode (P3); letting the OS inset too would double it.

The web build is compiled with `VITE_TARGET=xbox`, which turns TV mode on by default and
drops service-worker registration (the content is already local).

### Why not PWABuilder?

PWABuilder's Xbox target is [blocked](https://github.com/pwa-builder/PWABuilder/issues/2479)
and its Windows output is a **hosted** wrapper that loads a live URL — the opposite of a
self-contained install. Hence the hand-written UWP host.

## Requirements

- **Xbox Series X|S** on OS **2310 (Oct 2023)** or newer — that's when the WebView2 runtime
  shipped. On older builds the app shows a "Couldn't start the browser engine" message.
- ⚠️ **Xbox One is not supported.** Instantiating WebView2 in a UWP app currently
  [crashes the console](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5404)
  (open Microsoft bug).
- A Partner Center developer account (free) to activate Dev Mode.

## Building the package

Nothing here builds on macOS/Linux — a UWP MSIX needs Windows + the Visual Studio
"Universal Windows Platform development" workload. **Use CI:**

> Actions → **Build Xbox MSIX** → *Run workflow* → download the **`ff4e-xbox-msix`**
> artifact (contains the `.msix` and the `.cer` it was signed with).

Locally on a Windows box, the equivalent is:

```powershell
$env:VITE_TARGET = "xbox"
npm ci; npm run build
node tools/stage-pages-assets.mjs      # public/ (incl. game data) -> dist/
node tools/stage-xbox-wwwroot.mjs      # dist/ -> xbox/Ff4eXbox/wwwroot/
msbuild xbox\Ff4eXbox.sln /t:Restore /p:Configuration=Release /p:Platform=x64
msbuild xbox\Ff4eXbox.sln /p:Configuration=Release /p:Platform=x64 /p:AppxBundle=Never /p:UapAppxPackageBuildMode=SideloadOnly
```

The CI package is signed with a **throwaway self-signed certificate** (subject `CN=FF4E`,
matching `Package.appxmanifest`'s `Publisher`). That is all Dev Mode needs. A Store
submission would instead use the identity assigned by Partner Center — change **both** the
manifest `Publisher` and the signing certificate together, or packaging fails.

## Getting it onto the console

1. **Developer account** — sign up at <https://storedeveloper.microsoft.com> →
   *Get started for free* → **Individual**. Registration is free (the old $19 fee was
   waived); verification is government ID + selfie. Use a **personal** Microsoft account.
2. **Activate Dev Mode** — on the console install the **green "Xbox Dev Mode"** app from the
   Store (the older black *"Dev Mode Activation"* app no longer works). It shows an
   activation code; register it in Partner Center under
   *Account settings → Manage Xbox devices*. The console reboots into Dev Mode.
3. **Open Device Portal** — from the Dev Mode home screen note the console's IP, then browse
   to `https://<xbox-ip>:11443` from a PC/Mac on the same network and log in with the
   credentials shown on the console.
4. **Sideload** — Device Portal → *Add / Install app* → upload the `.msix`. **Also add every
   `.appx` from the artifact's `Dependencies/` folder as dependency packages** — the console
   does not ship WinUI 2 / .NET Native, and without them the app installs but dies on the
   splash screen (see Troubleshooting). If it refuses the signature, upload the bundled
   `ff4e.cer` as the certificate first.
5. **Launch** it from the Dev Mode home screen.

## Troubleshooting

**Splash screen appears, then the app closes straight back to Dev Home.**
Almost always a missing framework dependency. The package declares these, and none of them
are preinstalled on a console:

- `Microsoft.UI.Xaml.2.8` (WinUI 2 — supplies the WebView2 control)
- `Microsoft.NET.Native.Framework.2.2` and `Microsoft.NET.Native.Runtime.2.2`
- `Microsoft.VCLibs.140.00` (+ `.UWPDesktop`)

Install every `.appx` in the artifact's `Dependencies/` folder, then reinstall the app.
Device Portal's install form has a separate field for dependency packages; add them there
rather than installing the app alone.

**"Couldn't start the browser engine (WebView2)."** The console is on an Xbox OS older than
2310 (October 2023). Update it.

**The game renders but the controller does nothing.** Xbox is still handing the pad to the
app as an emulated mouse pointer — check `RequiresPointerMode` in `App.xaml.cs`.

## On-device checklist

- [ ] App launches; no "browser engine" error (⇒ WebView2 runtime present).
- [ ] The game renders — confirms **WebGL2** works. If it falls back to the CPU renderer,
      check the in-game WebGL note.
- [ ] **Controller works**: left stick = small fish, right stick = big fish; B/View = map;
      LB/RB/X = save/load/restart with Ⓐ-confirm; Menu = Options.
      A dead controller here means mouse mode is still on — check `RequiresPointerMode`.
- [ ] World-map navigation moves the selection ring between nodes and corner buttons.
- [ ] Nothing important is cut off at the screen edges (title-safe margins) on a real TV.
- [ ] Frame rate is acceptable at 1080p and 4K.
- [ ] Progress survives a full app close and relaunch (localStorage persistence).
- [ ] Aeroplane-mode / unplug the network: everything still works (fully offline).

## Licensing

The original *Fish Fillets* (ALTAR interactive, 1998) was released under **GPL-2.0-or-later**
in 2004, including the game data. This port and its packaged assets inherit that licence;
see `LICENSE` and `CREDITS.md`. "Fish Fillets" is ALTAR's name — this is an unaffiliated fan
port, not an official release.
