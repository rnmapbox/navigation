#import "RNMBXNavigationViewportComponentView.h"

#import <react/renderer/components/rnmapbox_navigation_specs/ComponentDescriptors.h>
#import <react/renderer/components/rnmapbox_navigation_specs/Props.h>
#import <react/renderer/components/rnmapbox_navigation_specs/RCTComponentViewHelpers.h>

#import <React/RCTConversions.h>

#import "rnmapbox_navigation-Swift.h"

using namespace facebook::react;

@interface RNMBXNavigationViewportComponentView () <RCTRNMBXNavigationViewportViewProtocol>
@end

@implementation RNMBXNavigationViewportComponentView {
  RNMBXNavigationViewport *_view;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const RNMBXNavigationViewportProps>();
    _props = defaultProps;
    [self prepareView];
  }
  return self;
}

// @rnmapbox/maps' MapView adds a child to the map through its contentView.
- (void)prepareView
{
  _view = [RNMBXNavigationViewport new];
  self.contentView = _view;
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [self prepareView];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<RNMBXNavigationViewportComponentDescriptor>();
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  const auto &newProps = static_cast<const RNMBXNavigationViewportProps &>(*props);
  const auto &padding = newProps.viewportPadding;
  _view.viewportPadding = UIEdgeInsetsMake(padding.top, padding.left, padding.bottom, padding.right);
  [_view setRouteLineStyleWithColor:RCTUIColorFromSharedColor(newProps.routeLineColor)
                         casingColor:RCTUIColorFromSharedColor(newProps.routeLineCasingColor)
                    alternativeColor:RCTUIColorFromSharedColor(newProps.routeLineAlternativeColor)
                       traveledColor:RCTUIColorFromSharedColor(newProps.routeLineTraveledColor)];
  [super updateProps:props oldProps:oldProps];
}

@end
