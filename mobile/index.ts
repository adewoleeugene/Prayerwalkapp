// Import the background location task definition BEFORE registerRootComponent.
// This ensures TaskManager can find the task handler even when the OS wakes
// the app in the background to deliver location events.
import './src/features/location/backgroundLocationTask';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
