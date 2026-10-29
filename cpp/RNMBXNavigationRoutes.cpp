#include "RNMBXNavigationRoutes.h"

#include <unordered_map>

namespace rnmbxnav {

namespace {

jsi::Object makeError(jsi::Runtime &runtime, const std::string &code, const std::string &message)
{
  auto error = runtime.global().getPropertyAsFunction(runtime, "Error").callAsConstructor(runtime, message).asObject(runtime);
  error.setProperty(runtime, "code", code);
  return error;
}

[[noreturn]] void throwReleased(jsi::Runtime &runtime)
{
  throw jsi::JSError(runtime, jsi::Value(runtime, makeError(runtime, "route_released", "Route was released")));
}

std::optional<std::string> optionalString(jsi::Runtime &runtime, const jsi::Object &object, const char *name)
{
  auto value = object.getProperty(runtime, name);
  if (value.isUndefined() || value.isNull()) {
    return std::nullopt;
  }
  return value.asString(runtime).utf8(runtime);
}

RouteRequest parseRequest(jsi::Runtime &runtime, const jsi::Value &value)
{
  auto options = value.asObject(runtime);
  RouteRequest request;
  auto waypoints = options.getPropertyAsObject(runtime, "waypoints").asArray(runtime);
  for (size_t i = 0; i < waypoints.size(runtime); i++) {
    auto waypoint = waypoints.getValueAtIndex(runtime, i).asObject(runtime);
    request.waypoints.push_back({
        waypoint.getProperty(runtime, "longitude").asNumber(),
        waypoint.getProperty(runtime, "latitude").asNumber(),
        optionalString(runtime, waypoint, "name"),
    });
  }
  if (auto profile = optionalString(runtime, options, "profile")) {
    request.profile = *profile;
  }
  auto alternatives = options.getProperty(runtime, "alternatives");
  request.alternatives = alternatives.isBool() && alternatives.getBool();
  auto exclude = options.getProperty(runtime, "exclude");
  if (exclude.isObject()) {
    auto array = exclude.asObject(runtime).asArray(runtime);
    for (size_t i = 0; i < array.size(runtime); i++) {
      request.exclude.push_back(array.getValueAtIndex(runtime, i).asString(runtime).utf8(runtime));
    }
  }
  request.language = optionalString(runtime, options, "language");
  request.units = optionalString(runtime, options, "units");
  return request;
}

std::vector<double> numbers(jsi::Runtime &runtime, const jsi::Object &object, const char *name)
{
  std::vector<double> result;
  auto value = object.getProperty(runtime, name);
  if (!value.isObject()) {
    return result;
  }
  auto array = value.asObject(runtime).asArray(runtime);
  for (size_t i = 0; i < array.size(runtime); i++) {
    result.push_back(array.getValueAtIndex(runtime, i).asNumber());
  }
  return result;
}

MatchRequest parseMatchRequest(jsi::Runtime &runtime, const jsi::Value &value)
{
  auto options = value.asObject(runtime);
  MatchRequest request;
  auto coordinates = options.getPropertyAsObject(runtime, "coordinates").asArray(runtime);
  for (size_t i = 0; i < coordinates.size(runtime); i++) {
    auto position = coordinates.getValueAtIndex(runtime, i).asObject(runtime).asArray(runtime);
    request.coordinates.push_back(position.getValueAtIndex(runtime, 0).asNumber());
    request.coordinates.push_back(position.getValueAtIndex(runtime, 1).asNumber());
  }
  if (auto profile = optionalString(runtime, options, "profile")) {
    request.profile = *profile;
  }
  for (auto index : numbers(runtime, options, "waypointIndices")) {
    request.waypointIndices.push_back(static_cast<int>(index));
  }
  request.radiuses = numbers(runtime, options, "radiuses");
  request.language = optionalString(runtime, options, "language");
  request.units = optionalString(runtime, options, "units");
  return request;
}

std::shared_ptr<RouteHostObject> unwrapRoute(jsi::Runtime &runtime, const jsi::Value &value)
{
  if (value.isObject()) {
    auto object = value.getObject(runtime);
    if (object.isHostObject<RouteHostObject>(runtime)) {
      return object.getHostObject<RouteHostObject>(runtime);
    }
  }
  throw jsi::JSError(runtime, "Expected a Route from requestRoutes");
}

jsi::Value makeRoute(jsi::Runtime &runtime, RouteResult result);

/// Holds the resolve and reject functions of pending promises. It's owned by the installed host functions, so it's
/// destroyed with the runtime; platform callbacks only keep a weak reference and are dropped after a reload.
class Bindings : public std::enable_shared_from_this<Bindings> {
 public:
  Bindings(std::shared_ptr<facebook::react::CallInvoker> callInvoker, std::shared_ptr<NavigationPlatform> platform)
      : callInvoker_(std::move(callInvoker)), platform_(std::move(platform))
  {
  }

