import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { startOfflineSyncEngine, stopOfflineSyncEngine } from './src/features/walk/offline/syncEngine';

export default function App() {
  useEffect(() => {
    void startOfflineSyncEngine();
    return () => {
      stopOfflineSyncEngine();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}
