using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.UI.Core;
using Windows.UI.ViewManagement;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace Ff4eXbox
{
    /// <summary>
    /// UWP host application for the packaged Fish Fillets 4ever web build.
    ///
    /// The whole game runs inside a WebView2 (Chromium) control; this shell exists only
    /// to create the window and apply the two Xbox-specific behaviours that a plain UWP
    /// app does not get by default (see OnLaunched).
    /// </summary>
    sealed partial class App : Application
    {
        public App()
        {
            InitializeComponent();

            // Xbox delivers controller input as an emulated *mouse pointer* ("mouse mode")
            // unless the app opts out. Mouse mode would swallow the gamepad before it ever
            // reached the web app's Gamepad API, breaking every control added in P0/P1.
            // WhenRequested keeps the pointer available only if a control explicitly asks
            // for it, so by default the gamepad stays a gamepad.
            RequiresPointerMode = ApplicationRequiresPointerMode.WhenRequested;

            Suspending += OnSuspending;
        }

        protected override void OnLaunched(LaunchActivatedEventArgs e)
        {
            // Draw edge to edge on a TV instead of inside the console's default title-safe
            // inset: the app already renders its own 5% title-safe margin in TV mode (P3),
            // and letting the OS inset as well would double the margin and shrink the game.
            var view = ApplicationView.GetForCurrentView();
            view.SetDesiredBoundsMode(ApplicationViewBoundsMode.UseCoreWindow);
            view.TryEnterFullScreenMode();

            if (!(Window.Current.Content is Frame rootFrame))
            {
                rootFrame = new Frame();
                rootFrame.NavigationFailed += OnNavigationFailed;
                Window.Current.Content = rootFrame;
            }

            if (e.PrelaunchActivated == false && rootFrame.Content == null)
            {
                rootFrame.Navigate(typeof(MainPage), e.Arguments);
            }

            Window.Current.Activate();
        }

        void OnNavigationFailed(object sender, NavigationFailedEventArgs e)
        {
            throw new System.Exception("Failed to load " + e.SourcePageType.FullName);
        }

        void OnSuspending(object sender, SuspendingEventArgs e)
        {
            // Nothing to persist here: the game stores its own progress in WebView2's
            // localStorage, which survives suspend/terminate and app updates.
            var deferral = e.SuspendingOperation.GetDeferral();
            deferral.Complete();
        }
    }
}
