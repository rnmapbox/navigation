#pragma once

#include "RNMBXNavigationRoutes.h"

@class RNMBXNavigation;

namespace rnmbxnav {

std::shared_ptr<NavigationPlatform> makeNavigationPlatform(RNMBXNavigation *navigation);

} // namespace rnmbxnav
