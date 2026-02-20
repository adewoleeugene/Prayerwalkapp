import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Alert, Dimensions, Text, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, Keyboard, TouchableWithoutFeedback, Animated, ScrollView, FlatList } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '@react-navigation/native';

const { width, height } = Dimensions.get('window');

const BRANCH_DATA = [
    { name: 'London', lat: 51.5074, lng: -0.1278 },
    { name: 'Birmingham', lat: 52.4862, lng: -1.8904 },
    { name: 'Brighton', lat: 50.8225, lng: -0.1372 },
    { name: 'Bristol', lat: 51.4545, lng: -2.5879 },
    { name: 'Chatham', lat: 51.3736, lng: 0.5280 },
    { name: 'Chelmsford', lat: 51.7343, lng: 0.4760 },
    { name: 'Coventry', lat: 52.4068, lng: -1.5197 },
    { name: 'Croydon', lat: 51.3762, lng: -0.0982 },
    { name: 'Luton', lat: 51.8787, lng: -0.4200 },
    { name: 'Northampton', lat: 52.2405, lng: -0.9027 },
    { name: 'Nottingham', lat: 52.9548, lng: -1.1581 },
    { name: 'Orpington', lat: 51.3746, lng: 0.1022 },
    { name: 'Reading', lat: 51.4543, lng: -0.9781 },
    { name: 'Accra', lat: 5.6037, lng: -0.1870 },
    { name: 'Freetown', lat: 8.4657, lng: -13.2317 },
];

