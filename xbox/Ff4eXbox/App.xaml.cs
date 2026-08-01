using System;
using System.Text;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.Storage;
using Windows.UI.ViewManagement;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace Ff4eXbox
{
    /// <summary>
    /// UWP host application for the packaged Fish Fillets 4ever web build.
    ///
    /// The game itself runs inside a WebView2 (Chromium) control; this shell only creates
    /// the window, applies the Xbox-specific input/bounds behaviour, and — importantly on a
    /// console, where there is no debugger and the Device Portal has no log viewer —
    /// makes any startup failure *visible* instead of silently returning to Dev Home.
    /// </summary>
    sealed partial class App : Application
    {
        /// <summary>Boot trace, shown on screen and written to the app's local folder.</summary>
        public static readonly StringBuilder Boot = new StringBuilder();

        public static void Log(string line)
        {
            lock (Boot) Boot.AppendLine(line);
        }

        /// <summary>
        /// Append a line to a crash log that is never truncated, so a failure survives
        /// the relaunch that follows it (boot.log is replaced on every start).
        /// </summary>
        public static async void AppendCrash(string line)
        {
            try
            {
                var file = await ApplicationData.Current.LocalFolder.CreateFileAsync(
                    "crash.log", CreationCollisionOption.OpenIfExists);
                await FileIO.AppendTextAsync(file, DateTime.Now.ToString("s") + "  " + line + "\r\n");
            }
            catch
            {
                /* diagnostics must never themselves break the app */
            }
        }

        /// <summary>
        /// Persist the boot trace so it can be retrieved from the Xbox Device Portal's file
        /// explorer (LocalAppData\...\LocalState\boot.log) when the screen is not enough.
        /// </summary>
        public static async void SaveLog()
        {
            try
            {
                string text;
                lock (Boot) text = Boot.ToString();
                var file = await ApplicationData.Current.LocalFolder.CreateFileAsync(
                    "boot.log", CreationCollisionOption.ReplaceExisting);
                await FileIO.WriteTextAsync(file, text);
            }
            catch
            {
                /* diagnostics must never themselves break startup */
            }
        }

        public App()
        {
            // Anything thrown past this point is reported rather than terminating silently.
            UnhandledException += (s, e) =>
            {
                Log("UNHANDLED: " + e.Message);
                AppendCrash("UNHANDLED: " + e.Message);
                Log(e.Exception?.ToString() ?? "(no exception object)");
                SaveLog();
                // Keep the process alive so the message stays on screen to be read.
                e.Handled = true;
                MainPage.Current?.ShowBootLog();
            };

            Log("App ctor");
            InitializeComponent();
            Log("InitializeComponent ok");

            // Xbox hands controller input to apps as an emulated mouse pointer unless the
            // app opts out; that would swallow the gamepad before the web app's Gamepad API
            // saw it. Guarded: on any platform where the property is unavailable this must
            // not be fatal.
            try
            {
                RequiresPointerMode = ApplicationRequiresPointerMode.WhenRequested;
                Log("RequiresPointerMode = WhenRequested");
            }
            catch (Exception ex)
            {
                Log("RequiresPointerMode failed (non-fatal): " + ex.Message);
            }

            Suspending += OnSuspending;
        }

        protected override void OnLaunched(LaunchActivatedEventArgs e)
        {
            Log("OnLaunched");
            try
            {
                // Draw edge to edge on a TV rather than inside the console's default
                // title-safe inset: the web app already renders its own 5% safe margin in
                // TV mode, and insetting twice would shrink the picture.
                var view = ApplicationView.GetForCurrentView();
                view.SetDesiredBoundsMode(ApplicationViewBoundsMode.UseCoreWindow);
                Log("bounds mode = UseCoreWindow");
            }
            catch (Exception ex)
            {
                Log("SetDesiredBoundsMode failed (non-fatal): " + ex.Message);
            }

            if (!(Window.Current.Content is Frame rootFrame))
            {
                rootFrame = new Frame();
                rootFrame.NavigationFailed += (s, args) =>
                {
                    Log("NAVIGATION FAILED: " + args.SourcePageType.FullName + " — " + args.Exception);
                    SaveLog();
                    args.Handled = true;
                };
                Window.Current.Content = rootFrame;
            }

            if (rootFrame.Content == null)
            {
                Log("navigating to MainPage");
                rootFrame.Navigate(typeof(MainPage), e.Arguments);
            }

            Window.Current.Activate();
            Log("window activated");
        }

        void OnSuspending(object sender, SuspendingEventArgs e)
        {
            // Nothing to persist: the game keeps its progress in WebView2's localStorage,
            // which survives suspend/terminate and app updates.
            var deferral = e.SuspendingOperation.GetDeferral();
            deferral.Complete();
        }
    }
}
