import CarPlay
import Combine
import MapboxMaps
import MapboxNavigationCore
import rnmapbox_maps
// Some CarPlayManagerDelegate requirements have their default implementations only in this SPI.
@_spi(MapboxCarPlayInternal) import MapboxNavigationUIKit

/// `UISceneDelegateClassName` of the CarPlay scene in Info.plist, set by the Expo config plugin's `carPlay` option.
@objc(RNMBXNavigationCarPlaySceneDelegate)
final class RNMBXNavigationCarPlaySceneDelegate: NSObject, CPTemplateApplicationSceneDelegate {
  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController,
    to window: CPWindow
  ) {
    RNMBXNavigationCarPlay.shared.connect(templateApplicationScene, interfaceController, window)
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnect interfaceController: CPInterfaceController,
    from window: CPWindow
  ) {
    RNMBXNavigationCarPlay.shared.disconnect(templateApplicationScene, interfaceController, window)
  }
}

/// Hosts the component registered with `Navigation.registerCarPlayRoot` while CarPlay is connected, so `<CarMap>`
/// children render even when CarPlay launched the app without its phone UI.
@objc(RNMBXNavigationCarPlayRoot)
public final class RNMBXNavigationCarPlayRoot: NSObject {
  /// Keep in sync with `CARPLAY_ROOT_MODULE` in src/Navigation.ts.
  @objc public static let moduleName = "RNMBXNavigationCarPlayRoot"

  /// The app's `RCTReactNativeFactory`, set by the app delegate (the Expo plugin's `carPlay` option adds that).
  /// Without it CarPlay shows the map but doesn't host the root.
  @objc public static var reactNativeFactory: NSObject?

  /// Creates the root on the factory's React Native host, starting the host if the phone scene hasn't yet.
  static func makeRootView() -> UIView? {
    guard let factory = reactNativeFactory else { return nil }
    func property(_ key: String) -> AnyObject? {
      factory.responds(to: NSSelectorFromString(key)) ? factory.value(forKey: key) as AnyObject? : nil
    }
    guard let rootViewFactory = property("rootViewFactory") as? NSObject,
          rootViewFactory.responds(to: rootViewFactorySelector)
    else {
      Logger.error("RNMBXNavigationCarPlayRoot.reactNativeFactory isn't an RCTReactNativeFactory; CarPlay shows no root")
      return nil
    }
    // Same arguments as `-[RCTReactNativeFactory startReactNativeWithModuleName:...]`.
    return unsafeBitCast(rootViewFactory, to: RootViewFactory.self).view(
      withModuleName: moduleName,
      initialProperties: nil,
      launchOptions: nil,
      bundleConfiguration: property("bundleConfiguration"),
      devMenuConfiguration: property("devMenuConfiguration")
    )
  }
}

/// `RCTRootViewFactory`'s view method. Swift imports its configurations as non-null, but they are nil in release
/// builds, where `+[RCTDevMenuConfiguration defaultConfiguration]` returns nil.
@objc private protocol RootViewFactory {
  @objc(viewWithModuleName:initialProperties:launchOptions:bundleConfiguration:devMenuConfiguration:)
  func view(
    withModuleName moduleName: String,
    initialProperties: [AnyHashable: Any]?,
    launchOptions: [AnyHashable: Any]?,
    bundleConfiguration: AnyObject?,
    devMenuConfiguration: AnyObject?
  ) -> UIView
}

private let rootViewFactorySelector =
  #selector(RootViewFactory.view(withModuleName:initialProperties:launchOptions:bundleConfiguration:devMenuConfiguration:))

/// Shows the shared navigation session on CarPlay: the map while idle, turn-by-turn guidance while the phone guides.
@MainActor
final class RNMBXNavigationCarPlay: NSObject {
  static let shared = RNMBXNavigationCarPlay()

  @Published private(set) var connected = false
  /// The map the car screen shows; its id changes with every switch so `<CarMap>` re-adds its children.
  @Published private(set) var carMap = CarMap(id: 0, activity: "browsing")

  struct CarMap {
    let id: Int32
    let activity: String
    weak var mapView: MapView?
  }

  private var nextCarMapId: Int32 = 1
  private weak var browsingMapView: MapView?

  private var manager: CarPlayManager?
  private var reactRootView: UIView?
  private var subscriptions = Set<AnyCancellable>()

  /// `beginNavigationWithCarPlay` runs asynchronously and ends in `startActiveGuidance` from leg 0.
  private struct PendingGuidance {
    var legIndex: Int
    var cancelled = false
  }

  private var pendingGuidance: PendingGuidance?

