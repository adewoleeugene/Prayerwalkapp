import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import MapScreen from '../screens/app/MapScreen';
import WalkScreen from '../screens/app/WalkScreen';
import LocationDetailScreen from '../screens/app/LocationDetailScreen';
import HistoryListScreen from '../screens/app/HistoryListScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
    return (
        <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Map" component={MapScreen} />
                <Stack.Screen name="Walk" component={WalkScreen} />
                <Stack.Screen name="LocationDetail" component={LocationDetailScreen} />
                <Stack.Screen name="HistoryList" component={HistoryListScreen} />
            </Stack.Navigator>
        </NavigationContainer>
    );
}
