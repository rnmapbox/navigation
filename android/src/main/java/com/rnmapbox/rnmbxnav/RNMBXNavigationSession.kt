package com.rnmapbox.rnmbxnav

import com.mapbox.common.location.Location
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.trip.model.RouteProgress

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

  fun stop() {
    location = null
    keyPoints = emptyList()
    updateRoutes(emptyList(), preview = false)
    updateCameraState(RNMBXNavigationCameraState.IDLE)
    listeners.toList().forEach { it.onStopped() }
  }
}
