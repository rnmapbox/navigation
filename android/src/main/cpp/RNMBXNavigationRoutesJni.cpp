#include "RNMBXNavigationRoutes.h"

#include <ReactCommon/BindingsInstallerHolder.h>
#include <android/log.h>
#include <fbjni/fbjni.h>

namespace rnmbxnav {

namespace {

namespace jni = facebook::jni;

using facebook::react::BindingsInstallerHolder;
using facebook::react::CallInvoker;

struct JRoute : jni::JavaClass<JRoute> {
  static constexpr auto kJavaDescriptor = "Lcom/rnmapbox/rnmbxnav/RNMBXNavigationRoute;";

  RouteData data() const
  {
    static const auto cls = javaClassStatic();
    static const auto distance = cls->getField<jdouble>("distance");
    static const auto expectedTravelTime = cls->getField<jdouble>("expectedTravelTime");
    static const auto coordinates = cls->getField<jni::JArrayDouble::javaobject>("coordinates");
    static const auto legDistances = cls->getField<jni::JArrayDouble::javaobject>("legDistances");
    static const auto legExpectedTravelTimes = cls->getField<jni::JArrayDouble::javaobject>("legExpectedTravelTimes");
    static const auto legStepCounts = cls->getField<jni::JArrayInt::javaobject>("legStepCounts");
    static const auto legSummaries = cls->getField<jni::JArrayClass<jstring>::javaobject>("legSummaries");
    static const auto stepInstructions = cls->getField<jni::JArrayClass<jstring>::javaobject>("stepInstructions");
    static const auto stepDistances = cls->getField<jni::JArrayDouble::javaobject>("stepDistances");
    static const auto stepExpectedTravelTimes = cls->getField<jni::JArrayDouble::javaobject>("stepExpectedTravelTimes");
    static const auto stepManeuverTypes = cls->getField<jni::JArrayClass<jstring>::javaobject>("stepManeuverTypes");
    static const auto stepManeuverModifiers = cls->getField<jni::JArrayClass<jstring>::javaobject>("stepManeuverModifiers");
    static const auto stepNames = cls->getField<jni::JArrayClass<jstring>::javaobject>("stepNames");

    RouteData data;
    data.distance = getFieldValue(distance);
    data.expectedTravelTime = getFieldValue(expectedTravelTime);
    // Each pin must not outlive the array reference it pins.
    auto coordinateArray = getFieldValue(coordinates);
    auto points = coordinateArray->pin();
    data.coordinates.assign(points.get(), points.get() + points.size());
    auto distanceArray = getFieldValue(legDistances);
    auto timeArray = getFieldValue(legExpectedTravelTimes);
    auto stepArray = getFieldValue(legStepCounts);
    auto distances = distanceArray->pin();
    auto times = timeArray->pin();
    auto steps = stepArray->pin();
    auto summaries = getFieldValue(legSummaries);
    auto instructions = getFieldValue(stepInstructions);
    auto stepDistanceArray = getFieldValue(stepDistances);
    auto stepTimeArray = getFieldValue(stepExpectedTravelTimes);
    auto stepDistanceValues = stepDistanceArray->pin();
    auto stepTimeValues = stepTimeArray->pin();
    auto types = getFieldValue(stepManeuverTypes);
    auto modifiers = getFieldValue(stepManeuverModifiers);
    auto names = getFieldValue(stepNames);
    size_t step = 0;
    for (size_t i = 0; i < distances.size(); i++) {
      RouteLeg leg{distances[i], times[i], summaries->getElement(i)->toStdString()};
      for (int j = 0; j < steps[i]; j++, step++) {
        leg.steps.push_back({
            instructions->getElement(step)->toStdString(),
            stepDistanceValues[step],
            stepTimeValues[step],
            types->getElement(step)->toStdString(),
            modifiers->getElement(step)->toStdString(),
            names->getElement(step)->toStdString(),
        });
      }
      data.legs.push_back(std::move(leg));
    }
    return data;
  }
};

class AndroidNativeRoute : public NativeRoute {
 public:
  explicit AndroidNativeRoute(jni::alias_ref<JRoute> route) : route(jni::make_global(route)) {}

  ~AndroidNativeRoute() override
  {
    // The GC can finalize the host object on a thread the JVM doesn't know.
    jni::ThreadScope scope;
    route.reset();
    __android_log_print(ANDROID_LOG_DEBUG, "RNMBXNavigation", "native route released");
  }

