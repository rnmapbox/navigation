import Combine
import CoreLocation
import MapboxDirections
import MapboxNavigationCore
import MapboxNavigationUIKit
import UIKit

@objc(RNMBXNavigationView)
public final class RNMBXNavigationView: UIView {
  @objc public var onRouteProgress: (([String: Any]) -> Void)?
  @objc public var onArrive: (([String: Any]) -> Void)?
  @objc public var onCancel: (() -> Void)?
  @objc public var onError: (([String: Any]) -> Void)?

  @objc public var simulate = false
  @objc public var mute = false {
    didSet { RNMBXNavigationSession.shared.voiceMuted = mute }
  }

  /// Empty for the SDK default.
  @objc public var styleURL = "" {
    didSet {
      if styleURL != oldValue { applyStyles() }
    }
  }

  /// Empty to use `styleURL`.
  @objc public var nightStyleURL = "" {
    didSet {
      if nightStyleURL != oldValue { applyStyles() }
    }
  }

  @objc public var route: RNMBXNavigationRoute? {
    didSet {
      if route !== oldValue { scheduleGuidance() }
    }
  }

  private var navigationViewController: RNMBXNavigationViewController?
  private var subscriptions = Set<AnyCancellable>()
  private var guidanceScheduled = false
  private var invalidated = false

  override public func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, navigationViewController == nil {
      scheduleGuidance()
    }
  }

  override public func layoutSubviews() {
    super.layoutSubviews()
    navigationViewController?.view.frame = bounds
  }

  @objc public func invalidate() {
    invalidated = true
    guard navigationViewController != nil else { return }
    removeNavigationViewController()
    RNMBXNavigationSession.shared.stop()
  }

  /// Loading the view controller inside a React mount transaction overflows the main thread's stack in debug builds.
  private func scheduleGuidance() {
    guard !guidanceScheduled else { return }
    guidanceScheduled = true
    Task { @MainActor [weak self] in
      guard let self else { return }
      guidanceScheduled = false
      await startGuidance()
    }
  }

  private func startGuidance() async {
    guard let route, window != nil, !invalidated else { return }
    let session = RNMBXNavigationSession.shared
    let navigation: MapboxNavigation
    do {
      guard let prepared = try await session.prepareActiveGuidance(route, simulate: simulate),
            route === self.route, window != nil, !invalidated
      else { return }
      navigation = prepared
    } catch {
      onError?(["code": "start_failed", "message": error.localizedDescription])
      return
    }
    session.voiceMuted = mute
    // The view controller's `viewWillAppear` resets its mute button on a later turn.
    defer {
      Task { @MainActor [weak self] in
        self?.renderMute()
      }
    }
    if navigationViewController != nil {
      navigation.tripSession().startActiveGuidance(with: route.routes, startLegIndex: 0)
      return
    }
    guard let parent = parentViewController, let provider = session.provider else {
      onError?(["code": "start_failed", "message": "NavigationView isn't in a view controller"])
      return
    }

    let options = NavigationOptions(
      mapboxNavigation: navigation,
      voiceController: provider.routeVoiceController,
      eventsManager: provider.eventsManager(),
      styles: styles
    )
    let controller = RNMBXNavigationViewController(navigationRoutes: route.routes, navigationOptions: options)
    controller.delegate = self
    // The session keeps the screen awake; the controller would reset the idle timer to `false` when it disappears.
    controller.shouldManageApplicationIdleTimer = false
    parent.addChild(controller)
    controller.view.frame = bounds
    addSubview(controller.view)
    controller.didMove(toParent: parent)
    // The end of route feedback asks for a rating, which apps embedding the view rarely want.
    controller.showsEndOfRouteFeedback = false
    navigationViewController = controller
    muteButton?.addTarget(self, action: #selector(muteButtonTapped(_:)), for: .touchUpInside)
    session.$voiceMuted
      .sink { [weak self] muted in self?.muteButton?.isSelected = muted }
      .store(in: &subscriptions)

    navigation.navigation().waypointsArrival
      .sink { [weak self] status in
        switch status.event {
        case let event as WaypointArrivalStatus.Events.ToWaypoint:
          self?.onArrive?(["waypointIndex": event.legIndex + 1, "isFinalDestination": false])
        case is WaypointArrivalStatus.Events.ToFinalDestination:
          let legCount = self?.route?.routes.mainRoute.route.legs.count ?? 1
          self?.onArrive?(["waypointIndex": legCount, "isFinalDestination": true])
        default:
          break
        }
      }
      .store(in: &subscriptions)
  }

  /// Follows the system appearance. A single style, as the SDK's style manager picks between several by sunrise and
  /// sunset even with `automaticallyAdjustsStyleForTimeOfDay` off, e.g. when the content size category changes.
  private var styles: [MapboxNavigationUIKit.Style] {
    let dayURL = URL(string: styleURL)
    guard traitCollection.userInterfaceStyle == .dark else {
      return [dayURL.map { url in
        let style = DayStyle()
        style.mapStyleURL = url
        style.previewMapStyleURL = url
        return style
      } ?? StandardDayStyle()]
    }
    return [(URL(string: nightStyleURL) ?? dayURL).map { url in
      let style = NightStyle()
      style.mapStyleURL = url
      style.previewMapStyleURL = url
      return style
    } ?? StandardNightStyle()]
  }

  private func applyStyles() {
    navigationViewController?.styleManager.styles = styles
  }

  override public func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if traitCollection.userInterfaceStyle != previousTraitCollection?.userInterfaceStyle {
      applyStyles()
    }
  }

  private func renderMute() {
    muteButton?.isSelected = RNMBXNavigationSession.shared.voiceMuted
  }

  @objc private func muteButtonTapped(_ button: UIButton) {
    // The SDK's own target toggles the button; read it once every target has run.
    Task { @MainActor in
      RNMBXNavigationSession.shared.voiceMuted = button.isSelected
    }
  }

  /// The SDK keeps its mute button internal; it's the only floating button with a selected image.
  private var muteButton: UIButton? {
    navigationViewController?.floatingButtons?.first { $0.image(for: .selected) != $0.image(for: .normal) }
  }

  private func removeNavigationViewController() {
    subscriptions.removeAll()
    guard let controller = navigationViewController else { return }
    navigationViewController = nil
    controller.delegate = nil
    controller.willMove(toParent: nil)
    controller.view.removeFromSuperview()
    controller.removeFromParent()
  }

  private var parentViewController: UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let controller = next as? UIViewController {
        return controller
      }
      responder = next
    }
    return nil
  }
}

extension RNMBXNavigationView: NavigationViewControllerDelegate {
  public func navigationViewController(
    _ navigationViewController: NavigationViewController,
    didUpdate progress: RouteProgress,
    with location: CLLocation,
    rawLocation: CLLocation
  ) {
    onRouteProgress?(RNMBXNavigation.progressEvent(progress))
  }

  public func navigationViewControllerDidDismiss(
    _ navigationViewController: NavigationViewController,
    byCanceling canceled: Bool
  ) {
    guard canceled else { return }
    removeNavigationViewController()
    RNMBXNavigationSession.shared.stop()
    onCancel?()
  }
}

/// Embedded, it isn't presented: the SDK's `dismiss` on arrival would dismiss whatever presented the React root.
private final class RNMBXNavigationViewController: NavigationViewController {
  override func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
    completion?()
  }
}
