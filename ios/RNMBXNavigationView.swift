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
    didSet { voiceController?.speechSynthesizer.muted = mute }
  }

  @objc public var route: RNMBXNavigationRoute? {
    didSet {
      if route !== oldValue { scheduleGuidance() }
    }
  }

  private var navigationViewController: RNMBXNavigationViewController?
  private var voiceController: RouteVoiceController? {
    RNMBXNavigationSession.shared.provider?.routeVoiceController
  }

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
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guidanceScheduled = false
      startGuidance()
    }
  }

  private func startGuidance() {
    guard let route, window != nil, !invalidated else { return }
    let session = RNMBXNavigationSession.shared
    let navigation: MapboxNavigation
    do {
      navigation = try session.prepareActiveGuidance(route, simulate: simulate)
    } catch {
      onError?(["code": "start_failed", "message": error.localizedDescription])
      return
    }
    Task { @MainActor [weak self] in
      guard let self else { return }
      voiceController?.speechSynthesizer.muted = mute
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
      eventsManager: provider.eventsManager()
    )
    let controller = RNMBXNavigationViewController(navigationRoutes: route.routes, navigationOptions: options)
    controller.delegate = self
    parent.addChild(controller)
    controller.view.frame = bounds
    addSubview(controller.view)
    controller.didMove(toParent: parent)
    // The end of route feedback asks for a rating, which apps embedding the view rarely want.
    controller.showsEndOfRouteFeedback = false
    navigationViewController = controller

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
