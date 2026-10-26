package com.rnmapbox.rnmbxnav

import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.turbomodule.core.interfaces.BindingsInstallerHolder
import com.facebook.react.turbomodule.core.interfaces.TurboModuleWithJSIBindings
import com.mapbox.api.directions.v5.models.BannerComponents
import com.mapbox.api.directions.v5.models.RouteOptions
import com.mapbox.common.MapboxOptions
import com.mapbox.geojson.Point
import com.mapbox.navigation.base.extensions.applyDefaultNavigationOptions
import com.mapbox.navigation.base.formatter.DistanceFormatterOptions
import com.mapbox.navigation.base.formatter.UnitType
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.route.NavigationRouterCallback
import com.mapbox.navigation.base.route.RouterFailure
import com.mapbox.navigation.base.speed.model.SpeedLimitSign
import com.mapbox.navigation.base.speed.model.SpeedUnit
import com.mapbox.navigation.base.trip.model.RouteProgress
import com.mapbox.navigation.core.trip.session.LocationMatcherResult

class RNMBXNavigationModule(reactContext: ReactApplicationContext) :
  NativeRNMBXNavigationModuleSpec(reactContext), TurboModuleWithJSIBindings {

  // Read on the JS thread; the session is main thread only.
  @Volatile private var voiceMuted = false

  init {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.cameraStateObserver = { state ->
        emitOnCameraStateChange(Arguments.createMap().apply { putString("state", state.jsName) })
      }
      RNMBXNavigationSession.routeProgressObserver = { progress -> emitOnRouteProgress(routeProgressEvent(progress)) }
      RNMBXNavigationSession.locationMatcherObserver = { result -> emitOnLocationChange(locationEvent(result)) }
      RNMBXNavigationSession.arrivalObserver = { waypointIndex, isFinalDestination ->
        emitOnArrive(Arguments.createMap().apply {
          putInt("waypointIndex", waypointIndex)
          putBoolean("isFinalDestination", isFinalDestination)
        })
      }
      RNMBXNavigationSession.offRouteObserver = { offRoute ->
        emitOnOffRouteChange(Arguments.createMap().apply { putBoolean("offRoute", offRoute) })
      }
      RNMBXNavigationSession.voiceInstructionObserver = { instructions ->
        emitOnVoiceInstruction(Arguments.createMap().apply {
          putString("text", instructions.announcement() ?: "")
          putString("ssml", instructions.ssmlAnnouncement() ?: "")
          putDouble("distanceAlongStep", instructions.distanceAlongGeometry() ?: 0.0)
        })
      }
      RNMBXNavigationSession.routeChangeObserver = { routes, reason ->
        RNMBXNavigationNative.routeChanged(RNMBXNavigationRoute(routes), reason)
      }
    }
  }

  override fun setAccessToken(accessToken: String) {
    MapboxOptions.accessToken = accessToken
  }

  override fun getSdkVersion(): String = com.mapbox.navigation.core.BuildConfig.MAPBOX_NAVIGATION_VERSION_NAME

  override fun getDefaultDistanceUnit(): String =
    when (DistanceFormatterOptions.Builder(reactApplicationContext).build().unitType) {
      UnitType.IMPERIAL -> "imperial"
      UnitType.METRIC -> "metric"
    }

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
      val navigation = RNMBXNavigationSession.mapboxNavigation(reactApplicationContext)
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
  fun startActiveGuidanceFromJS(route: RNMBXNavigationRoute, simulate: Boolean, callback: Long) {
    UiThreadUtil.runOnUiThread {
      val navigation = RNMBXNavigationSession.mapboxNavigation(reactApplicationContext)
      if (navigation == null) {
        RNMBXNavigationNative.reject(callback, "no_access_token", "Call Navigation.setAccessToken before using navigation")
        return@runOnUiThread
      }
      try {
        RNMBXNavigationSession.startActiveGuidance(navigation, route, simulate)
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
    UiThreadUtil.runOnUiThread { RNMBXNavigationSession.stopNavigation() }
  }

  override fun setCameraState(state: String) {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.updateCameraState(
        RNMBXNavigationCameraState.entries.find { it.jsName == state } ?: RNMBXNavigationCameraState.IDLE
      )
    }
  }

  override fun getCameraState(): String = RNMBXNavigationSession.cameraState.jsName

  override fun setVoiceMuted(muted: Boolean) {
    voiceMuted = muted
    UiThreadUtil.runOnUiThread { RNMBXNavigationSession.voiceMuted = muted }
  }

  override fun isVoiceMuted(): Boolean = voiceMuted

  override fun isCarPlayConnected(): Boolean = false

  override fun invalidate() {
    UiThreadUtil.runOnUiThread {
      RNMBXNavigationSession.cameraStateObserver = null
      RNMBXNavigationSession.routeProgressObserver = null
      RNMBXNavigationSession.locationMatcherObserver = null
      RNMBXNavigationSession.arrivalObserver = null
      RNMBXNavigationSession.offRouteObserver = null
      RNMBXNavigationSession.voiceInstructionObserver = null
      RNMBXNavigationSession.routeChangeObserver = null
      RNMBXNavigationSession.stopNavigation()
    }
    super.invalidate()
  }

  companion object {
    const val NAME = NativeRNMBXNavigationModuleSpec.NAME

    init {
      System.loadLibrary("rnmbxnav")
    }
  }
}

