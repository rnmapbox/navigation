import { registerRootComponent } from 'expo';
import Navigation from '@rnmapbox/navigation';

import App from './App';
import CarMapLayers from './CarMapLayers';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
// Mounted while CarPlay is connected, also when CarPlay launches the app without the phone UI.
Navigation.registerCarPlayRoot(CarMapLayers);
