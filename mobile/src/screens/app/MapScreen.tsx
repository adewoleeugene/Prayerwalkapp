import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Alert, Dimensions, Text, TouchableOpacity, Modal, TextInput, Platform, Keyboard, TouchableWithoutFeedback, Animated, ScrollView, FlatList } from 'react-native';
import MapView, { Marker, Callout, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocateFixed } from 'lucide-react-native';
import { api } from '../../api/client';

const { width, height } = Dimensions.get('window');
const BRANCHES_CACHE_KEY = 'branches_cache_v1';
const ACTIVE_WALK_CACHE_KEY = 'active_walk_state_v1';

type WalkTypeFilter = 'all' | 'path' | 'area';

type WalkHistoryItem = {
    sessionId: string;
    userId: string;
    walkType: WalkTypeFilter;
    geometryType: 'path' | 'spot';
    routeQuality: 'high' | 'medium' | 'low';
    branch: string;
    status: 'active' | 'completed' | 'abandoned';
    startedAt: string;
    endedAt?: string | null;
    durationSeconds: number;
    distanceMeters: number;
    startLocationName?: string | null;
    endLocationName?: string | null;
    prayerSummary?: string | null;
    prayerJournal?: string | null;
    prayerFocus: string;
    opacity: number;
    points: Array<{ latitude: number; longitude: number }>;
};