  NavigationPlatform &platform()
  {
    return *platform_;
  }

  using Settle = std::function<void(jsi::Runtime &, const jsi::Function &resolve, const jsi::Function &reject)>;

  /// `start` receives the id to pass to `settle`.
  jsi::Value makePromise(jsi::Runtime &runtime, std::function<void(uint64_t id)> start)
  {
    auto executor = jsi::Function::createFromHostFunction(
        runtime,
        jsi::PropNameID::forAscii(runtime, "executor"),
        2,
        [self = shared_from_this(), start = std::move(start)](
            jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t) -> jsi::Value {
          auto id = self->nextId_++;
          self->pending_.emplace(
              id, Pending{args[0].asObject(runtime).asFunction(runtime), args[1].asObject(runtime).asFunction(runtime)});
          start(id);
          return jsi::Value::undefined();
        });
    return runtime.global().getPropertyAsFunction(runtime, "Promise").callAsConstructor(runtime, executor);
  }

  /// Can be called on any thread.
  void settle(uint64_t id, Settle settle)
  {
    callInvoker_->invokeAsync([weak = weak_from_this(), id, settle = std::move(settle)](jsi::Runtime &runtime) {
      auto self = weak.lock();
      if (!self) {
        return;
      }
      auto it = self->pending_.find(id);
      if (it == self->pending_.end()) {
        return;
      }
      auto pending = std::move(it->second);
      self->pending_.erase(it);
      settle(runtime, pending.resolve, pending.reject);
    });
  }

  /// JS thread only; `nullopt` stops route change events.
  void setRouteChangeListener(std::optional<jsi::Function> listener)
  {
    bool listening = listener.has_value();
    routeChangeListener_ = std::move(listener);
    if (!listening) {
      platform_->setRouteChangeHandler(nullptr);
      return;
    }
    platform_->setRouteChangeHandler([weak = weak_from_this()](RouteResult route, const std::string &reason) {
      auto self = weak.lock();
      if (!self) {
        return;
      }
      self->callInvoker_->invokeAsync(
          [weak, route = std::move(route), reason](jsi::Runtime &runtime) mutable {
            auto self = weak.lock();
            if (!self || !self->routeChangeListener_) {
              return;
            }
            jsi::Object event(runtime);
            event.setProperty(runtime, "route", makeRoute(runtime, std::move(route)));
            event.setProperty(runtime, "reason", jsi::String::createFromUtf8(runtime, reason));
            self->routeChangeListener_->call(runtime, event);
          });
    });
  }

  /// Settles `id` with a `RouteResponse` of the main route first, then the alternatives.
  std::function<void(std::vector<RouteResult>)> routesResolver(uint64_t id)
  {
    return [weak = weak_from_this(), id](std::vector<RouteResult> results) {
      auto self = weak.lock();
      if (!self) {
        return;
      }
      self->settle(
          id,
          [results = std::move(results)](
              jsi::Runtime &runtime, const jsi::Function &resolve, const jsi::Function &reject) mutable {
            if (results.empty()) {
              reject.call(runtime, makeError(runtime, "no_route", "No route found"));
              return;
            }
            jsi::Array alternatives(runtime, results.size() - 1);
            for (size_t i = 1; i < results.size(); i++) {
              alternatives.setValueAtIndex(runtime, i - 1, makeRoute(runtime, std::move(results[i])));
            }
            jsi::Object response(runtime);
            response.setProperty(runtime, "main", makeRoute(runtime, std::move(results[0])));
            response.setProperty(runtime, "alternatives", alternatives);
            resolve.call(runtime, response);
          });
    };
  }

  RejectCallback rejecter(uint64_t id)
  {
    return [weak = weak_from_this(), id](const std::string &code, const std::string &message) {
      if (auto self = weak.lock()) {
        self->settle(id, [code, message](jsi::Runtime &runtime, const jsi::Function &, const jsi::Function &reject) {
          reject.call(runtime, makeError(runtime, code, message));
        });
      }
    };
  }

 private:
  struct Pending {
    jsi::Function resolve;
    jsi::Function reject;
  };

