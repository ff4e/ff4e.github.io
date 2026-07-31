using System;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Windows.Gaming.Input;
using Microsoft.Web.WebView2.Core;
using Windows.ApplicationModel;
using Windows.System.Display;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

namespace Ff4eXbox
{
    /// <summary>
    /// Hosts the packaged web build in a WebView2 (Chromium) control.
    ///
    /// The game is served from a *local virtual host* rather than the network: the wwwroot
    /// folder inside the installed package is mapped onto https://ff4e.example via
    /// WebView2's SetVirtualHostNameToFolderMapping, so the app is fully self-contained and
    /// works with no internet connection, while still being an https origin (a secure
    /// context) so WebGL2, localStorage and the Gamepad API behave as on the web build.
    ///
    /// Every step is traced to App.Boot and every failure is shown on screen: on a console
    /// there is no debugger attached and the Device Portal has no log viewer, so a silent
    /// exception would just bounce the player back to Dev Home with no explanation.
    /// </summary>
    public sealed partial class MainPage : Page
    {
        // RFC 2606 reserves .example, so this can never resolve to a real server.
        const string VirtualHost = "ff4e.example";

        public static MainPage Current { get; private set; }

        readonly DisplayRequest _displayRequest = new DisplayRequest();
        bool _displayRequested;
        Microsoft.UI.Xaml.Controls.WebView2 _web;
        TaskCompletionSource<bool> _webLoaded;
        bool _started;
        Gamepad _pad;
        string _lastPadJson;
        CoreWebView2 _core;

        public MainPage()
        {
            InitializeComponent();
            Current = this;
            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
        }

        /// <summary>Show the boot trace on screen (the only diagnostic channel on a console).</summary>
        public void ShowBootLog()
        {
            try
            {
                string text;
                lock (App.Boot) text = App.Boot.ToString();
                StatusText.Text = text;
                StatusScroller.Visibility = Visibility.Visible;
                if (_web != null) _web.Visibility = Visibility.Collapsed;
            }
            catch
            {
                /* nothing further we can do */
            }
        }

        void Step(string s)
        {
            App.Log(s);
            ShowBootLog();
        }

        async void OnLoaded(object sender, RoutedEventArgs e)
        {
            Step("MainPage loaded");

            // WinUI 2 resources, merged here rather than from App.xaml so that a missing or
            // unloadable Microsoft.UI.Xaml framework package produces a readable message
            // instead of killing the app while the Application object is constructed.
            try
            {
                Application.Current.Resources.MergedDictionaries.Add(
                    new Microsoft.UI.Xaml.Controls.XamlControlsResources());
                Step("WinUI 2 resources merged");
            }
            catch (Exception ex)
            {
                Step("XamlControlsResources FAILED: " + ex.Message);
            }

            try
            {
                _web = new Microsoft.UI.Xaml.Controls.WebView2();
                _webLoaded = new TaskCompletionSource<bool>();
                _web.Loaded += (s2, e2) => _webLoaded.TrySetResult(true);
                // The rest of setup is driven from this event rather than from the value of
                // WebView2.CoreWebView2 after awaiting EnsureCoreWebView2Async: measured on
                // an Xbox Series X, that property stays null even once the event has fired,
                // so the event's `sender` is the only reliable way to reach the core.
                _web.CoreWebView2Initialized += (s3, a3) =>
                {
                    if (a3?.Exception != null)
                    {
                        Step("CoreWebView2Initialized reported: " + a3.Exception);
                        return;
                    }
                    var c = s3?.CoreWebView2;
                    Step("CoreWebView2Initialized fired (core " + (c != null ? "available" : "NULL") + ")");
                    if (c != null) Start(c, "initialized event");
                };
                RootGrid.Children.Insert(0, _web);
                Step("WebView2 control created");
            }
            catch (Exception ex)
            {
                Step("Creating the WebView2 control FAILED:\n" + ex);
                App.SaveLog();
                return;
            }

            // The control must be in the visual tree and loaded before its browser process
            // can attach.
            var loadedInTime = await Task.WhenAny(_webLoaded.Task, Task.Delay(10000)) == _webLoaded.Task;
            Step("WebView2 Loaded event: " + (loadedInTime ? "yes" : "TIMED OUT"));

            try
            {
                await _web.EnsureCoreWebView2Async();
                Step("EnsureCoreWebView2Async returned");
            }
            catch (Exception ex)
            {
                // Most likely on a console: the WebView2 runtime is missing because the
                // Xbox OS predates the 2310 (October 2023) update.
                Step(
                    "Starting the browser engine (WebView2) FAILED.\n" +
                    "Update the console to Xbox OS 2310 (October 2023) or newer.\n\n" + ex);
                App.SaveLog();
                return;
            }

            // If the event never delivered a usable core, fall back to the property (some
            // builds populate it late) before giving up.
            if (!_started)
            {
                for (var i = 0; i < 20 && !_started; i++)
                {
                    await Task.Delay(100);
                    if (_web.CoreWebView2 != null) { Start(_web.CoreWebView2, "property (late)"); break; }
                }
            }
            if (!_started)
            {
                Step("CoreWebView2 never became available — cannot map the game folder.");
                App.SaveLog();
            }
        }

