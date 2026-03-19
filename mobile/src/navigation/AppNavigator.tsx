import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import MapScreen from '../screens/app/MapScreen';
import WalkScreen from '../screens/app/WalkScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
    return (
        <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="Map" component={MapScreen} />
                <Stack.Screen name="Walk" component={WalkScreen} />
            </Stack.Navigator>
        </NavigationContainer>
    );
}