export default function MapScreen() {
    const mapRef = useRef<MapView | null>(null);
    const locationSubscription = useRef<Location.LocationSubscription | null>(null);
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    const [locations, setLocations] = useState<any[]>([]);
    const [walkHistory, setWalkHistory] = useState<WalkHistoryItem[]>([]);
    const [fingerprint, setFingerprint] = useState<string>('');
    const [daysFilter, setDaysFilter] = useState<1 | 7 | 30>(7);
    const [selectedHistoryWalk, setSelectedHistoryWalk] = useState<WalkHistoryItem | null>(null);
    const [historySheetVisible, setHistorySheetVisible] = useState(false);
    // Start Walk Drawer State
    const [drawerVisible, setDrawerVisible] = useState(false);
    const [targetLocation, setTargetLocation] = useState<any>(null);
    const [startBranch, setStartBranch] = useState('');
    const [showBranchPicker, setShowBranchPicker] = useState(false);
    const [participantInput, setParticipantInput] = useState('');
    const [participants, setParticipants] = useState<string[]>([]);
    const [currentAddress, setCurrentAddress] = useState('Loading address...');
    const slideAnim = useRef(new Animated.Value(height)).current;
    const hasFocusedHistory = useRef(false);

    // ... rest ...



    const [keyboardHeight, setKeyboardHeight] = useState(0);

    const [sortedBranches, setSortedBranches] = useState<string[]>([]);
    const [activeWalk, setActiveWalk] = useState<{
        sessionId: string;
        targetLocation: any | null;
        branch: string;
        participants: string[];
        startedAt: string;
    } | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [stoppedElapsedSeconds, setStoppedElapsedSeconds] = useState<number | null>(null);
    const [endWalkModalVisible, setEndWalkModalVisible] = useState(false);
    const [walkJourney, setWalkJourney] = useState('');
    const [isEndingWalk, setIsEndingWalk] = useState(false);
    const [activeRoutePoints, setActiveRoutePoints] = useState<Array<{ latitude: number; longitude: number }>>([]);

    const parseParticipantsLike = (participantsLike: unknown): string[] => {
        if (!participantsLike) return [];
        if (Array.isArray(participantsLike)) {
            return participantsLike.map((name) => String(name).trim()).filter(Boolean);
        }
        if (typeof participantsLike === 'string') {
            try {
                const parsed = JSON.parse(participantsLike);
                if (Array.isArray(parsed)) {
                    return parsed.map((name) => String(name).trim()).filter(Boolean);
                }
            } catch {
                return participantsLike.split(',').map((name) => name.trim()).filter(Boolean);
            }
        }
        return [];
    };

    const formatDuration = (totalSeconds: number) => {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
    };

    const calculateDistanceMeters = (
        a: { latitude: number; longitude: number },
        b: { latitude: number; longitude: number }
    ) => {
        const toRad = (deg: number) => (deg * Math.PI) / 180;
        const R = 6371e3;
        const dLat = toRad(b.latitude - a.latitude);
        const dLng = toRad(b.longitude - a.longitude);
        const lat1 = toRad(a.latitude);
        const lat2 = toRad(b.latitude);
        const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
        return R * c;
    };

    const applyBranchState = (names: string[]) => {
        const normalized = Array.from(
            new Set(
                names
                    .map((name) => String(name).trim())
                    .filter(Boolean)
            )
        );

        if (normalized.length > 0) {
            setSortedBranches(normalized);
            setStartBranch((prev) => (prev && normalized.includes(prev) ? prev : normalized[0]));
            return;
        }

        setSortedBranches(['International']);
        setStartBranch((prev) => prev || 'International');
    };

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
        if (!activeWalk) {
            setElapsedSeconds(0);
            setStoppedElapsedSeconds(null);
            return;
        }
        if (stoppedElapsedSeconds !== null) return;
        const startedAtMs = new Date(activeWalk.startedAt).getTime();
        const tick = () => {
            const nowMs = Date.now();
            const nextElapsed = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
            setElapsedSeconds(nextElapsed);
        };
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [activeWalk, stoppedElapsedSeconds]);

    useEffect(() => {
        let cancelled = false;

        const stopTracking = () => {
            if (locationSubscription.current) {
                locationSubscription.current.remove();
                locationSubscription.current = null;
            }
        };

        const startTracking = async () => {
            if (!activeWalk) {
                stopTracking();
                setActiveRoutePoints([]);
                return;
            }

            if (location?.coords) {
                setActiveRoutePoints([{ latitude: location.coords.latitude, longitude: location.coords.longitude }]);
                mapRef.current?.animateToRegion(
                    {
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        latitudeDelta: 0.008,
                        longitudeDelta: 0.008,
                    },
                    250
                );
            } else {
                setActiveRoutePoints([]);
            }

            stopTracking();
            const sub = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.BestForNavigation,
                    timeInterval: 2000,
                    distanceInterval: 3,
                },
                (loc) => {
                    if (cancelled) return;
                    setLocation(loc);
                    const nextPoint = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
                    setActiveRoutePoints((prev) => {
                        if (prev.length === 0) return [nextPoint];
                        const last = prev[prev.length - 1];
                        if (calculateDistanceMeters(last, nextPoint) < 2) return prev;
                        return [...prev, nextPoint];
                    });
                    mapRef.current?.animateToRegion(
                        {
                            latitude: loc.coords.latitude,
                            longitude: loc.coords.longitude,
                            latitudeDelta: 0.01,
                            longitudeDelta: 0.01,
                        },
                        400
                    );
                }
            );

            if (!cancelled) {
                locationSubscription.current = sub;
            } else {
                sub.remove();
            }
        };

        startTracking();

        return () => {
            cancelled = true;
            stopTracking();
        };
    }, [activeWalk]);

    useEffect(() => {
        (async () => {
            // Setup Fingerprint
            let fp = await AsyncStorage.getItem('device_fingerprint');
            if (!fp) {
                fp = Math.random().toString(36).substring(7) + Date.now().toString(36);
                await AsyncStorage.setItem('device_fingerprint', fp);
            }
            setFingerprint(fp);

            // Restore active walk state after app refresh/restart.
            try {
                const cachedActiveWalk = await AsyncStorage.getItem(ACTIVE_WALK_CACHE_KEY);
                if (cachedActiveWalk) {
                    const parsed = JSON.parse(cachedActiveWalk);
                    if (parsed?.sessionId && parsed?.startedAt) {
                        setActiveWalk({
                            sessionId: String(parsed.sessionId),
                            targetLocation: parsed.targetLocation || null,
                            branch: String(parsed.branch || 'International'),
                            participants: Array.isArray(parsed.participants)
                                ? parsed.participants.map((p: any) => String(p))
                                : [],
                            startedAt: String(parsed.startedAt),
                        });
                    }
                }
            } catch (e) {
                console.log('Active walk cache error', e);
            }

            // Hydrate branches from cache immediately for offline/slow network cases.
            try {
                const cachedBranches = await AsyncStorage.getItem(BRANCHES_CACHE_KEY);
                if (cachedBranches) {
                    const parsed = JSON.parse(cachedBranches);
                    if (Array.isArray(parsed)) {
                        applyBranchState(parsed.map((name: any) => String(name)));
                    }
                }
            } catch (e) {
                console.log('Branch cache error', e);
            }

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

            await fetchBranches(userLocation.coords.latitude, userLocation.coords.longitude);

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

    useEffect(() => {
        hasFocusedHistory.current = false;
        fetchWalkHistory();
    }, [daysFilter]);

    useEffect(() => {
        const interval = setInterval(() => {
            fetchWalkHistory();
        }, 25000);
        return () => clearInterval(interval);
    }, [daysFilter]);

    useEffect(() => {
        if (activeWalk) return;
        if (!mapRef.current || walkHistory.length === 0 || hasFocusedHistory.current) return;

        const historyPoints = walkHistory.flatMap((walk) =>
            walk.points.map((point) => ({
                latitude: Number(point.latitude),
                longitude: Number(point.longitude)
            }))
        );
        if (location?.coords) {
            historyPoints.push({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude
            });
        }

        if (historyPoints.length < 2) return;

        hasFocusedHistory.current = true;
        setTimeout(() => {
            mapRef.current?.fitToCoordinates(historyPoints, {
                edgePadding: { top: 120, right: 80, bottom: 200, left: 80 },
                animated: true
            });
        }, 500);
    }, [walkHistory, location, activeWalk]);

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

    const fetchBranches = async (lat: number, lng: number) => {
        try {
            const nearbyRes = await api.branches.list(lat, lng, 80000);
            const nearby = Array.isArray(nearbyRes.data?.branches) ? nearbyRes.data.branches : [];

            if (nearby.length > 0) {
                const names = nearby.map((b: any) => String(b.name));
                applyBranchState(names);
                await AsyncStorage.setItem(BRANCHES_CACHE_KEY, JSON.stringify(names));
                return;
            }

            const allRes = await api.branches.list();
            const all = Array.isArray(allRes.data?.branches) ? allRes.data.branches : [];
            const names = all.map((b: any) => String(b.name));
            applyBranchState(names);
            await AsyncStorage.setItem(BRANCHES_CACHE_KEY, JSON.stringify(names));
        } catch (e) {
            console.error('Failed to fetch branches', e);
            try {
                const cachedBranches = await AsyncStorage.getItem(BRANCHES_CACHE_KEY);
                if (cachedBranches) {
                    const parsed = JSON.parse(cachedBranches);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        applyBranchState(parsed.map((name: any) => String(name)));
                        return;
                    }
                }
            } catch {
                // No-op. Fallback below.
            }
            applyBranchState(['International']);
        }
    };

    const fetchWalkHistory = async () => {
        const parseHistory = (rows: any[]): WalkHistoryItem[] =>
            rows
                .map((item) => ({
                    sessionId: String(item.sessionId),
                    userId: String(item.userId || ''),
                    walkType: (item.walkType === 'area' ? 'area' : 'path') as WalkTypeFilter,
                    geometryType: (item.geometryType === 'spot' ? 'spot' : 'path') as 'path' | 'spot',
                    routeQuality: (item.routeQuality === 'high' || item.routeQuality === 'low' ? item.routeQuality : 'medium') as 'high' | 'medium' | 'low',
                    branch: item.branch || 'Unknown',
                    status: (item.status === 'active' || item.status === 'abandoned' ? item.status : 'completed') as 'active' | 'completed' | 'abandoned',
                    startedAt: String(item.startedAt || new Date().toISOString()),
                    endedAt: item.endedAt || null,
                    durationSeconds: Number(item.durationSeconds || 0),
                    distanceMeters: Number(item.distanceMeters || 0),
                    startLocationName: item.startLocationName ? String(item.startLocationName) : null,
                    endLocationName: item.endLocationName ? String(item.endLocationName) : null,
                    prayerSummary: item.prayerSummary ? String(item.prayerSummary) : null,
                    prayerJournal: item.prayerJournal ? String(item.prayerJournal) : null,
                    prayerFocus: item.prayerFocus || 'Open Prayer Walk',
                    opacity: Number(item.opacity ?? 0.5),
                    points: Array.isArray(item.points)
                        ? item.points.map((p: any) => ({
                            latitude: Number(p.latitude),
                            longitude: Number(p.longitude)
                        }))
                        : []
                }))
                .filter((item) => item.points.length > 0);

        try {
            const res = await api.walks.history(300, {
                days: daysFilter,
                walkType: 'all',
                includeActive: true,
            });
            const all = (res.data?.routes || []) as any[];
            const parsed = parseHistory(all);

            setWalkHistory(parsed);
        } catch (e) {
            console.error('Failed to fetch walk history', e);
        }
    };

    const openStartDrawer = (loc?: any) => {
        if (activeWalk) {
            Alert.alert('Walk Active', 'Please end the current walk before starting another.');
            return;
        }
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
        if (activeWalk) {
            Alert.alert('Walk Active', 'Please end the current walk before starting another.');
            return;
        }

        // Validation
        if (!startBranch) {
            Alert.alert('Required', 'Please select a branch.');
            return;
        }
        const pendingParticipant = participantInput.trim();
        const participantsForStart = pendingParticipant
            ? [...participants, pendingParticipant]
            : participants;

        if (participantsForStart.length === 0) {
            Alert.alert('Required', 'Please add at least one name in Team before starting.');
            return;
        }
        try {
            let startLatitude = location.coords.latitude;
            let startLongitude = location.coords.longitude;
            let startAddressLabel = currentAddress;

            // Capture a fresh start point/address at button press time.
            try {
                const latestLocation = await Location.getCurrentPositionAsync({});
                startLatitude = latestLocation.coords.latitude;
                startLongitude = latestLocation.coords.longitude;

                const [latestAddress] = await Location.reverseGeocodeAsync({
                    latitude: startLatitude,
                    longitude: startLongitude,
                });

                if (latestAddress) {
                    const resolved = [
                        latestAddress.name !== latestAddress.street ? latestAddress.name : '',
                        latestAddress.street,
                        latestAddress.city,
                    ].filter(Boolean).join(', ');
                    if (resolved.trim()) {
                        startAddressLabel = resolved.trim();
                    }
                }
            } catch {
                // Keep previously known location/address fallback.
            }

            const res = await api.walks.start(
                targetLocation?.id,
                startLatitude,
                startLongitude,
                fingerprint,
                startBranch,
                participantsForStart,
                startAddressLabel
            );

            setDrawerVisible(false);
            setParticipants([]);
            setParticipantInput('');

            if (res.data.success) {
                const session = res.data.session;
                const parsedParticipants = parseParticipantsLike(session?.participants || participantsForStart);
                const nextActiveWalk = {
                    sessionId: String(session?.id),
                    targetLocation: targetLocation || null,
                    branch: String(session?.branch || startBranch || 'International'),
                    participants: parsedParticipants,
                    startedAt: String(session?.startTime || new Date().toISOString()),
                };
                setActiveWalk(nextActiveWalk);
                await AsyncStorage.setItem(ACTIVE_WALK_CACHE_KEY, JSON.stringify(nextActiveWalk));
                fetchWalkHistory();
            } else {
                Alert.alert('Error', res.data.error || 'Could not start walk');
            }
        } catch (e: any) {
            console.error('Start Walk Error:', e);
            const errorMessage = e.response?.data?.error || 'Failed to start walk';
            Alert.alert('Error', errorMessage);
        }
    };

    const openHistoryDetails = (walk: WalkHistoryItem) => {
        setSelectedHistoryWalk(walk);
        setHistorySheetVisible(true);
    };

    const toDurationLabel = (seconds: number) => {
        const safe = Math.max(0, Math.floor(seconds));
        const hours = Math.floor(safe / 3600);
        const minutes = Math.floor((safe % 3600) / 60);
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    const toDistanceLabel = (meters: number) => {
        if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
        return `${Math.round(meters)} m`;
    };

    const toHistoryLabel = (walk: WalkHistoryItem) => {
        const start = walk.startLocationName?.trim();
        const end = walk.endLocationName?.trim();
        if (start && end) return start === end ? start : `${start} → ${end}`;
        return end || start || 'Prayer walk';
    };

    const recenterToCurrentLocation = async () => {
        try {
            const latestLocation = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Highest,
            });

            setLocation(latestLocation);
            mapRef.current?.animateToRegion(
                {
                    latitude: latestLocation.coords.latitude,
                    longitude: latestLocation.coords.longitude,
                    latitudeDelta: 0.008,
                    longitudeDelta: 0.008,
                },
                350
            );
        } catch {
            Alert.alert('Location Error', 'Unable to get your current location right now.');
        }
    };

    const completeActiveWalk = async (includeJourney: boolean) => {
        if (!activeWalk || isEndingWalk) return;
        setIsEndingWalk(true);

        let latitude = location?.coords.latitude;
        let longitude = location?.coords.longitude;

        try {
            const liveLoc = await Promise.race([
                Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
            ]);
            if (liveLoc) {
                latitude = liveLoc.coords.latitude;
                longitude = liveLoc.coords.longitude;
                setLocation(liveLoc);
            }

            if (latitude === undefined || longitude === undefined) {
                throw new Error('Location unavailable');
            }

            const journey = walkJourney.trim();
            const res = await api.walks.complete(
                activeWalk.sessionId,
                activeWalk.targetLocation?.id,
                latitude,
                longitude,
                undefined,
                includeJourney && journey.length > 0 ? journey : undefined
            );

            if (!res.data?.success) {
                throw new Error(res.data?.error || 'Failed to complete walk');
            }

            setEndWalkModalVisible(false);
            setWalkJourney('');
            if (locationSubscription.current) {
                locationSubscription.current.remove();
                locationSubscription.current = null;
            }
            setActiveRoutePoints([]);
            setActiveWalk(null);
            setElapsedSeconds(0);
            setStoppedElapsedSeconds(null);
            await AsyncStorage.removeItem(ACTIVE_WALK_CACHE_KEY);
            fetchWalkHistory();
            Alert.alert('Walk Ended', 'Your walk has been completed.');
        } catch (e: any) {
            const errorMessage = e.response?.data?.error || e.message || 'Failed to complete walk';
            Alert.alert('Error', errorMessage);
        } finally {
            setIsEndingWalk(false);
        }
    };

    return (
        <View style={styles.container}>
            {location ? (
                <MapView
                    ref={(ref) => { mapRef.current = ref; }}
                    style={styles.map}
                    initialRegion={{
                        latitude: location.coords.latitude,
                        longitude: location.coords.longitude,
                        latitudeDelta: 0.05,
                        longitudeDelta: 0.05,
                    }}
                    showsUserLocation={true}
                    showsMyLocationButton={false}
                    followsUserLocation={!!activeWalk}
                >
                    {activeWalk && activeRoutePoints.length > 1 && (
                        <Polyline
                            coordinates={activeRoutePoints}
                            strokeColor="rgba(37, 99, 235, 0.92)"
                            strokeWidth={6}
                            geodesic
                            lineCap="round"
                            lineJoin="round"
                        />
                    )}
                    {walkHistory.map((walk) => {
                        const strokeOpacity = Math.max(0.18, Math.min(1, walk.opacity || 0.5));
                        const strokeColor = walk.walkType === 'area'
                            ? `rgba(38, 132, 255, ${strokeOpacity})`
                            : `rgba(255, 59, 48, ${strokeOpacity})`;

                        if (walk.geometryType === 'path' && walk.points.length > 1) {
                            return (
                                <React.Fragment key={walk.sessionId}>
                                    <Polyline
                                        coordinates={walk.points}
                                        strokeColor={strokeColor}
                                        strokeWidth={7}
                                        geodesic
                                        lineCap="round"
                                        lineJoin="round"
                                        tappable
                                        onPress={() => openHistoryDetails(walk)}
                                    />
                                    <Marker
                                        coordinate={walk.points[walk.points.length - 1]}
                                        title={toHistoryLabel(walk)}
                                        pinColor={walk.walkType === 'area' ? '#1C7ED6' : '#E03131'}
                                        onPress={() => openHistoryDetails(walk)}
                                    />
                                </React.Fragment>
                            );
                        }

                        const first = walk.points[0];
                        if (!first) return null;
                        return (
                            <Marker
                                key={`spot-${walk.sessionId}`}
                                coordinate={first}
                                title={toHistoryLabel(walk)}
                                pinColor={walk.walkType === 'area' ? '#1C7ED6' : '#E8590C'}
                                onPress={() => openHistoryDetails(walk)}
                            />
                        );
                    })}

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

            <View style={styles.filtersWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
                    <TouchableOpacity
                        style={[styles.filterChip, daysFilter === 1 && styles.filterChipActive]}
                        onPress={() => setDaysFilter(1)}
                    >
                        <Text style={[styles.filterChipText, daysFilter === 1 && styles.filterChipTextActive]}>Today</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.filterChip, daysFilter === 7 && styles.filterChipActive]}
                        onPress={() => setDaysFilter(7)}
                    >
                        <Text style={[styles.filterChipText, daysFilter === 7 && styles.filterChipTextActive]}>7 days</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.filterChip, daysFilter === 30 && styles.filterChipActive]}
                        onPress={() => setDaysFilter(30)}
                    >
                        <Text style={[styles.filterChipText, daysFilter === 30 && styles.filterChipTextActive]}>30 days</Text>
                    </TouchableOpacity>
                </ScrollView>
                <Text style={styles.filterMetaText}>
                    {walkHistory.length} walks shown
                </Text>
            </View>

            <View style={styles.bottomControls}>
                <TouchableOpacity
                    style={styles.recenterButton}
                    onPress={recenterToCurrentLocation}
                    accessibilityRole="button"
                    accessibilityLabel="Recenter map to my location"
                >
                    <LocateFixed size={22} color="#3B82F6" strokeWidth={2.25} />
                </TouchableOpacity>

                {!activeWalk && (
                    <TouchableOpacity
                        style={styles.fabStartButton}
                        onPress={() => openStartDrawer()}
                    >
                        <Text style={styles.fabStartText}>Start Prayer Walk</Text>
                    </TouchableOpacity>
                )}
            </View>

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
                            <Text style={styles.pickerButtonText}>{startBranch || 'Select Branch'}</Text>
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

            {activeWalk && (
                <View style={styles.activeWalkDrawer}>
                    <View style={styles.activeWalkHeader}>
                        <Text style={styles.activeWalkTitle}>Walk in Progress</Text>
                        <Text style={styles.activeWalkTimer}>{formatDuration(stoppedElapsedSeconds ?? elapsedSeconds)}</Text>
                    </View>

                    {activeWalk.participants.length > 0 && (
                        <View style={styles.activeParticipantsWrap}>
                            <Text style={styles.activeParticipantsLabel}>Participants</Text>
                            <View style={styles.activeParticipantsList}>
                                {activeWalk.participants.map((name, idx) => (
                                    <View key={`${name}-${idx}`} style={styles.activeParticipantChip}>
                                        <Text style={styles.activeParticipantText}>{name}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>
                    )}

                    <TouchableOpacity
                        style={styles.endWalkButton}
                        onPress={() => {
                            setStoppedElapsedSeconds(elapsedSeconds);
                            setEndWalkModalVisible(true);
                        }}
                        disabled={isEndingWalk}
                    >
                        <Text style={styles.endWalkButtonText}>End Walk</Text>
                    </TouchableOpacity>
                </View>
            )}

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
                                        setStartBranch(item);
                                        setShowBranchPicker(false);
                                    }}
                                >
                                    <Text style={[
                                        styles.pickerItemText,
                                        item === startBranch && styles.selectedPickerItemText
                                    ]}>{item}</Text>
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                </TouchableOpacity>
            </Modal>

            <Modal
                transparent={true}
                visible={endWalkModalVisible}
                animationType="fade"
                onRequestClose={() => { }}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.endModalContent}>
                        <Text style={styles.endModalTitle}>Walk Journey (Optional)</Text>
                        <TextInput
                            style={styles.endModalInput}
                            placeholder="Share your walk journey..."
                            placeholderTextColor="#9CA3AF"
                            value={walkJourney}
                            onChangeText={setWalkJourney}
                            multiline
                            numberOfLines={5}
                            maxLength={2000}
                            textAlignVertical="top"
                        />
                        <View style={styles.endModalActions}>
                            <TouchableOpacity
                                style={[styles.endModalButton, styles.endModalCloseButton]}
                                onPress={() => completeActiveWalk(false)}
                                disabled={isEndingWalk}
                            >
                                <Text style={styles.endModalCloseText}>{isEndingWalk ? 'Ending...' : 'Close'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.endModalButton, styles.endModalSubmitButton]}
                                onPress={() => completeActiveWalk(true)}
                                disabled={isEndingWalk}
                            >
                                <Text style={styles.endModalSubmitText}>{isEndingWalk ? 'Submitting...' : 'Submit'}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* History Details Bottom Sheet */}
            {historySheetVisible && selectedHistoryWalk && (
                <>
                    <TouchableWithoutFeedback onPress={() => setHistorySheetVisible(false)}>
                        <View style={styles.overlay} />
                    </TouchableWithoutFeedback>
                    <View style={styles.historySheet}>
                        <View style={styles.drawerHandle} />
                        <Text style={styles.historyTitle}>{toHistoryLabel(selectedHistoryWalk)}</Text>
                        <Text style={styles.historyMetaText}>
                            {new Date(selectedHistoryWalk.startedAt).toLocaleString()}
                        </Text>
                        <Text style={styles.historyMetaText}>Duration {toDurationLabel(selectedHistoryWalk.durationSeconds)} • Distance {toDistanceLabel(selectedHistoryWalk.distanceMeters)}</Text>
                        <Text style={styles.historyMetaText}>Branch {selectedHistoryWalk.branch}</Text>
                        {!!selectedHistoryWalk.prayerSummary && (
                            <View style={styles.historySummaryBox}>
                                <Text style={styles.historySummaryLabel}>Prayer Summary</Text>
                                <Text style={styles.historySummaryText}>{selectedHistoryWalk.prayerSummary}</Text>
                            </View>
                        )}
                        {!!selectedHistoryWalk.prayerJournal && (
                            <View style={styles.historySummaryBox}>
                                <Text style={styles.historySummaryLabel}>Prayer Walk Journal</Text>
                                <Text style={styles.historySummaryText}>{selectedHistoryWalk.prayerJournal}</Text>
                            </View>
                        )}
                        <View style={styles.historyActionRow}>
                            <TouchableOpacity style={styles.historyCloseButton} onPress={() => setHistorySheetVisible(false)}>
                                <Text style={styles.historyCloseText}>Close</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </>
            )}
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
    filtersWrap: {
        position: 'absolute',
        top: 52,
        left: 14,
        right: 14,
    },
    filtersRow: {
        paddingRight: 24,
    },
    filterChip: {
        backgroundColor: 'rgba(255,255,255,0.92)',
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginRight: 8,
        borderWidth: 1,
        borderColor: '#DEE2E6',
    },
    filterChipActive: {
        backgroundColor: '#1864AB',
        borderColor: '#1864AB',
    },
    filterChipText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#1F2937',
    },
    filterChipTextActive: {
        color: '#FFFFFF',
    },
    filterMetaText: {
        marginTop: 6,
        marginLeft: 2,
        color: '#1F2937',
        fontSize: 12,
        fontWeight: '600',
    },
    bottomControls: {
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 40,
        height: 120,
        justifyContent: 'flex-end',
    },
    recenterButton: {
        position: 'absolute',
        right: 0,
        top: 0,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#CFE1FF',
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.22,
        shadowRadius: 4,
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
    fabStartButton: {
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
    activeWalkDrawer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        borderWidth: 1,
        borderColor: '#D9E3F0',
        padding: 14,
        paddingBottom: 28,
        elevation: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
    },
    activeWalkHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    activeWalkTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1F2937',
    },
    activeWalkTimer: {
        fontSize: 17,
        fontWeight: '800',
        color: '#1D4ED8',
    },
    activeParticipantsWrap: {
        marginTop: 4,
        marginBottom: 10,
    },
    activeParticipantsLabel: {
        fontSize: 12,
        color: '#6B7280',
        marginBottom: 6,
        fontWeight: '600',
    },
    activeParticipantsList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    activeParticipantChip: {
        backgroundColor: '#E0ECFF',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 14,
        marginRight: 6,
        marginBottom: 6,
    },
    activeParticipantText: {
        color: '#1D4ED8',
        fontSize: 12,
        fontWeight: '600',
    },
    endWalkButton: {
        backgroundColor: '#DC2626',
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center',
    },
    endWalkButtonText: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 15,
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
    endModalContent: {
        backgroundColor: '#FFFFFF',
        width: '90%',
        borderRadius: 16,
        padding: 18,
        elevation: 14,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.22,
        shadowRadius: 8,
    },
    endModalTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 10,
    },
    endModalInput: {
        minHeight: 130,
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: '#111827',
        backgroundColor: '#F9FAFB',
    },
    endModalActions: {
        flexDirection: 'row',
        marginTop: 14,
    },
    endModalButton: {
        flex: 1,
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center',
    },
    endModalCloseButton: {
        backgroundColor: '#E5E7EB',
        marginRight: 8,
    },
    endModalSubmitButton: {
        backgroundColor: '#2563EB',
        marginLeft: 8,
    },
    endModalCloseText: {
        color: '#1F2937',
        fontWeight: '700',
    },
    endModalSubmitText: {
        color: '#FFFFFF',
        fontWeight: '700',
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
    },
    historySheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 30,
        elevation: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
    },
    historyTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 8,
    },
    historyMetaText: {
        color: '#374151',
        fontSize: 14,
        marginBottom: 6,
    },
    historySummaryBox: {
        marginTop: 8,
        marginBottom: 4,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 10,
        backgroundColor: '#F9FAFB',
        padding: 10,
    },
    historySummaryLabel: {
        color: '#4B5563',
        fontSize: 12,
        fontWeight: '700',
        marginBottom: 4,
    },
    historySummaryText: {
        color: '#111827',
        fontSize: 14,
        lineHeight: 20,
    },
    historyActionRow: {
        marginTop: 14,
    },
    historyActionButton: {
        flex: 1,
        backgroundColor: '#0B7285',
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center',
        marginRight: 10,
    },
    historyActionText: {
        color: '#fff',
        fontWeight: '700',
    },
    historyCloseButton: {
        width: '100%',
        backgroundColor: '#2563EB',
        borderRadius: 10,
        paddingVertical: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    historyCloseText: {
        color: '#FFFFFF',
        fontWeight: '700',
    },
});