  std::shared_ptr<facebook::react::CallInvoker> callInvoker_;
  std::shared_ptr<NavigationPlatform> platform_;
  // Only touched on the JS thread.
  uint64_t nextId_ = 0;
  std::unordered_map<uint64_t, Pending> pending_;
  std::optional<jsi::Function> routeChangeListener_;
};

const jsi::Value &argument(const jsi::Value *args, size_t count, size_t index)
{
  static const jsi::Value undefined;
  return index < count ? args[index] : undefined;
}

jsi::Value makeRoute(jsi::Runtime &runtime, RouteResult result)
{
  return jsi::Object::createFromHostObject(
      runtime, std::make_shared<RouteHostObject>(std::move(result.data), std::move(result.native)));
}

void setFunction(
    jsi::Runtime &runtime,
    jsi::Object &object,
    const char *name,
    unsigned int paramCount,
    jsi::HostFunctionType function)
{
  object.setProperty(
      runtime,
      name,
      jsi::Function::createFromHostFunction(
          runtime, jsi::PropNameID::forAscii(runtime, name), paramCount, std::move(function)));
}

} // namespace

RouteStats &routeStats()
{
  static RouteStats stats;
  return stats;
}

namespace {

struct RouteRegistry {
  std::mutex mutex;
  double nextId = 1;
  std::unordered_map<double, RouteHostObject *> routes;
};

RouteRegistry &routeRegistry()
{
  static RouteRegistry registry;
  return registry;
}

double registerRoute(RouteHostObject *route)
{
  auto &registry = routeRegistry();
  std::lock_guard lock(registry.mutex);
  auto id = registry.nextId++;
  registry.routes.emplace(id, route);
  return id;
}

} // namespace

std::shared_ptr<NativeRoute> findRoute(double id)
{
  auto &registry = routeRegistry();
  std::lock_guard lock(registry.mutex);
  auto it = registry.routes.find(id);
  return it == registry.routes.end() ? nullptr : it->second->native();
}

RouteHostObject::RouteHostObject(RouteData data, std::shared_ptr<NativeRoute> native)
    : data_(std::move(data)), native_(std::move(native))
{
  id_ = registerRoute(this);
  routeStats().live++;
}

RouteHostObject::~RouteHostObject()
{
  {
    auto &registry = routeRegistry();
    std::lock_guard lock(registry.mutex);
    registry.routes.erase(id_);
  }
  if (native_) {
    native_.reset();
    routeStats().live--;
    routeStats().collected++;
  }
}

std::shared_ptr<NativeRoute> RouteHostObject::native() const
{
  std::lock_guard lock(mutex_);
  return native_;
}

void RouteHostObject::release()
{
  std::shared_ptr<NativeRoute> native;
  {
    std::lock_guard lock(mutex_);
    native = std::move(native_);
  }
  if (native) {
    routeStats().live--;
    routeStats().released++;
  }
}

jsi::Value RouteHostObject::get(jsi::Runtime &runtime, const jsi::PropNameID &propName)
{
  auto name = propName.utf8(runtime);
  if (name == "isReleased") {
    return native() == nullptr;
  }
  if (name == "release") {
    return jsi::Function::createFromHostFunction(
        runtime,
        propName,
        0,
        [weak = weak_from_this()](
            jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) -> jsi::Value {
          if (auto self = weak.lock()) {
            self->release();
          }
          return jsi::Value::undefined();
        });
  }
  if (name != "distance" && name != "expectedTravelTime" && name != "geometry" && name != "legs") {
    return jsi::Value::undefined();
  }
  if (!native()) {
    throwReleased(runtime);
  }
  if (name == "distance") {
    return data_.distance;
  }
  if (name == "expectedTravelTime") {
    return data_.expectedTravelTime;
  }
  if (name == "geometry") {
    auto count = data_.coordinates.size() / 2;
    jsi::Array coordinates(runtime, count);
    for (size_t i = 0; i < count; i++) {
      coordinates.setValueAtIndex(
          runtime, i, jsi::Array::createWithElements(runtime, data_.coordinates[2 * i], data_.coordinates[2 * i + 1]));
    }
    jsi::Object geometry(runtime);
    geometry.setProperty(runtime, "type", "LineString");
    geometry.setProperty(runtime, "coordinates", coordinates);
    return geometry;
  }
  jsi::Array legs(runtime, data_.legs.size());
  for (size_t i = 0; i < data_.legs.size(); i++) {
    const auto &leg = data_.legs[i];
    jsi::Object object(runtime);
    object.setProperty(runtime, "distance", leg.distance);
    object.setProperty(runtime, "expectedTravelTime", leg.expectedTravelTime);
    object.setProperty(runtime, "stepCount", static_cast<double>(leg.steps.size()));
    object.setProperty(runtime, "summary", jsi::String::createFromUtf8(runtime, leg.summary));
    jsi::Array steps(runtime, leg.steps.size());
    for (size_t j = 0; j < leg.steps.size(); j++) {
      const auto &step = leg.steps[j];
      jsi::Object stepObject(runtime);
      stepObject.setProperty(runtime, "instruction", jsi::String::createFromUtf8(runtime, step.instruction));
      stepObject.setProperty(runtime, "distance", step.distance);
      stepObject.setProperty(runtime, "expectedTravelTime", step.expectedTravelTime);
      stepObject.setProperty(runtime, "maneuverType", jsi::String::createFromUtf8(runtime, step.maneuverType));
      stepObject.setProperty(runtime, "maneuverModifier", jsi::String::createFromUtf8(runtime, step.maneuverModifier));
      stepObject.setProperty(runtime, "name", jsi::String::createFromUtf8(runtime, step.name));
      steps.setValueAtIndex(runtime, j, stepObject);
    }
    object.setProperty(runtime, "steps", steps);
    legs.setValueAtIndex(runtime, i, object);
  }
  return legs;
}

void RouteHostObject::set(jsi::Runtime &runtime, const jsi::PropNameID &name, const jsi::Value &)
{
  throw jsi::JSError(runtime, "Route." + name.utf8(runtime) + " is read-only");
}

std::vector<jsi::PropNameID> RouteHostObject::getPropertyNames(jsi::Runtime &runtime)
{
  return jsi::PropNameID::names(runtime, "distance", "expectedTravelTime", "geometry", "legs", "isReleased", "release");
}

void install(
    jsi::Runtime &runtime,
    std::shared_ptr<facebook::react::CallInvoker> callInvoker,
    std::shared_ptr<NavigationPlatform> platform)
{
  auto bindings = std::make_shared<Bindings>(std::move(callInvoker), std::move(platform));
  jsi::Object routes(runtime);

  setFunction(
      runtime,
      routes,
      "requestRoutes",
      1,
      [bindings](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        auto request = parseRequest(runtime, argument(args, count, 0));
        return bindings->makePromise(runtime, [bindings, request = std::move(request)](uint64_t id) {
          bindings->platform().requestRoutes(request, bindings->routesResolver(id), bindings->rejecter(id));
        });
      });

  setFunction(
      runtime,
      routes,
      "requestMatchedRoutes",
      1,
      [bindings](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        auto request = parseMatchRequest(runtime, argument(args, count, 0));
        return bindings->makePromise(runtime, [bindings, request = std::move(request)](uint64_t id) {
          bindings->platform().requestMatchedRoutes(request, bindings->routesResolver(id), bindings->rejecter(id));
        });
      });

  setFunction(
      runtime,
      routes,
      "startActiveGuidance",
      2,
      [bindings](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        auto route = unwrapRoute(runtime, argument(args, count, 0));
        auto native = route->native();
        if (!native) {
          throwReleased(runtime);
        }
        bool simulate = count > 1 && args[1].isBool() && args[1].getBool();
        return bindings->makePromise(runtime, [bindings, native = std::move(native), simulate](uint64_t id) {
          bindings->platform().startActiveGuidance(
              native,
              simulate,
              [weak = std::weak_ptr<Bindings>(bindings), id] {
                if (auto bindings = weak.lock()) {
                  bindings->settle(id, [](jsi::Runtime &runtime, const jsi::Function &resolve, const jsi::Function &) {
                    resolve.call(runtime);
                  });
                }
              },
              bindings->rejecter(id));
        });
      });

  setFunction(
      runtime,
      routes,
      "previewRoute",
      1,
      [bindings](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count == 0 || args[0].isNull() || args[0].isUndefined()) {
          bindings->platform().previewRoute(nullptr);
          return jsi::Value::undefined();
        }
        auto native = unwrapRoute(runtime, args[0])->native();
        if (!native) {
          throwReleased(runtime);
        }
        bindings->platform().previewRoute(native);
        return jsi::Value::undefined();
      });