  jni::global_ref<JRoute> route;
};

jni::alias_ref<JRoute> unwrap(const std::shared_ptr<NativeRoute> &route)
{
  if (!route) {
    return nullptr;
  }
  return static_cast<AndroidNativeRoute *>(route.get())->route;
}

/// Owned by the Kotlin side between the call and its completion through `RNMBXNavigationNative`.
struct PendingCall {
  std::function<void(std::vector<RouteResult>)> resolveRoutes;
  std::function<void()> resolve;
  RejectCallback reject;
};

jlong toCallback(PendingCall call)
{
  return reinterpret_cast<jlong>(new PendingCall(std::move(call)));
}

std::unique_ptr<PendingCall> fromCallback(jlong callback)
{
  return std::unique_ptr<PendingCall>(reinterpret_cast<PendingCall *>(callback));
}

jni::local_ref<jni::JString> optionalString(const std::optional<std::string> &value)
{
  if (!value) {
    return nullptr;
  }
  return jni::make_jstring(*value);
}

/// Set while JS listens for route changes; `routeChanged` is called on the main thread, the setter on the JS thread.
std::mutex routeChangeMutex;
NavigationPlatform::RouteChangeHandler routeChangeHandler;

struct JModule : jni::JavaClass<JModule> {
  static constexpr auto kJavaDescriptor = "Lcom/rnmapbox/rnmbxnav/RNMBXNavigationModule;";

  static jni::local_ref<BindingsInstallerHolder::javaobject> getBindingsInstaller(jni::alias_ref<JModule> self);
};

class AndroidNavigationPlatform : public NavigationPlatform {
 public:
  explicit AndroidNavigationPlatform(jni::alias_ref<JModule> module) : module_(jni::make_global(module)) {}

  ~AndroidNavigationPlatform() override
  {
    jni::ThreadScope scope;
    module_.reset();
  }

  void requestRoutes(
      const RouteRequest &request,
      std::function<void(std::vector<RouteResult>)> resolve,
      RejectCallback reject) override
  {
    jni::ThreadScope scope;
    static const auto method = JModule::javaClassStatic()->getMethod<void(
        jni::alias_ref<jni::JArrayDouble>,
        jni::alias_ref<jni::JArrayClass<jstring>>,
        jni::alias_ref<jstring>,
        jboolean,
        jni::alias_ref<jni::JArrayClass<jstring>>,
        jni::alias_ref<jstring>,
        jni::alias_ref<jstring>,
        jlong)>("requestRoutesFromJS");

    std::vector<double> flat;
    auto names = jni::JArrayClass<jstring>::newArray(request.waypoints.size());
    for (size_t i = 0; i < request.waypoints.size(); i++) {
      const auto &waypoint = request.waypoints[i];
      flat.push_back(waypoint.longitude);
      flat.push_back(waypoint.latitude);
      if (waypoint.name) {
        names->setElement(i, jni::make_jstring(*waypoint.name).get());
      }
    }
    auto coordinates = jni::JArrayDouble::newArray(flat.size());
    coordinates->setRegion(0, flat.size(), flat.data());
    auto exclude = jni::JArrayClass<jstring>::newArray(request.exclude.size());
    for (size_t i = 0; i < request.exclude.size(); i++) {
      exclude->setElement(i, jni::make_jstring(request.exclude[i]).get());
    }
    auto optional = [](const std::optional<std::string> &value) -> jni::local_ref<jni::JString> {
      if (!value) {
        return nullptr;
      }
      return jni::make_jstring(*value);
    };
    method(
        module_,
        coordinates,
        names,
        jni::make_jstring(request.profile),
        static_cast<jboolean>(request.alternatives),
        exclude,
        optional(request.language),
        optional(request.units),
        toCallback({std::move(resolve), nullptr, std::move(reject)}));
  }

  void requestMatchedRoutes(
      const MatchRequest &request,
      std::function<void(std::vector<RouteResult>)> resolve,
      RejectCallback reject) override
  {
    jni::ThreadScope scope;
    static const auto method = JModule::javaClassStatic()->getMethod<void(
        jni::alias_ref<jni::JArrayDouble>,
        jni::alias_ref<jstring>,
        jni::alias_ref<jni::JArrayInt>,
        jni::alias_ref<jni::JArrayDouble>,
        jni::alias_ref<jstring>,
        jni::alias_ref<jstring>,
        jlong)>("requestMatchedRoutesFromJS");

    auto coordinates = jni::JArrayDouble::newArray(request.coordinates.size());
    coordinates->setRegion(0, request.coordinates.size(), request.coordinates.data());
    auto waypointIndices = jni::JArrayInt::newArray(request.waypointIndices.size());
    waypointIndices->setRegion(0, request.waypointIndices.size(), request.waypointIndices.data());
    auto radiuses = jni::JArrayDouble::newArray(request.radiuses.size());
    radiuses->setRegion(0, request.radiuses.size(), request.radiuses.data());
    method(
        module_,
        coordinates,
        jni::make_jstring(request.profile),
        waypointIndices,
        radiuses,
        optionalString(request.language),
        optionalString(request.units),
        toCallback({std::move(resolve), nullptr, std::move(reject)}));
  }

