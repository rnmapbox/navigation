package com.rnmapbox.rnmbxnav

import android.content.Context
import com.mapbox.common.MapboxOptions
import com.mapbox.common.location.Location
import com.mapbox.navigation.base.ExperimentalPreviewMapboxNavigationAPI
import com.mapbox.navigation.base.options.NavigationOptions
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.trip.model.RouteProgress
import com.mapbox.navigation.core.MapboxNavigation
import com.mapbox.navigation.core.MapboxNavigationProvider
import com.mapbox.navigation.core.directions.session.RoutesObserver
import com.mapbox.navigation.core.replay.route.ReplayRouteMapper
import com.mapbox.navigation.core.trip.session.LocationMatcherResult
import com.mapbox.navigation.core.trip.session.LocationObserver
import com.mapbox.navigation.core.trip.session.RouteProgressObserver

enum class RNMBXNavigationCameraState(val jsName: String) {
  FOLLOWING("following"),
  OVERVIEW("overview"),
  IDLE("idle"),
}

/**
 * Process-wide navigation state shared by the TurboModule and every adopted map. Listeners get the current
 * state replayed when they're added, so a map that attaches mid-guidance catches up. Main thread only.
 */
object RNMBXNavigationSession {
  interface Listener {
    fun onLocation(location: Location, keyPoints: List<Location>)
    fun onRoutes(routes: List<NavigationRoute>, preview: Boolean)
    fun onRouteProgress(progress: RouteProgress)
    fun onCameraState(state: RNMBXNavigationCameraState)
    fun onStopped()
  }

  private val listeners = mutableSetOf<Listener>()

  /** Called on every camera state change, from JS, guidance or a map gesture. */
  var cameraStateObserver: ((RNMBXNavigationCameraState) -> Unit)? = null

  var routeProgressObserver: ((RouteProgress) -> Unit)? = null

  /** Kept until navigation stops, whether or not JS releases its `Route`. */
  private var guidanceRoute: RNMBXNavigationRoute? = null
  private var guidanceStart: Any? = null
  private var simulating = false

  private val navigationRouteProgressObserver = RouteProgressObserver { progress ->
    updateRouteProgress(progress)
    routeProgressObserver?.invoke(progress)
  }

  private val locationObserver = object : LocationObserver {
    override fun onNewRawLocation(rawLocation: Location) = Unit

    override fun onNewLocationMatcherResult(locationMatcherResult: LocationMatcherResult) {
      updateLocation(locationMatcherResult.enhancedLocation, locationMatcherResult.keyPoints)
    }
  }

  private val routesObserver = RoutesObserver { result ->
    updateRoutes(result.navigationRoutes, preview = false)
  }

  private var location: Location? = null
  private var keyPoints: List<Location> = emptyList()
  private var routes: List<NavigationRoute> = emptyList()
  private var preview = false
  var cameraState = RNMBXNavigationCameraState.IDLE
    private set

  fun addListener(listener: Listener) {
    if (!listeners.add(listener)) return
    location?.let { listener.onLocation(it, keyPoints) }
    if (routes.isNotEmpty()) listener.onRoutes(routes, preview)
    listener.onCameraState(cameraState)
  }

  fun removeListener(listener: Listener) {
    listeners.remove(listener)
  }

  fun updateLocation(location: Location, keyPoints: List<Location>) {
    this.location = location
    this.keyPoints = keyPoints
    listeners.toList().forEach { it.onLocation(location, keyPoints) }
  }

  fun updateRoutes(routes: List<NavigationRoute>, preview: Boolean) {
    this.routes = routes
    this.preview = preview
    listeners.toList().forEach { it.onRoutes(routes, preview) }
  }

  fun updateRouteProgress(progress: RouteProgress) {
    listeners.toList().forEach { it.onRouteProgress(progress) }
  }

  fun updateCameraState(state: RNMBXNavigationCameraState) {
    if (state == cameraState) return
    cameraState = state
    listeners.toList().forEach { it.onCameraState(state) }
    cameraStateObserver?.invoke(state)
  }

  /** The SDK allows one `MapboxNavigation` per process; it outlives JS reloads. Null without an access token. */
  fun mapboxNavigation(context: Context): MapboxNavigation? {
    if (MapboxNavigationProvider.isCreated()) {
      return MapboxNavigationProvider.retrieve()
    }
    if (MapboxOptions.accessToken.isEmpty()) {
      return null
    }
    return MapboxNavigationProvider.create(NavigationOptions.Builder(context.applicationContext).build())
  }

  /** Throws [SecurityException] without location permission unless simulating. */
  @OptIn(ExperimentalPreviewMapboxNavigationAPI::class)
  fun startActiveGuidance(navigation: MapboxNavigation, route: RNMBXNavigationRoute, simulate: Boolean) {
    unregisterObservers(navigation)
    navigation.registerRouteProgressObserver(navigationRouteProgressObserver)
    navigation.registerLocationObserver(locationObserver)
    navigation.registerRoutesObserver(routesObserver)
    guidanceRoute = route
    val start = Any()
    guidanceStart = start
    if (simulate) {
      // No foreground service: it needs runtime location permission, which simulation doesn't.
      navigation.startReplayTripSession(withForegroundService = false)
      navigation.mapboxReplayer.stop()
      navigation.mapboxReplayer.clearEvents()
    } else {
      navigation.startTripSession()
    }
    simulating = simulate
    updateCameraState(RNMBXNavigationCameraState.FOLLOWING)
    // Otherwise the navigator first matches the new route against the previous session's extrapolated location.
    navigation.resetTripSession {
      if (guidanceStart !== start) return@resetTripSession
      navigation.setNavigationRoutes(route.routes)
      if (simulate) {
        navigation.mapboxReplayer.run {
          pushEvents(ReplayRouteMapper().mapDirectionsRouteGeometry(route.routes.first().directionsRoute))
          seekTo(0.0)
          play()
        }
      }
    }
  }

  @OptIn(ExperimentalPreviewMapboxNavigationAPI::class)
  fun stopNavigation() {
    guidanceRoute = null
    guidanceStart = null
    if (MapboxNavigationProvider.isCreated()) {
      val navigation = MapboxNavigationProvider.retrieve()
      unregisterObservers(navigation)
      if (simulating) {
        navigation.mapboxReplayer.stop()
        navigation.mapboxReplayer.clearEvents()
        simulating = false
      }
      navigation.setNavigationRoutes(emptyList())
      navigation.stopTripSession()
    }
    stop()
  }

  private fun unregisterObservers(navigation: MapboxNavigation) {
    navigation.unregisterRouteProgressObserver(navigationRouteProgressObserver)
    navigation.unregisterLocationObserver(locationObserver)
    navigation.unregisterRoutesObserver(routesObserver)
  }

  private fun stop() {
    location = null
    keyPoints = emptyList()
    updateRoutes(emptyList(), preview = false)
    updateCameraState(RNMBXNavigationCameraState.IDLE)
    listeners.toList().forEach { it.onStopped() }
  }
}
