import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Alert, Dimensions, Text, TouchableOpacity, Modal, TextInput, Platform, Keyboard, TouchableWithoutFeedback, Animated, ScrollView, FlatList } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { LocateFixed } from 'lucide-react-native';
import { api } from '../../api/client';
import { useWalkTimer } from '../../features/walk/hooks/useWalkTimer';
import { calculateDistanceMeters, formatDuration, parseParticipantsLike } from '../../features/walk/utils/geo';
import { clearActiveWalkState, loadActiveWalkState, saveActiveWalkState } from '../../features/walk/storage/activeWalkStorage';
import { ActiveWalkDrawer } from '../../features/walk/components/ActiveWalkDrawer';
import { ensureForegroundLocationAccess } from '../../features/location/ensureForegroundLocation';
import {
    completeWalkOnlineOrQueue,
    startWalkOnlineOrQueue,
    trackWalkOnlineOrQueue,
} from '../../features/walk/offline/offlineWalkApi';
import { getSyncStatusSnapshot, subscribeSyncStatus } from '../../features/walk/offline/syncEngine';
import { SyncStatus } from '../../features/walk/offline/types';
import { LeafletMap, LeafletMapHandle, LeafletMapMarker, LeafletMapPolyline } from '../../components/maps/LeafletMap';

const { width, height } = Dimensions.get('window');
const BRANCHES_CACHE_KEY = 'branches_cache_v1';
const DEFAULT_REGION = {
    latitude: 8.4657,
    longitude: -13.2317,
    latitudeDelta: 0.12,
    longitudeDelta: 0.12,
};

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

function isValidCoordinate(latitude: number, longitude: number): boolean {
    return Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180;
}

function normalizeCoordinate(input: any): { latitude: number; longitude: number } | null {
    if (!input) return null;

    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!isValidCoordinate(latitude, longitude)) return null;

    return { latitude, longitude };
}

function parseLocationCoordinates(raw: any): { latitude: number; longitude: number } | null {
    if (!raw) return null;

    if (Array.isArray(raw)) {
        if (raw.length < 2) return null;
        const latitude = Number(raw[1]);
        const longitude = Number(raw[0]);
        if (!isValidCoordinate(latitude, longitude)) return null;
        return { latitude, longitude };
    }

    return normalizeCoordinate(raw);
}

