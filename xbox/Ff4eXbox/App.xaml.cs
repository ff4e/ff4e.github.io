using System;
using System.Diagnostics;
using System.Text;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.Storage;
using Windows.Foundation;
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

        /// <summary>Started with the process, so every boot.log line says when it happened.</summary>
        static readonly Stopwatch Clock = Stopwatch.StartNew();

        /// <summary>
        /// Where the system drew the launch splash, in window coordinates, so MainPage can
        /// keep the same picture in the same place until the game page is up. Null if the
        /// launch did not report one.
        /// </summary>
        public static Rect? SplashRect;

        public static void Log(string line)
        {
            lock (Boot) Boot.AppendLine(Clock.ElapsedMilliseconds.ToString().PadLeft(6) + " ms  " + line);
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
                if (e.SplashScreen != null) SplashRect = e.SplashScreen.ImageLocation;
            }
            catch (Exception ex)
            {
                Log("splash location (non-fatal): " + ex.Message);
            }
            try
            {
                // Draw edge to edge on a TV rather than inside the console's default
                // title-safe inset: the web app lays the picture out full-bleed and keeps
                // its own controls (the legend) clear of the edge, and an HDMI panel in
                // its 1:1 mode crops nothing — insetting here would only shrink the room.
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