  func connect(_ scene: CPTemplateApplicationScene, _ interfaceController: CPInterfaceController, _ window: CPWindow) {
    connected = true
    let session = RNMBXNavigationSession.shared
    // CarPlay can launch the app without the phone scene; the Info.plist token shows the map before JS sets one.
    if session.accessToken == nil {
      session.accessToken = MapboxOptions.accessToken
    }
    // Without a token in Info.plist, the provider exists only once JS has set one.
    _ = try? session.mapboxNavigation()
    session.$provider
      .compactMap { $0 }
      .first()
      .sink { [weak self] provider in
        self?.start(provider, scene, interfaceController, window)
      }
      .store(in: &subscriptions)

    if let rootView = RNMBXNavigationCarPlayRoot.makeRootView() {
      // Renders no UI of its own; it only has to stay mounted for `<CarMap>`, under the map.
      rootView.frame = .zero
      rootView.isUserInteractionEnabled = false
      window.insertSubview(rootView, at: 0)
      reactRootView = rootView
    }
  }

  func disconnect(_ scene: CPTemplateApplicationScene, _ interfaceController: CPInterfaceController, _ window: CPWindow) {
    subscriptions.removeAll()
    pendingGuidance = nil
    reactRootView?.removeFromSuperview()
    reactRootView = nil
    manager?.templateApplicationScene(scene, didDisconnect: interfaceController, from: window)
    manager = nil
    browsingMapView = nil
    carMap = CarMap(id: 0, activity: "browsing")
    connected = false
  }

  private func start(
    _ provider: MapboxNavigationProvider,
    _ scene: CPTemplateApplicationScene,
    _ interfaceController: CPInterfaceController,
    _ window: CPWindow
  ) {
    let manager = CarPlayManager(navigationProvider: provider)
    manager.delegate = self
    self.manager = manager
    manager.templateApplicationScene(scene, didConnect: interfaceController, to: window)

    provider.mapboxNavigation.tripSession().session
      .map { session in
        if case .activeGuidance = session.state { return true }
        return false
      }
      .removeDuplicates()
      .receive(on: DispatchQueue.main)
      .sink { [weak self] guiding in self?.followGuidance(guiding) }
      .store(in: &subscriptions)
  }

  /// For the `rnmbxnavcar:<id>` map view factory; nil once the car screen has moved on to another map.
  func mapView(forCarMapId id: Int32) -> MapView? {
    carMap.id == id ? carMap.mapView : nil
  }

  private func show(_ mapView: MapView?, activity: String) {
    guard let mapView else { return }
    carMap = CarMap(id: nextCarMapId, activity: activity, mapView: mapView)
    nextCarMapId += 1
  }

  private func followGuidance(_ guiding: Bool) {
    guard let manager else { return }
    if guiding {
      guard manager.carPlayNavigationViewController == nil, pendingGuidance == nil else { return }
      let session = RNMBXNavigationSession.shared
      pendingGuidance = PendingGuidance(legIndex: session.routeProgress?.legIndex ?? 0)
      manager.beginNavigationWithCarPlay(using: session.location?.coordinate ?? kCLLocationCoordinate2DInvalid)
    } else if let navigationViewController = manager.carPlayNavigationViewController {
      navigationViewController.exitNavigation(byCanceling: true)
    } else {
      pendingGuidance?.cancelled = true
    }
  }

  /// The view controller has just restarted guidance from leg 0; put the phone's trip back as it was.
  private func takeOverGuidance() {
    guard let pending = pendingGuidance, !pending.cancelled, pending.legIndex > 0,
          let tripSession = RNMBXNavigationSession.shared.provider?.mapboxNavigation.tripSession(),
          let routes = tripSession.currentNavigationRoutes
    else { return }
    tripSession.startActiveGuidance(with: routes, startLegIndex: pending.legIndex)
  }
}

extension RNMBXNavigationCarPlay: CarPlayManagerDelegate {
  nonisolated func carPlayManager(_ carPlayManager: CarPlayManager, didSetup navigationMapView: NavigationMapView) {
    MainActor.assumeIsolated {
      browsingMapView = navigationMapView.mapView
      show(navigationMapView.mapView, activity: "browsing")
    }
  }

  nonisolated func carPlayManager(
    _ carPlayManager: CarPlayManager,
    willPresent navigationViewController: CarPlayNavigationViewController
  ) {
    MainActor.assumeIsolated {
      takeOverGuidance()
      show(navigationViewController.navigationMapView?.mapView, activity: "navigating")
    }
  }

  nonisolated func carPlayManager(
    _ carPlayManager: CarPlayManager,
    didPresent navigationViewController: CarPlayNavigationViewController
  ) {
    MainActor.assumeIsolated {
      let cancelled = pendingGuidance?.cancelled ?? false
      pendingGuidance = nil
      // The phone stopped while CarPlay was still starting; ending here stops the guidance CarPlay restarted.
      if cancelled {
        navigationViewController.exitNavigation(byCanceling: true)
      }
    }
  }

  nonisolated func carPlayManagerDidEndNavigation(_ carPlayManager: CarPlayManager, byCanceling canceled: Bool) {
    MainActor.assumeIsolated {
      show(browsingMapView, activity: "browsing")
      // Ending the trip on the car ends it on the phone too; it already has if the phone stopped it.
      if case .activeGuidance = RNMBXNavigationSession.shared.provider?.mapboxNavigation.tripSession().currentSession.state {
        RNMBXNavigationSession.shared.stop()
      }
    }
  }
}
