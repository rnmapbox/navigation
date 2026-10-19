package com.rnmapbox.rnmbxnav

import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.turbomodule.core.interfaces.BindingsInstallerHolder
import com.facebook.react.turbomodule.core.interfaces.TurboModuleWithJSIBindings
import com.mapbox.api.directions.v5.models.RouteOptions
import com.mapbox.common.MapboxOptions
import com.mapbox.common.location.Location
import com.mapbox.geojson.Point
import com.mapbox.navigation.base.ExperimentalPreviewMapboxNavigationAPI
import com.mapbox.navigation.base.extensions.applyDefaultNavigationOptions
import com.mapbox.navigation.base.options.NavigationOptions
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.route.NavigationRouterCallback
import com.mapbox.navigation.base.route.RouterFailure
import com.mapbox.navigation.core.MapboxNavigation
import com.mapbox.navigation.core.MapboxNavigationProvider
import com.mapbox.navigation.core.replay.route.ReplayRouteMapper
import com.mapbox.navigation.core.directions.session.RoutesObserver
import com.mapbox.navigation.core.trip.session.LocationMatcherResult
import com.mapbox.navigation.core.trip.session.LocationObserver
import com.mapbox.navigation.core.trip.session.RouteProgressObserver

class RNMBXNavigationModule(reactContext: ReactApplicationContext) :
  NativeRNMBXNavigationModuleSpec(reactContext), TurboModuleWithJSIBindings {

  /** Guidance keeps its route until `stopNavigation`, whether or not JS releases its `Route`. */
  private var guidanceRoute: RNMBXNavigationRoute? = null
  private var simulating = false

  private val routeProgressObserver = RouteProgressObserver { progress ->
    RNMBXNavigationSession.updateRouteProgress(progress)
    val stepProgress = progress.currentLegProgress?.currentStepProgress
    val banner = progress.bannerInstructions?.primary()
    val upcomingManeuver = progress.currentLegProgress?.upcomingStep?.maneuver()
    emitOnRouteProgress(
      Arguments.createMap().apply {
        putDouble("distanceRemaining", progress.distanceRemaining.toDouble())
        putDouble("distanceTraveled", progress.distanceTraveled.toDouble())
        putDouble("durationRemaining", progress.durationRemaining)
        putDouble("fractionTraveled", progress.fractionTraveled.toDouble())
        putDouble("stepDistanceRemaining", stepProgress?.distanceRemaining?.toDouble() ?: 0.0)
        putString("maneuverInstruction", banner?.text() ?: upcomingManeuver?.instruction() ?: "")
        putString("maneuverType", banner?.type() ?: upcomingManeuver?.type() ?: "")
        putString("maneuverModifier", banner?.modifier() ?: upcomingManeuver?.modifier() ?: "")
      }
    )
  }

  private val locationObserver = object : LocationObserver {
    override fun onNewRawLocation(rawLocation: Location) = Unit

    override fun onNewLocationMatcherResult(locationMatcherResult: LocationMatcherResult) {
      RNMBXNavigationSession.updateLocation(
        locationMatcherResult.enhancedLocation,
        locationMatcherResult.keyPoints
      )
    }
  }

  private val routesObserver = RoutesObserver { result ->
    RNMBXNavigationSession.updateRoutes(result.navigationRoutes, preview = false)
  }

  init {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.cameraStateObserver = { state ->
        emitOnCameraStateChange(Arguments.createMap().apply { putString("state", state.jsName) })
      }
    }
  }

  override fun setAccessToken(accessToken: String) {
    MapboxOptions.accessToken = accessToken
  }

  override fun getSdkVersion(): String = com.mapbox.navigation.core.BuildConfig.MAPBOX_NAVIGATION_VERSION_NAME

  @DoNotStrip
  external override fun getBindingsInstaller(): BindingsInstallerHolder

  /** Called by the C++ route bindings; see `RouteRequest` in cpp/RNMBXNavigationRoutes.h. */
  @DoNotStrip
  fun requestRoutesFromJS(
    coordinates: DoubleArray,
    names: Array<String?>,
    profile: String,
    alternatives: Boolean,
    exclude: Array<String>,
    language: String?,
    units: String?,
    callback: Long
  ) {
    val points = (0 until coordinates.size / 2).map { Point.fromLngLat(coordinates[2 * it], coordinates[2 * it + 1]) }
    if (points.size < 2) {
      RNMBXNavigationNative.reject(callback, "invalid_waypoints", "requestRoutes needs at least an origin and a destination")
      return
    }
    val options = RouteOptions.builder()
      .applyDefaultNavigationOptions(profile)
      .coordinatesList(points)
      .alternatives(alternatives)
      .apply {
        if (names.any { it != null }) waypointNamesList(names.map { it ?: "" })
        if (exclude.isNotEmpty()) excludeList(exclude.toList())
        language?.let { language(it) }
        units?.let { voiceUnits(it) }
      }
      .build()

    UiThreadUtil.runOnUiThread {
      val navigation = mapboxNavigation()
      if (navigation == null) {
        RNMBXNavigationNative.reject(callback, "no_access_token", "Call Navigation.setAccessToken before using navigation")
        return@runOnUiThread
      }
      navigation.requestRoutes(
        options,
        object : NavigationRouterCallback {
          override fun onRoutesReady(routes: List<NavigationRoute>, routerOrigin: String) {
            RNMBXNavigationNative.resolveRoutes(
              callback,
              routes.indices.map { index ->
                RNMBXNavigationRoute(listOf(routes[index]) + routes.filterIndexed { other, _ -> other != index })
              }.toTypedArray()
            )
          }

          override fun onFailure(reasons: List<RouterFailure>, routeOptions: RouteOptions) {
            RNMBXNavigationNative.reject(callback, "route_request_failed", reasons.joinToString { it.message })
          }

          override fun onCanceled(routeOptions: RouteOptions, routerOrigin: String) {
            RNMBXNavigationNative.reject(callback, "route_request_canceled", "Route request was canceled")
          }
        }
      )
    }
  }

  @DoNotStrip
  @OptIn(ExperimentalPreviewMapboxNavigationAPI::class)
  fun startActiveGuidanceFromJS(route: RNMBXNavigationRoute, simulate: Boolean, callback: Long) {
    UiThreadUtil.runOnUiThread {
      val navigation = mapboxNavigation()
      if (navigation == null) {
        RNMBXNavigationNative.reject(callback, "no_access_token", "Call Navigation.setAccessToken before using navigation")
        return@runOnUiThread
      }
      try {
        registerObservers(navigation)
        guidanceRoute = route
        navigation.setNavigationRoutes(route.routes)
        if (simulate) {
          // No foreground service: it needs runtime location permission, which simulation doesn't.
          navigation.startReplayTripSession(withForegroundService = false)
          navigation.mapboxReplayer.run {
            stop()
            clearEvents()
            pushEvents(ReplayRouteMapper().mapDirectionsRouteGeometry(route.routes.first().directionsRoute))
            seekTo(0.0)
            play()
          }
        } else {
          navigation.startTripSession()
        }
        simulating = simulate
        RNMBXNavigationSession.updateCameraState(RNMBXNavigationCameraState.FOLLOWING)
        RNMBXNavigationNative.resolve(callback)
      } catch (e: SecurityException) {
        RNMBXNavigationNative.reject(callback, "start_failed", e.message ?: e.toString())
      }
    }
  }

  /** Shows [route] on navigation maps until guidance starts or stops; `null` removes it. */
  @DoNotStrip
  fun previewRouteFromJS(route: RNMBXNavigationRoute?) {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.updateRoutes(route?.routes.orEmpty(), preview = true)
    }
  }

  override fun stopNavigation() {
    UiThreadUtil.runOnUiThread { stopNavigationOnMain() }
  }

  override fun setCameraState(state: String) {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.updateCameraState(
        RNMBXNavigationCameraState.entries.find { it.jsName == state } ?: RNMBXNavigationCameraState.IDLE
      )
    }
  }

  override fun getCameraState(): String = RNMBXNavigationSession.cameraState.jsName

  override fun invalidate() {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.cameraStateObserver = null
      stopNavigationOnMain()
    }
    super.invalidate()
  }

  private fun registerObservers(navigation: MapboxNavigation) {
    unregisterObservers(navigation)
    navigation.registerRouteProgressObserver(routeProgressObserver)
    navigation.registerLocationObserver(locationObserver)
    navigation.registerRoutesObserver(routesObserver)
  }

  private fun unregisterObservers(navigation: MapboxNavigation) {
    navigation.unregisterRouteProgressObserver(routeProgressObserver)
    navigation.unregisterLocationObserver(locationObserver)
    navigation.unregisterRoutesObserver(routesObserver)
  }

  @OptIn(ExperimentalPreviewMapboxNavigationAPI::class)
  private fun stopNavigationOnMain() {
    guidanceRoute = null
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
    RNMBXNavigationSession.stop()
  }

  /** The SDK allows one `MapboxNavigation` per process; it outlives JS reloads. */
  private fun mapboxNavigation(): MapboxNavigation? {
    if (MapboxNavigationProvider.isCreated()) {
      return MapboxNavigationProvider.retrieve()
    }
    if (MapboxOptions.accessToken.isEmpty()) {
      return null
    }
    return MapboxNavigationProvider.create(NavigationOptions.Builder(reactApplicationContext).build())
  }

  companion object {
    const val NAME = NativeRNMBXNavigationModuleSpec.NAME

    init {
      System.loadLibrary("rnmbxnav")
    }
  }
}