export default function MapScreen() {
    const navigation = useNavigation<any>();
    const mapRef = useRef<LeafletMapHandle | null>(null);
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
    const [canShowUserLocation, setCanShowUserLocation] = useState(false);
    const [stoppedElapsedSeconds, setStoppedElapsedSeconds] = useState<number | null>(null);
    const elapsedSeconds = useWalkTimer(activeWalk?.startedAt, Boolean(activeWalk) && stoppedElapsedSeconds === null);
    const [endWalkModalVisible, setEndWalkModalVisible] = useState(false);
    const [walkJourney, setWalkJourney] = useState('');
    const [isEndingWalk, setIsEndingWalk] = useState(false);
    const [activeRoutePoints, setActiveRoutePoints] = useState<Array<{ latitude: number; longitude: number }>>([]);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatusSnapshot());
    const shouldShowSyncStatusText = !syncStatus.isOnline || syncStatus.isSyncing || syncStatus.pendingCount > 0 || !!syncStatus.error;
    const syncStatusText = !syncStatus.isOnline
        ? 'Offline'
        : syncStatus.isSyncing
            ? 'Syncing...'
            : syncStatus.error
                ? 'Sync error'
                : syncStatus.pendingCount > 0
                ? `${syncStatus.pendingCount} pending`
                : 'Synced';

    const showLocationAccessAlert = (reason: 'services_disabled' | 'permission_denied') => {
        if (reason === 'services_disabled') {
            Alert.alert('Location Disabled', 'Turn on device location services (GPS) and try again.');
            return;
        }

        Alert.alert('Permission Denied', 'Location permission is required to use this app.');
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

    useEffect(() => {
        const unsubscribe = subscribeSyncStatus(setSyncStatus);
        return unsubscribe;
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

            const access = await ensureForegroundLocationAccess();
            if (!access.ok) {
                setCanShowUserLocation(false);
                showLocationAccessAlert(access.reason);
                await fetchBranches();
                return;
            }
            setCanShowUserLocation(true);

            if (location?.coords) {
                setActiveRoutePoints([{ latitude: location.coords.latitude, longitude: location.coords.longitude }]);
                mapRef.current?.centerOn({
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                }, 17);
            } else {
                setActiveRoutePoints([]);
            }

            stopTracking();
            const sub = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.Balanced,
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
                    mapRef.current?.centerOn({
                        latitude: loc.coords.latitude,
                        longitude: loc.coords.longitude,
                    }, 16);
                    void trackWalkOnlineOrQueue({
                        sessionId: activeWalk.sessionId,
                        latitude: loc.coords.latitude,
                        longitude: loc.coords.longitude,
                        speed: loc.coords.speed || undefined,
                        accuracy: loc.coords.accuracy || undefined,
                        isMock: (loc.coords as any).mocked || false,
                    }).catch((err) => {
                        console.log('Track enqueue/send failed', err);
                    });
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
            // Setup Fingerprint (stored securely)
            const SecureStore = await import('expo-secure-store');
            let fp = await SecureStore.getItemAsync('device_fingerprint');
            if (!fp) {
                fp = Math.random().toString(36).substring(7) + Date.now().toString(36);
                await SecureStore.setItemAsync('device_fingerprint', fp);
            }
            setFingerprint(fp);

            // Restore active walk state after app refresh/restart.
            try {
                const cachedActiveWalk = await loadActiveWalkState<any>();
                if (cachedActiveWalk) {
                    const parsed = cachedActiveWalk;
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

            const access = await ensureForegroundLocationAccess();
            if (!access.ok) {
                setCanShowUserLocation(false);
                showLocationAccessAlert(access.reason);
                return;
            }
            setCanShowUserLocation(true);

            let userLocation: Location.LocationObject | null = await Location.getLastKnownPositionAsync();
            if (userLocation) {
                setLocation(userLocation as any);
            }

            try {
                const fresh = await Promise.race([
                    Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                    }),
                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
                ]);

                if (fresh) {
                    userLocation = fresh;
                    setLocation(fresh);
                }
            } catch {
                // Keep last known fallback when fresh lookup fails.
            }

            if (!userLocation) {
                await fetchBranches();
                Alert.alert('Location Pending', 'Map loaded. Turn on Wi-Fi/mobile data to improve first location fix.');
                return;
            }

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
                    const parsed = JSON.parse(cached);
                    const normalized = (Array.isArray(parsed) ? parsed : []).filter((loc: any) => {
                        const coords = parseLocationCoordinates(loc?.location?.coordinates || loc?.location);
                        return Boolean(coords);
                    });
                    setLocations(normalized);
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
            mapRef.current?.fitToCoordinates(historyPoints);
        }, 500);
    }, [walkHistory, location, activeWalk]);

    const fetchNearbyLocations = async (lat: number, lng: number) => {
        try {
            // Production-grade: Limited radius for performance
            const res = await api.locations.list(lat, lng, 5000);
            const normalized = (Array.isArray(res.data?.locations) ? res.data.locations : []).filter((loc: any) => {
                const coords = parseLocationCoordinates(loc?.location?.coordinates || loc?.location);
                return Boolean(coords);
            });
            setLocations(normalized);
            await AsyncStorage.setItem('locations_cache', JSON.stringify(normalized));
        } catch (e) {
            console.error('Failed to fetch locations', e);
        }
    };

    const fetchBranches = async (lat?: number, lng?: number) => {
        try {
            const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
            if (hasCoords) {
                const nearbyRes = await api.branches.list(lat, lng, 80000);
                const nearby = Array.isArray(nearbyRes.data?.branches) ? nearbyRes.data.branches : [];

                if (nearby.length > 0) {
                    const names = nearby.map((b: any) => String(b.name));
                    applyBranchState(names);
                    await AsyncStorage.setItem(BRANCHES_CACHE_KEY, JSON.stringify(names));
                    return;
                }
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
                        ? item.points
                            .map((p: any) => normalizeCoordinate(p))
                            .filter((p: any) => Boolean(p))
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
        if (sortedBranches.length === 0) {
            const lat = location?.coords.latitude;
            const lng = location?.coords.longitude;
            fetchBranches(lat, lng);
        }
        if (!startBranch && sortedBranches.length > 0) {
            setStartBranch(sortedBranches[0]);
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
        if (!location) {
            Alert.alert('Location Pending', 'Please wait for GPS location, then try again.');
            return;
        }
        if (activeWalk) {
            Alert.alert('Walk Active', 'Please end the current walk before starting another.');
            return;
        }

        // Validation
        const branchForStart = startBranch || sortedBranches[0] || 'International';
        const pendingParticipant = participantInput.trim();
        const participantsForStart = pendingParticipant
            ? [...participants, pendingParticipant]
            : participants;
        const normalizedParticipants = participantsForStart.length > 0
            ? participantsForStart
            : ['Prayer Team'];
        try {
            let startLatitude = location.coords.latitude;
            let startLongitude = location.coords.longitude;
            let startAddressLabel = currentAddress;

            // Capture a fresh start point/address at button press time.
            try {
                const latestLocation = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                });
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

            const res = await startWalkOnlineOrQueue({
                locationId: targetLocation?.id,
                latitude: startLatitude,
                longitude: startLongitude,
                deviceFingerprint: fingerprint,
                branch: branchForStart,
                participants: normalizedParticipants,
                startAddress: startAddressLabel,
            });

            setDrawerVisible(false);
            setParticipants([]);
            setParticipantInput('');

            if (res.data.success) {
                const session = res.data.session;
                const parsedParticipants = parseParticipantsLike(session?.participants || participantsForStart);
                const nextActiveWalk = {
                    sessionId: String(session?.id),
                    targetLocation: targetLocation || null,
                    branch: String(session?.branch || branchForStart || 'International'),
                    participants: parsedParticipants,
                    startedAt: String(session?.startTime || new Date().toISOString()),
                };
                setActiveWalk(nextActiveWalk);
                await saveActiveWalkState(nextActiveWalk);
                fetchWalkHistory();
                // Stay on MapScreen — walk tracking happens here
                if (res.data.queued) {
                    Alert.alert('Offline Start', 'Walk started offline. Data will sync automatically when internet returns.');
                }
            } else {
                Alert.alert('Error', res.data.error || 'Could not start walk');
            }
        } catch (e: any) {
            console.error('Start Walk Error:', e);
            const responseData = e?.response?.data;
            const responseError = typeof responseData === 'string'
                ? responseData
                : responseData?.error;
            const errorMessage = responseError || e?.message || 'Failed to start walk';
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
                accuracy: Location.Accuracy.Balanced,
            });

            setLocation(latestLocation);
            mapRef.current?.centerOn({
                latitude: latestLocation.coords.latitude,
                longitude: latestLocation.coords.longitude,
            }, 17);
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
            const shouldWaitForGpsFix = latitude === undefined || longitude === undefined;
            const liveLoc = await Promise.race([
                Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), shouldWaitForGpsFix ? 5000 : 1200)),
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
            const res = await completeWalkOnlineOrQueue({
                sessionId: activeWalk.sessionId,
                locationId: activeWalk.targetLocation?.id,
                latitude,
                longitude,
                prayerJournal: includeJourney && journey.length > 0 ? journey : undefined,
            });

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
            setStoppedElapsedSeconds(null);
            await clearActiveWalkState();
            fetchWalkHistory();
            Alert.alert(
                'Walk Ended',
                res.data?.queued
                    ? 'Walk completed offline. It will sync automatically when internet returns.'
                    : 'Your walk has been completed.'
            );
        } catch (e: any) {
            const errorMessage = e.response?.data?.error || e.message || 'Failed to complete walk';
            Alert.alert('Error', errorMessage);
        } finally {
            setIsEndingWalk(false);
        }
    };

    const currentCenter = location?.coords
        ? {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
        }
        : {
            latitude: DEFAULT_REGION.latitude,
            longitude: DEFAULT_REGION.longitude,
        };

    const mapMarkers: LeafletMapMarker[] = [
        ...(canShowUserLocation && location?.coords ? [{
            id: 'user-location',
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            title: 'Your location',
            color: '#2563EB',
        }] : []),
    ];

    walkHistory.forEach((walk) => {
        const point = walk.geometryType === 'path'
            ? walk.points[walk.points.length - 1]
            : walk.points[0];

        if (!point) return;

        mapMarkers.push({
            id: `history-${walk.sessionId}`,
            latitude: point.latitude,
            longitude: point.longitude,
            title: toHistoryLabel(walk),
            description: `${toDurationLabel(walk.durationSeconds)} • ${toDistanceLabel(walk.distanceMeters)}`,
            color: walk.walkType === 'area' ? '#1C7ED6' : '#E03131',
        });
    });

    locations.forEach((loc) => {
        const coordinate = parseLocationCoordinates(loc.location?.coordinates || loc.location);
        if (!coordinate) return;

        mapMarkers.push({
            id: `location-${loc.id}`,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            title: loc.name,
            description: 'Tap to begin prayer walk',
            color: '#16A34A',
        });
    });

    const mapPolylines: LeafletMapPolyline[] = [
        ...(activeWalk && activeRoutePoints.length >= 3 ? [{
            id: 'active-route',
            coordinates: activeRoutePoints,
            color: 'rgba(37, 99, 235, 0.92)',
            width: 6,
        }] : []),
        ...walkHistory
            .filter((walk) => walk.geometryType === 'path' && walk.points.length >= 3)
            .map((walk) => {
                const strokeOpacity = Math.max(0.18, Math.min(1, walk.opacity || 0.5));
                const color = walk.walkType === 'area'
                    ? `rgba(38, 132, 255, ${strokeOpacity})`
                    : `rgba(255, 59, 48, ${strokeOpacity})`;

                return {
                    id: `history-line-${walk.sessionId}`,
                    coordinates: walk.points,
                    color,
                    width: 7,
                };
            }),
    ];

    const handleMapMarkerPress = (markerId: string) => {
        if (markerId.startsWith('location-')) {
            const locationId = markerId.replace('location-', '');
            const nextLocation = locations.find((loc) => String(loc.id) === locationId);
            if (nextLocation) {
                openStartDrawer(nextLocation);
            }
            return;
        }

        if (markerId.startsWith('history-')) {
            const sessionId = markerId.replace('history-', '');
            const selected = walkHistory.find((walk) => walk.sessionId === sessionId);
            if (selected) {
                openHistoryDetails(selected);
            }
        }
    };

    const handleMapPolylinePress = (polylineId: string) => {
        if (!polylineId.startsWith('history-line-')) return;
        const sessionId = polylineId.replace('history-line-', '');
        const selected = walkHistory.find((walk) => walk.sessionId === sessionId);
        if (selected) {
            openHistoryDetails(selected);
        }
    };

    return (
        <View style={styles.container}>
            <LeafletMap
                ref={mapRef}
                style={styles.map}
                initialCenter={currentCenter}
                initialZoom={13}
                markers={mapMarkers}
                polylines={mapPolylines}
                onMarkerPress={handleMapMarkerPress}
                onPolylinePress={handleMapPolylinePress}
            />

            {!location && (
                <View style={styles.loading}>
                    <Text>Connecting to location services...</Text>
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
                    <>
                        {shouldShowSyncStatusText && (
                            <View style={styles.bottomSyncBannerWrap}>
                                <Text style={styles.bottomSyncStatusText}>{syncStatusText}</Text>
                            </View>
                        )}
                        <TouchableOpacity
                            style={styles.fabStartButton}
                            onPress={() => openStartDrawer()}
                        >
                            <Text style={styles.fabStartText}>Start Prayer Walk</Text>
                        </TouchableOpacity>
                    </>
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
                <ActiveWalkDrawer
                    participants={activeWalk.participants}
                    elapsedLabel={formatDuration(stoppedElapsedSeconds ?? elapsedSeconds)}
                    isEndingWalk={isEndingWalk}
                    onEndWalk={() => {
                        setStoppedElapsedSeconds(elapsedSeconds);
                        setEndWalkModalVisible(true);
                    }}
                    styles={styles}
                />
            )}

            {/* Simple Branch Picker Modal */}
            <Modal
                transparent={true}
                visible={showBranchPicker}
                animationType="fade"
                onRequestClose={() => setShowBranchPicker(false)}
            >
                <View style={styles.modalOverlay}>
                    <TouchableWithoutFeedback onPress={() => setShowBranchPicker(false)}>
                        <View style={StyleSheet.absoluteFillObject} />
                    </TouchableWithoutFeedback>
                    <View style={styles.pickerModalContent}>
                        <Text style={styles.pickerTitle}>Select Branch</Text>
                        {sortedBranches.length > 0 ? (
                            <FlatList
                                data={sortedBranches}
                                keyExtractor={(item) => item}
                                keyboardShouldPersistTaps="handled"
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
                        ) : (
                            <Text style={styles.pickerEmptyText}>No branches available yet.</Text>
                        )}
                    </View>
                </View>
            </Modal>

            <Modal
                transparent={true}
                visible={endWalkModalVisible}
                animationType="fade"
                onRequestClose={() => { }}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.endModalContent}>
                        <Text style={styles.endModalTitle}>Journal (Optional)</Text>
                        <TextInput
                            style={styles.endModalInput}
                            placeholder="Write about your walk..."
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
                                <Text style={styles.endModalCloseText}>{isEndingWalk ? 'Ending...' : 'Skip'}</Text>
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
        top: Platform.OS === 'ios' ? 82 : 48,
        left: 14,
        right: 14,
        zIndex: 15,
        elevation: 15,
    },
    bottomSyncBannerWrap: {
        alignSelf: 'center',
        width: '86%',
        marginBottom: 10,
        alignItems: 'center',
    },
    bottomSyncStatusText: {
        color: '#1F2937',
        fontSize: 12,
        fontWeight: '700',
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
    pickerEmptyText: {
        textAlign: 'center',
        color: '#6B7280',
        paddingVertical: 12,
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