  void startActiveGuidance(
      const std::shared_ptr<NativeRoute> &route,
      bool simulate,
      std::function<void()> resolve,
      RejectCallback reject) override
  {
    jni::ThreadScope scope;
    static const auto method =
        JModule::javaClassStatic()->getMethod<void(jni::alias_ref<JRoute>, jboolean, jlong)>("startActiveGuidanceFromJS");
    method(module_, unwrap(route), static_cast<jboolean>(simulate), toCallback({nullptr, std::move(resolve), std::move(reject)}));
  }

  void previewRoute(const std::shared_ptr<NativeRoute> &route) override
  {
    jni::ThreadScope scope;
    static const auto method = JModule::javaClassStatic()->getMethod<void(jni::alias_ref<JRoute>)>("previewRouteFromJS");
    method(module_, unwrap(route));
  }

  void setRouteChangeHandler(RouteChangeHandler handler) override
  {
    std::lock_guard lock(routeChangeMutex);
    routeChangeHandler = std::move(handler);
  }

 private:
  jni::global_ref<JModule> module_;
};

jni::local_ref<BindingsInstallerHolder::javaobject> JModule::getBindingsInstaller(jni::alias_ref<JModule> self)
{
  return BindingsInstallerHolder::newObjectCxxArgs(
      [module = jni::make_global(self)](jsi::Runtime &runtime, const std::shared_ptr<CallInvoker> &callInvoker) {
        install(runtime, callInvoker, std::make_shared<AndroidNavigationPlatform>(module));
      });
}

struct JNative : jni::JavaClass<JNative> {
  static constexpr auto kJavaDescriptor = "Lcom/rnmapbox/rnmbxnav/RNMBXNavigationNative;";

  static void resolveRoutes(jni::alias_ref<jclass>, jlong callback, jni::alias_ref<jni::JArrayClass<JRoute::javaobject>> routes)
  {
    auto call = fromCallback(callback);
    std::vector<RouteResult> results;
    for (size_t i = 0; i < routes->size(); i++) {
      auto route = routes->getElement(i);
      results.push_back({route->data(), std::make_shared<AndroidNativeRoute>(route)});
    }
    call->resolveRoutes(std::move(results));
  }

  static void resolve(jni::alias_ref<jclass>, jlong callback)
  {
    fromCallback(callback)->resolve();
  }

  static void reject(jni::alias_ref<jclass>, jlong callback, jni::alias_ref<jstring> code, jni::alias_ref<jstring> message)
  {
    fromCallback(callback)->reject(code->toStdString(), message->toStdString());
  }

  static void routeChanged(jni::alias_ref<jclass>, jni::alias_ref<JRoute> route, jni::alias_ref<jstring> reason)
  {
    NavigationPlatform::RouteChangeHandler handler;
    {
      std::lock_guard lock(routeChangeMutex);
      handler = routeChangeHandler;
    }
    if (handler) {
      handler({route->data(), std::make_shared<AndroidNativeRoute>(route)}, reason->toStdString());
    }
  }

  static jni::local_ref<JRoute> findRoute(jni::alias_ref<jclass>, jdouble id)
  {
    return jni::make_local(unwrap(rnmbxnav::findRoute(id)));
  }
};

} // namespace

} // namespace rnmbxnav

JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *)
{
  return facebook::jni::initialize(vm, [] {
    rnmbxnav::JModule::javaClassStatic()->registerNatives({
        makeNativeMethod("getBindingsInstaller", rnmbxnav::JModule::getBindingsInstaller),
    });
    rnmbxnav::JNative::javaClassStatic()->registerNatives({
        makeNativeMethod("resolveRoutes", rnmbxnav::JNative::resolveRoutes),
        makeNativeMethod("resolve", rnmbxnav::JNative::resolve),
        makeNativeMethod("reject", rnmbxnav::JNative::reject),
        makeNativeMethod("routeChanged", rnmbxnav::JNative::routeChanged),
        makeNativeMethod("findRoute", rnmbxnav::JNative::findRoute),
    });
  });
}
