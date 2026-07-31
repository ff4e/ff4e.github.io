using System;
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
    /// The game is served from a *local virtual host* rather than the network: the
    /// wwwroot folder inside the installed package is mapped onto https://ff4e.example,
    /// so the app is fully self-contained and works with no internet connection, while
    /// still being an https origin (a secure context) so WebGL2, localStorage and the
    /// Gamepad API all behave exactly as they do on the web build.
    /// </summary>
    public sealed partial class MainPage : Page
    {
        // RFC 2606 reserves .example, so this hostname can never resolve to a real server
        // even if the mapping were somehow missing.
        const string VirtualHost = "ff4e.example";

        readonly DisplayRequest _displayRequest = new DisplayRequest();
        bool _displayRequested;

        public MainPage()
        {
            InitializeComponent();
            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
        }

        async void OnLoaded(object sender, RoutedEventArgs e)
        {
            try
            {
                await WebView.EnsureCoreWebView2Async();
            }
            catch (Exception ex)
            {
                // Most likely cause on a console: the WebView2 runtime is missing because
                // the Xbox OS predates the 2310 (October 2023) update. Say so, instead of
                // leaving the player looking at a black screen.
                ShowError(
                    "Couldn't start the browser engine (WebView2).\n\n" +
                    "Update the console to Xbox OS 2310 (October 2023) or newer, then try again.\n\n" +
                    ex.Message);
                return;
            }

            var core = WebView.CoreWebView2;

            // Console chrome: no right-click menus, no status bar, no pinch/ctrl zoom.
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
#if DEBUG
            core.Settings.AreDevToolsEnabled = true;
#else
            core.Settings.AreDevToolsEnabled = false;
#endif

            // Map the packaged wwwroot onto the virtual host. This is the only supported
            // way to load packaged local content in WebView2 (the legacy ms-appx-web://
            // scheme works only in the old EdgeHTML WebView).
            var root = System.IO.Path.Combine(Package.Current.InstalledLocation.Path, "wwwroot");
            core.SetVirtualHostNameToFolderMapping(
                VirtualHost, root, CoreWebView2HostResourceAccessKind.Allow);

            core.NavigationCompleted += OnNavigationCompleted;

            // A puzzle game has long stretches with no input while the player thinks —
            // keep the console from blanking the screen.
            if (!_displayRequested)
            {
                _displayRequest.RequestActive();
                _displayRequested = true;
            }

            WebView.Source = new Uri($"https://{VirtualHost}/index.html");

            // Make sure the gamepad reaches the web content rather than the XAML shell.
            WebView.Focus(FocusState.Programmatic);
        }

        void OnNavigationCompleted(
            CoreWebView2 sender,
            CoreWebView2NavigationCompletedEventArgs args)
        {
            if (!args.IsSuccess)
            {
                ShowError(
                    "Couldn't load the game files from the app package.\n\n" +
                    "Status: " + args.WebErrorStatus);
                return;
            }
            WebView.Focus(FocusState.Programmatic);
        }

        void ShowError(string message)
        {
            ErrorText.Text = message;
            ErrorText.Visibility = Visibility.Visible;
            WebView.Visibility = Visibility.Collapsed;
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