        /// <summary>Configure the engine, map the packaged game folder, and navigate. Runs once.</summary>
        void Start(CoreWebView2 core, string via)
        {
            if (_started) return;
            _started = true;
            Step("starting via " + via);

            try
            {
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
#if DEBUG
                core.Settings.AreDevToolsEnabled = true;
#else
                core.Settings.AreDevToolsEnabled = false;
#endif
            }
            catch (Exception ex)
            {
                Step("settings (non-fatal): " + ex.Message);
            }

            try
            {
                // The only supported way to load packaged local content in WebView2 (the
                // legacy ms-appx-web:// scheme works only in the old EdgeHTML WebView).
                var root = System.IO.Path.Combine(Package.Current.InstalledLocation.Path, "wwwroot");
                core.SetVirtualHostNameToFolderMapping(
                    VirtualHost, root, CoreWebView2HostResourceAccessKind.Allow);
                Step("mapped " + VirtualHost + " -> " + root);
            }
            catch (Exception ex)
            {
                Step("Mapping the packaged game folder FAILED:\n" + ex);
                App.SaveLog();
                return;
            }

            try
            {
                core.NavigationCompleted += OnNavigationCompleted;
                core.ProcessFailed += (s2, a2) =>
                {
                    Step("WebView2 PROCESS FAILED: " + a2.ProcessFailedKind);
                    App.SaveLog();
                };
            }
            catch (Exception ex)
            {
                Step("event wiring (non-fatal): " + ex.Message);
            }

            // A puzzle game has long stretches with no input while the player thinks —
            // keep the console from blanking the screen.
            try
            {
                if (!_displayRequested)
                {
                    _displayRequest.RequestActive();
                    _displayRequested = true;
                }
            }
            catch (Exception ex)
            {
                App.Log("DisplayRequest (non-fatal): " + ex.Message);
            }

            _core = core;
            StartGamepadBridge();

            Step("navigating to the game...");
            try
            {
                _web.Source = new Uri($"https://{VirtualHost}/index.html");
                _web.Focus(FocusState.Programmatic);
            }
            catch (Exception ex)
            {
                Step("Navigation FAILED: " + ex);
                App.SaveLog();
            }
        }

        /// <summary>
        /// Feed controller state to the web app.
        ///
        /// WebView2's own Gamepad API is backed by GameInput (Gaming Services Runtime) and
        /// reports nothing inside a UWP app on Xbox, so the page sees no controller at all
        /// (WebView2Feedback#4366). The native shell can read the pad perfectly well, so we
        /// poll Windows.Gaming.Input here and post a Standard-Gamepad-shaped snapshot into
        /// the page, where platform/hostGamepad.ts republishes it through
        /// navigator.getGamepads(). Only sent when something changes.
        /// </summary>
        void StartGamepadBridge()
        {
            try
            {
                _pad = Gamepad.Gamepads.FirstOrDefault();
                Gamepad.GamepadAdded += (s, g) => { _pad = g; };
                Gamepad.GamepadRemoved += (s, g) => { if (ReferenceEquals(_pad, g)) _pad = Gamepad.Gamepads.FirstOrDefault(); };
                Windows.UI.Xaml.Media.CompositionTarget.Rendering += OnFrame;
                App.Log("gamepad bridge started (pads: " + Gamepad.Gamepads.Count + ")");
            }
            catch (Exception ex)
            {
                App.Log("gamepad bridge FAILED: " + ex.Message);
            }
        }

        static string N(double v)
        {
            return v.ToString("0.###", CultureInfo.InvariantCulture);
        }

        static string B(bool on)
        {
            return on ? "1" : "0";
        }

        void OnFrame(object sender, object e)
        {
            if (_core == null) return;
            var pad = _pad;
            string json;

            if (pad == null)
            {
                json = "{\"t\":\"pad\",\"connected\":false,\"axes\":[0,0,0,0],\"buttons\":[]}";
            }
            else
            {
                GamepadReading r;
                try { r = pad.GetCurrentReading(); }
                catch { return; }
                var b = r.Buttons;

                // W3C Standard Gamepad order. Thumbstick Y is inverted: Windows reports up
                // as positive, the Gamepad API reports down as positive.
                var sb = new StringBuilder(320);
                sb.Append("{\"t\":\"pad\",\"connected\":true,\"axes\":[")
                  .Append(N(r.LeftThumbstickX)).Append(',').Append(N(-r.LeftThumbstickY)).Append(',')
                  .Append(N(r.RightThumbstickX)).Append(',').Append(N(-r.RightThumbstickY))
                  .Append("],\"buttons\":[")
                  .Append(B((b & GamepadButtons.A) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.B) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.X) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.Y) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.LeftShoulder) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.RightShoulder) != 0)).Append(',')
                  .Append(N(r.LeftTrigger)).Append(',')
                  .Append(N(r.RightTrigger)).Append(',')
                  .Append(B((b & GamepadButtons.View) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.Menu) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.LeftThumbstick) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.RightThumbstick) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.DPadUp) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.DPadDown) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.DPadLeft) != 0)).Append(',')
                  .Append(B((b & GamepadButtons.DPadRight) != 0)).Append(",0]}");
                json = sb.ToString();
            }

            if (json == _lastPadJson) return; // nothing changed — don't spam the page
            _lastPadJson = json;
            try { _core.PostWebMessageAsJson(json); }
            catch { /* page not ready yet */ }
        }

        void OnNavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
        {
            if (!args.IsSuccess)
            {
                Step("Loading the game files FAILED. Status: " + args.WebErrorStatus);
                App.SaveLog();
                return;
            }
            // Success: hide the diagnostics and hand the screen (and the pad) to the game.
            App.Log("navigation completed ok");
            App.SaveLog();
            StatusScroller.Visibility = Visibility.Collapsed;
            if (_web != null)
            {
                _web.Visibility = Visibility.Visible;
                _web.Focus(FocusState.Programmatic);
            }
        }

        void OnUnloaded(object sender, RoutedEventArgs e)
        {
            if (_displayRequested)
            {
                _displayRequest.RequestRelease();
                _displayRequested = false;
            }
        }
    }
}