export default function MapScreen() {
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [locations, setLocations] = useState<any[]>([]);
    const [fingerprint, setFingerprint] = useState<string>('');
    const { token, user } = useAuth();
    const navigation = useNavigation<any>();

    // Start Walk Drawer State
    const [drawerVisible, setDrawerVisible] = useState(false);
    const [targetLocation, setTargetLocation] = useState<any>(null);
    const [branch, setBranch] = useState('London'); // Default to London
    const [showBranchPicker, setShowBranchPicker] = useState(false);
    const [participantInput, setParticipantInput] = useState('');
    const [participants, setParticipants] = useState<string[]>([]);
    const [currentAddress, setCurrentAddress] = useState('Loading address...');
    const slideAnim = useRef(new Animated.Value(height)).current;

    // ... rest ...



    const [keyboardHeight, setKeyboardHeight] = useState(0);

    const [sortedBranches, setSortedBranches] = useState<string[]>(BRANCH_DATA.map(b => b.name));

    // Keyboard Handling
    useEffect(() => {
        const keyboardWillShow = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
            (e) => setKeyboardHeight(e.endCoordinates.height)
        );
        const keyboardWillHide = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
            () => setKeyboardHeight(0)
        );

        return () => {
            keyboardWillShow.remove();
            keyboardWillHide.remove();
        };
    }, []);

    // Open/Close Drawer Animation
    useEffect(() => {
        if (drawerVisible) {
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: height,
                duration: 300,
                useNativeDriver: true,
            }).start();
        }
    }, [drawerVisible]);

    useEffect(() => {
        (async () => {
            // Setup Fingerprint
            let fp = await AsyncStorage.getItem('device_fingerprint');
            if (!fp) {
                fp = Math.random().toString(36).substring(7) + Date.now().toString(36);
                await AsyncStorage.setItem('device_fingerprint', fp);
            }
            setFingerprint(fp);

            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'GPS is required to use this app.');
                return;
            }

            let userLocation = await Location.getCurrentPositionAsync({});
            setLocation(userLocation);

            // Reverse Geocode Logic
            try {
                const [address] = await Location.reverseGeocodeAsync({
                    latitude: userLocation.coords.latitude,
                    longitude: userLocation.coords.longitude
                });

                if (address) {
                    const addrString = [
                        address.name !== address.street ? address.name : '',
                        address.street,
                        address.city
                    ].filter(Boolean).join(', ');
                    setCurrentAddress(addrString);
                } else {
                    setCurrentAddress('Current Location');
                }
            } catch (error) {
                console.log('Geocoding error:', error);
                setCurrentAddress('Current Location');
            }

            // Sort & Filter Branches by Distance (80km Radius)
            try {
                const uLat = userLocation.coords.latitude;
                const uLng = userLocation.coords.longitude;

                const withDist = BRANCH_DATA.map(b => {
                    // Simple Haversine approximation or Pythagorean on degrees (1 deg ~ 111km)
                    const latDiff = (b.lat - uLat) * 111;
                    const lngDiff = (b.lng - uLng) * 111 * Math.cos(uLat * (Math.PI / 180));
                    const distKm = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
                    return { ...b, distKm };
                });

                // Filter branches within 80km
                const localBranches = withDist
                    .filter(b => b.distKm <= 80)
                    .sort((a, b) => a.distKm - b.distKm);

                if (localBranches.length > 0) {
                    const branchNames = localBranches.map(b => b.name);
                    setSortedBranches(branchNames);
                    setBranch(branchNames[0]);
                } else {
                    // Fallback if too far from any branch
                    setSortedBranches(['International']);
                    setBranch('International');
                }
            } catch (e) {
                console.log('Sorting branches error', e);
            }

            // Load cache first
            try {
                const cached = await AsyncStorage.getItem('locations_cache');
                if (cached) {
                    setLocations(JSON.parse(cached));
                }
            } catch (e) {
                console.log('Cache error', e);
            }

            fetchNearbyLocations(userLocation.coords.latitude, userLocation.coords.longitude);
        })();
    }, []);

    const fetchNearbyLocations = async (lat: number, lng: number) => {
        try {
            // Production-grade: Limited radius for performance
            const res = await api.locations.list(lat, lng, 5000);
            setLocations(res.data.locations);
            await AsyncStorage.setItem('locations_cache', JSON.stringify(res.data.locations));
        } catch (e) {
            console.error('Failed to fetch locations', e);
        }
    };

    const openStartDrawer = (loc?: any) => {
        setTargetLocation(loc || null);
        setDrawerVisible(true);
    };

    const addParticipant = () => {
        if (participantInput.trim().length > 0) {
            setParticipants([...participants, participantInput.trim()]);
            setParticipantInput('');
        }
    };

    const removeParticipant = (index: number) => {
        const newParticipants = [...participants];
        newParticipants.splice(index, 1);
        setParticipants(newParticipants);
    };

    const confirmStartWalk = async () => {
        if (!location) return;

        // Validation
        if (!branch) {
            Alert.alert('Required', 'Please select a branch.');
            return;
        }
        try {
            const res = await api.walks.start(
                targetLocation?.id,
                location.coords.latitude,
                location.coords.longitude,
                fingerprint,
                branch,
                participants
            );

            setDrawerVisible(false);
            setBranch('');
            setParticipants([]);
            setParticipantInput('');

            if (res.data.success) {
                navigation.navigate('Walk', {
                    session: res.data.session,
                    targetLocation: targetLocation,
                    fingerprint
                });
            } else {
                Alert.alert('Error', res.data.error || 'Could not start walk');
            }
        } catch (e: any) {
            console.error('Start Walk Error:', e);
            const errorMessage = e.response?.data?.error || 'Failed to start walk';
            Alert.alert('Error', errorMessage);
        }
    };

    return (
        <View style={styles.container}>
            {location ? (
                <MapView
                    style={styles.map}
                    initialRegion={{
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        latitudeDelta: 0.05,
                        longitudeDelta: 0.05,
                    }}
                    showsUserLocation={true}
                    followsUserLocation={true}
                >
                    {locations.map((loc) => {
                        const coords = loc.location?.coordinates || loc.location;
                        if (!coords) return null;
                        const lat = Array.isArray(coords) ? coords[1] : coords.latitude;
                        const lng = Array.isArray(coords) ? coords[0] : coords.longitude;

                        return (
                            <Marker
                                key={loc.id}
                                coordinate={{ latitude: Number(lat), longitude: Number(lng) }}
                            >
                                <Callout onPress={() => openStartDrawer(loc)}>
                                    <View style={styles.callout}>
                                        <Text style={styles.calloutTitle}>{loc.name}</Text>
                                        <Text style={styles.pointsText}>✨ {loc.points} XP</Text>
                                        <TouchableOpacity style={styles.startButton}>
                                            <Text style={styles.startButtonText}>Begin Prayer Walk</Text>
                                        </TouchableOpacity>
                                    </View>
                                </Callout>
                            </Marker>
                        );
                    })}
                </MapView>
            ) : (
                <View style={styles.loading}>
                    <Text>Connecting to Satellites...</Text>
                </View>
            )}

            <TouchableOpacity
                style={styles.profileButton}
                onPress={() => navigation.navigate('Profile')}
            >
                <Text style={styles.profileText}>👤</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.fabStartButton}
                onPress={() => openStartDrawer()}
            >
                <Text style={styles.fabStartText}>Start Prayer Walk</Text>
            </TouchableOpacity>

            {/* Bottom Drawer */}
            {drawerVisible && (
                <TouchableWithoutFeedback onPress={() => setDrawerVisible(false)}>
                    <View style={styles.overlay} />
                </TouchableWithoutFeedback>
            )}

            <Animated.View style={[
                styles.drawer,
                {
                    transform: [{ translateY: slideAnim }],
                    bottom: keyboardHeight // Use manual offset
                }
            ]}>
                <ScrollView
                    contentContainerStyle={{ paddingBottom: 20 }}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                >
                    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                        <View style={styles.drawerHandle} />
                    </TouchableWithoutFeedback>

                    <Text style={styles.drawerTime}>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>

                    <View style={styles.formRow}>
                        <Text style={styles.formLabel}>Branch</Text>
                        <TouchableOpacity
                            style={styles.pickerButton}
                            onPress={() => setShowBranchPicker(true)}
                        >
                            <Text style={styles.pickerButtonText}>{branch || 'Select Branch'}</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.formRow}>
                        <Text style={styles.formLabel}>Location</Text>
                        <TouchableOpacity style={styles.pickerButton}>
                            <Text style={styles.pickerButtonText} numberOfLines={1} ellipsizeMode="tail">
                                {targetLocation ? (targetLocation.address || targetLocation.name) : currentAddress}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.formRow}>
                        <Text style={styles.formLabel}>Team</Text>
                        <View style={{ flex: 1 }}>
                            <View style={styles.inputWithButton}>
                                <TextInput
                                    style={styles.formInputStyled}
                                    placeholder="Add Name"
                                    value={participantInput}
                                    onChangeText={setParticipantInput}
                                    placeholderTextColor="#999"
                                />
                                <TouchableOpacity onPress={addParticipant} style={styles.addButton}>
                                    <Text style={styles.addButtonText}>+</Text>
                                </TouchableOpacity>
                            </View>
                            <View style={styles.chipContainer}>
                                {participants.map((p, index) => (
                                    <TouchableOpacity key={index} onPress={() => removeParticipant(index)} style={styles.chip}>
                                        <Text style={styles.chipText}>{p} ✕</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    </View>

                    <TouchableOpacity style={styles.drawerStartButton} onPress={confirmStartWalk}>
                        <Text style={styles.drawerStartButtonText}>Start Walk</Text>
                    </TouchableOpacity>
                </ScrollView>
            </Animated.View>

            {/* Simple Branch Picker Modal */}
            <Modal
                transparent={true}
                visible={showBranchPicker}
                animationType="fade"
                onRequestClose={() => setShowBranchPicker(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    onPress={() => setShowBranchPicker(false)}
                >
                    <View style={styles.pickerModalContent}>
                        <Text style={styles.pickerTitle}>Select Branch</Text>
                        <FlatList
                            data={sortedBranches}
                            keyExtractor={(item) => item}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.pickerItem}
                                    onPress={() => {
                                        setBranch(item);
                                        setShowBranchPicker(false);
                                    }}
                                >
                                    <Text style={[
                                        styles.pickerItemText,
                                        item === branch && styles.selectedPickerItemText
                                    ]}>{item}</Text>
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                </TouchableOpacity>
            </Modal>
        </View >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    map: {
        width: width,
        height: height,
    },
    loading: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    callout: {
        width: 180,
        padding: 5,
    },
    calloutTitle: {
        fontWeight: 'bold',
        fontSize: 14,
        marginBottom: 2,
    },
    pointsText: {
        fontSize: 12,
        color: '#666',
        marginBottom: 8,
    },
    startButton: {
        backgroundColor: '#4C6EF5',
        padding: 8,
        borderRadius: 5,
    },
    startButtonText: {
        color: '#fff',
        textAlign: 'center',
        fontWeight: 'bold',
        fontSize: 12,
    },
    profileButton: {
        position: 'absolute',
        top: 50,
        right: 20,
        backgroundColor: 'white',
        padding: 10,
        borderRadius: 30,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    profileText: {
        fontSize: 24,
    },
    fabStartButton: {
        position: 'absolute',
        bottom: 40,
        alignSelf: 'center',
        backgroundColor: '#4C6EF5',
        paddingVertical: 15,
        paddingHorizontal: 30,
        borderRadius: 30,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
    },
    fabStartText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    drawer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'white',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        paddingBottom: 40,
        elevation: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        maxHeight: height * 0.8, // Limit height
    },
    drawerHandle: {
        width: 40,
        height: 5,
        backgroundColor: '#ddd',
        borderRadius: 3,
        alignSelf: 'center',
        marginBottom: 20,
    },
    drawerTime: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#333',
        textAlign: 'center',
        marginBottom: 30,
    },
    formRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
        paddingBottom: 10,
    },
    formLabel: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#555',
        width: '25%',
    },
    formValue: {
        fontSize: 16,
        color: '#333',
        flex: 1,
        textAlign: 'right',
    },
    formInputStyled: {
        fontSize: 16,
        color: '#333',
        flex: 1,
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: '#fafafa',
        marginRight: 5,
    },
    inputWithButton: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    addButton: {
        marginLeft: 10,
        backgroundColor: '#eee',
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addButtonText: {
        fontSize: 20,
        color: '#4C6EF5',
        lineHeight: 22,
    },
    chipContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        marginTop: 5,
    },
    chip: {
        backgroundColor: '#e3f2fd',
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 15,
        marginLeft: 5,
        marginBottom: 5,
    },
    chipText: {
        fontSize: 12,
        color: '#1e88e5',
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    pickerButton: {
        flex: 1,
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingVertical: 8,
    },
    pickerButtonText: {
        fontSize: 16,
        color: '#333',
    },
    pickerModalContent: {
        backgroundColor: 'white',
        width: '80%',
        maxHeight: '70%',
        borderRadius: 15,
        padding: 20,
        elevation: 10,
    },
    pickerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 15,
        textAlign: 'center',
    },
    pickerItem: {
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    pickerItemText: {
        fontSize: 16,
        textAlign: 'center',
        color: '#333',
    },
    selectedPickerItemText: {
        color: '#4C6EF5',
        fontWeight: 'bold',
    },
    drawerStartButton: {
        backgroundColor: '#4C6EF5',
        marginTop: 20,
        paddingVertical: 18,
        borderRadius: 12,
        alignItems: 'center',
    },
    drawerStartButtonText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    }
});