fun routeProgressEvent(progress: RouteProgress): WritableMap {
  val stepProgress = progress.currentLegProgress?.currentStepProgress
  val banner = progress.bannerInstructions?.primary()
  val upcomingManeuver = progress.currentLegProgress?.upcomingStep?.maneuver()
  val sub = progress.bannerInstructions?.sub()
  val lanes = sub?.components().orEmpty().filter { it.type() == BannerComponents.LANE }
  return Arguments.createMap().apply {
    putArray("maneuverComponents", bannerComponents(banner?.components()))
    putArray("secondaryComponents", bannerComponents(progress.bannerInstructions?.secondary()?.components()))
    putString("secondaryInstruction", progress.bannerInstructions?.secondary()?.text() ?: "")
    putString("subInstruction", if (lanes.isEmpty()) sub?.text() ?: "" else "")
    putArray("lanes", Arguments.createArray().apply {
      for (lane in lanes) {
        val valid = lane.active() == true
        pushMap(Arguments.createMap().apply {
          putArray("indications", Arguments.fromList(lane.directions().orEmpty()))
          putBoolean("valid", valid)
          putString("activeDirection", if (valid) lane.activeDirection() ?: "" else "")
        })
      }
    })
    putInt("legIndex", progress.currentLegProgress?.legIndex ?: 0)
    putInt("stepIndex", stepProgress?.stepIndex ?: 0)
    putDouble("distanceRemaining", progress.distanceRemaining.toDouble())
    putDouble("distanceTraveled", progress.distanceTraveled.toDouble())
    putDouble("durationRemaining", progress.durationRemaining)
    putDouble("fractionTraveled", progress.fractionTraveled.toDouble())
    putDouble("stepDistanceRemaining", stepProgress?.distanceRemaining?.toDouble() ?: 0.0)
    putString("maneuverInstruction", banner?.text() ?: upcomingManeuver?.instruction() ?: "")
    putString("maneuverType", banner?.type() ?: upcomingManeuver?.type() ?: "")
    putString("maneuverModifier", banner?.modifier() ?: upcomingManeuver?.modifier() ?: "")
  }
}

private val BANNER_COMPONENT_TYPES = setOf(
  BannerComponents.TEXT,
  BannerComponents.ICON,
  BannerComponents.DELIMITER,
  BannerComponents.EXIT,
  BannerComponents.EXIT_NUMBER,
)

private fun bannerComponents(components: List<BannerComponents>?): WritableArray =
  Arguments.createArray().apply {
    for (component in components.orEmpty()) {
      if (component.type() !in BANNER_COMPONENT_TYPES) continue
      pushMap(Arguments.createMap().apply {
        putString("type", component.type())
        putString("text", component.text())
        putString("imageUrl", component.imageBaseUrl()?.let { "$it@3x.png" } ?: "")
      })
    }
  }

fun locationEvent(result: LocationMatcherResult): WritableMap {
  val location = result.enhancedLocation
  return Arguments.createMap().apply {
    putDouble("latitude", location.latitude)
    putDouble("longitude", location.longitude)
    putDouble("speed", location.speed ?: -1.0)
    putDouble("course", location.bearing ?: -1.0)
    putString("roadName", result.road.components.joinToString(" / ") { it.text })
    val limit = result.speedLimitInfo
    val speed = limit.speed
    if (speed != null) {
      putMap("speedLimit", Arguments.createMap().apply {
        putDouble("speed", speed.toDouble())
        putString("unit", if (limit.unit == SpeedUnit.MILES_PER_HOUR) "mph" else "km/h")
        putString("sign", if (limit.sign == SpeedLimitSign.MUTCD) "mutcd" else "vienna")
      })
    }
  }
}
