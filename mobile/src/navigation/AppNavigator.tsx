import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';

import MapScreen from '../screens/app/MapScreen';
import WalkScreen from '../screens/app/WalkScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
    const { isLoading } = useAuth();

    if (isLoading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" />
            </View>
        );
    }

    return (
        <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
                {/* Auth is removed altogether. Always go to the Map. */}
                <Stack.Screen name="Map" component={MapScreen} />
                <Stack.Screen
                    name="Walk"
                    component={WalkScreen}
                    options={{ headerShown: false }}
                />
            </Stack.Navigator>
        </NavigationContainer>
    );
}