  setFunction(
      runtime,
      routes,
      "getRouteId",
      1,
      [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        auto route = unwrapRoute(runtime, argument(args, count, 0));
        if (!route->native()) {
          throwReleased(runtime);
        }
        return route->id();
      });

  setFunction(
      runtime,
      routes,
      "setRouteChangeListener",
      1,
      [bindings](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        const auto &listener = argument(args, count, 0);
        if (listener.isObject() && listener.getObject(runtime).isFunction(runtime)) {
          bindings->setRouteChangeListener(listener.getObject(runtime).getFunction(runtime));
        } else {
          bindings->setRouteChangeListener(std::nullopt);
        }
        return jsi::Value::undefined();
      });

  setFunction(
      runtime,
      routes,
      "getRouteStats",
      0,
      [](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *, size_t) -> jsi::Value {
        auto &stats = routeStats();
        jsi::Object result(runtime);
        result.setProperty(runtime, "live", static_cast<double>(stats.live.load()));
        result.setProperty(runtime, "released", static_cast<double>(stats.released.load()));
        result.setProperty(runtime, "collected", static_cast<double>(stats.collected.load()));
        return result;
      });

  runtime.global().setProperty(runtime, "__RNMBXNavigationRoutes", routes);
}

} // namespace rnmbxnav
