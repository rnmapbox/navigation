package com.rnmapbox.rnmbxnav

import com.facebook.proguard.annotations.DoNotStrip
import com.mapbox.api.directions.v5.DirectionsCriteria
import com.mapbox.core.constants.Constants
import com.mapbox.geojson.LineString
import com.mapbox.navigation.base.route.NavigationRoute

/**
 * One route of a `requestRoutes` response, held by a JS `Route` host object through an fbjni global ref.
 *
 * [routes] starts with this route, so guidance and preview can use it as is. The summary fields are copied once so
 * the C++ side can cache them without calling back into Kotlin.
 */
@DoNotStrip
class RNMBXNavigationRoute(val routes: List<NavigationRoute>) {
  private val route = routes.first().directionsRoute

  @JvmField @DoNotStrip val distance: Double = route.distance()
  @JvmField @DoNotStrip val expectedTravelTime: Double = route.duration()

  /** Longitude, latitude pairs. */
  @JvmField @DoNotStrip val coordinates: DoubleArray = route.geometry()?.let { geometry ->
    val precision =
      if (route.routeOptions()?.geometries() == DirectionsCriteria.GEOMETRY_POLYLINE) {
        Constants.PRECISION_5
      } else {
        Constants.PRECISION_6
      }
    LineString.fromPolyline(geometry, precision).coordinates()
      .flatMap { listOf(it.longitude(), it.latitude()) }
      .toDoubleArray()
  } ?: DoubleArray(0)

  private val legs = route.legs().orEmpty()
  @JvmField @DoNotStrip val legDistances: DoubleArray = legs.map { it.distance() ?: 0.0 }.toDoubleArray()
  @JvmField @DoNotStrip val legExpectedTravelTimes: DoubleArray = legs.map { it.duration() ?: 0.0 }.toDoubleArray()
  @JvmField @DoNotStrip val legStepCounts: IntArray = legs.map { it.steps()?.size ?: 0 }.toIntArray()
  @JvmField @DoNotStrip val legSummaries: Array<String> = legs.map { it.summary() ?: "" }.toTypedArray()

  /** The steps of every leg in order; [legStepCounts] splits them by leg. */
  private val steps = legs.flatMap { it.steps().orEmpty() }
  @JvmField @DoNotStrip val stepInstructions: Array<String> = steps.map { it.maneuver().instruction() ?: "" }.toTypedArray()
  @JvmField @DoNotStrip val stepDistances: DoubleArray = steps.map { it.distance() }.toDoubleArray()
  @JvmField @DoNotStrip val stepExpectedTravelTimes: DoubleArray = steps.map { it.duration() }.toDoubleArray()
  @JvmField @DoNotStrip val stepManeuverTypes: Array<String> = steps.map { it.maneuver().type() ?: "" }.toTypedArray()
  @JvmField @DoNotStrip val stepManeuverModifiers: Array<String> = steps.map { it.maneuver().modifier() ?: "" }.toTypedArray()
  @JvmField @DoNotStrip val stepNames: Array<String> = steps.map { it.name() ?: "" }.toTypedArray()
}
