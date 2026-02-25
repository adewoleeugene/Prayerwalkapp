import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, TextInput, Platform, Animated } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { api, getWebSocketUrl } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '@react-navigation/native';
import { Clock, Navigation, MapPin, CheckCircle, Navigation2, Check, PenLine, AlignLeft } from 'lucide-react-native';

export default function WalkScreen({ route }: { route: any }) {
    const { session, targetLocation, fingerprint } = route.params;
    const { token } = useAuth();
    const navigation = useNavigation<any>();
    const [distance, setDistance] = useState<number | null>(null);
    const [participants, setParticipants] = useState<string[]>([]);
    const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [routePoints, setRoutePoints] = useState<Array<{ latitude: number; longitude: number }>>([]);
    const [distanceWalkedMeters, setDistanceWalkedMeters] = useState(0);
    const [isCompleting, setIsCompleting] = useState(false);
    const [isTimerRunning, setIsTimerRunning] = useState(true);
    const [prayerSummary, setPrayerSummary] = useState('');
    const [prayerJournal, setPrayerJournal] = useState('');
    const [walkSummary, setWalkSummary] = useState<{
        pointsEarned: number;
        durationSeconds: number;
        distanceMeters: number;
        routePoints: Array<{ latitude: number; longitude: number }>;
    } | null>(null);

    const formatDuration = (totalSeconds: number) => {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
    };

    const metersToKm = (meters: number) => (meters / 1000).toFixed(2);

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

    const getTargetCoords = () => {
        if (!targetLocation) return null;

        const coords = targetLocation.location?.coordinates || targetLocation.location;
        if (!coords) return null;

        if (Array.isArray(coords)) {
            return { latitude: Number(coords[1]), longitude: Number(coords[0]) };
        }

        if (coords.latitude !== undefined && coords.longitude !== undefined) {
            return { latitude: Number(coords.latitude), longitude: Number(coords.longitude) };
        }

        return null;
    };

    const targetCoords = getTargetCoords();

    useEffect(() => {
        if (session.participants) {
            try {
                const parsed = typeof session.participants === 'string'
                    ? JSON.parse(session.participants)
                    : session.participants;
                setParticipants(Array.isArray(parsed) ? parsed : []);
            } catch (e) {
                setParticipants([]);
            }
        }
    }, [session]);

    const [isArrived, setIsArrived] = useState(false);
    const [prayerContent, setPrayerContent] = useState<any>(null);
    const ws = useRef<WebSocket | null>(null);
    const locationSubscription = useRef<Location.LocationSubscription | null>(null);
    const sessionIdRef = useRef(session.id);
    const elapsedSecondsRef = useRef(0);
    const routePointsRef = useRef<Array<{ latitude: number; longitude: number }>>([]);
    const distanceWalkedMetersRef = useRef(0);
    const currentLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);

    useEffect(() => {
        startTracking();
        connectWebSocket();

        return () => {
            if (ws.current) ws.current.close();
            if (locationSubscription.current) locationSubscription.current.remove();
        };
    }, []);

    useEffect(() => {
        setElapsedSeconds(0);
    }, []);

    useEffect(() => {
        if (!isTimerRunning) return;
        const interval = setInterval(() => {
            setElapsedSeconds((prev) => prev + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [isTimerRunning]);

    useEffect(() => {
        elapsedSecondsRef.current = elapsedSeconds;
    }, [elapsedSeconds]);

    useEffect(() => {
        routePointsRef.current = routePoints;
    }, [routePoints]);

    useEffect(() => {
        distanceWalkedMetersRef.current = distanceWalkedMeters;
    }, [distanceWalkedMeters]);

    useEffect(() => {
        currentLocationRef.current = currentLocation;
    }, [currentLocation]);

    const connectWebSocket = () => {
        const wsUrl = getWebSocketUrl(token, fingerprint);
        ws.current = new WebSocket(wsUrl);
        ws.current.onopen = () => console.log('Secure Tunnel Established');
        ws.current.onerror = (e) => console.log('WS Error', e);
    };

    const startTracking = async () => {
        const sub = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.High,
                timeInterval: 3000,
                distanceInterval: 10,
            },
            (loc) => handleLocationUpdate(loc)
        );
        locationSubscription.current = sub;
    };

    const handleLocationUpdate = async (loc: Location.LocationObject) => {
        const { latitude, longitude, speed, accuracy, mockAdvertised } = loc.coords as any;
        const nextPoint = { latitude, longitude };
        setCurrentLocation(nextPoint);
        setRoutePoints((prev) => {
            if (prev.length > 0) {
                const last = prev[prev.length - 1];
                const increment = calculateDistanceMeters(last, nextPoint);
                if (increment > 2) {
                    setDistanceWalkedMeters((d) => d + increment);
                }
            }
            return [...prev, nextPoint];
        });

        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
                type: 'LOCATION_UPDATE',
                payload: {
                    sessionId: sessionIdRef.current,
                    latitude,
                    longitude,
                    speed,
                    accuracy,
                    isMock: mockAdvertised || false
                }
            }));
        }

        try {
            if (targetLocation && !isArrived) {
                const res = await api.walks.arrive(sessionIdRef.current, targetLocation.id, latitude, longitude);

                if (res.data.withinRange) {
                    setIsArrived(true);
                    setDistance(res.data.distance);
                    setPrayerContent(res.data.location);
                } else {
                    setDistance(res.data.distance);
                }
            }
        } catch (e) {
            console.error('Validation Check failed', e);
        }
    };

    const handleComplete = async () => {
        if (isCompleting) return;
        setIsCompleting(true);
        setIsTimerRunning(false);

        let latitude = currentLocationRef.current?.latitude;
        let longitude = currentLocationRef.current?.longitude;

        try {
            const liveLoc = await Promise.race([
                Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
            ]);
            if (liveLoc) {
                latitude = liveLoc.coords.latitude;
                longitude = liveLoc.coords.longitude;
            }

            if (latitude === undefined || longitude === undefined) {
                throw new Error('Location unavailable');
            }

            const res = await api.walks.complete(
                sessionIdRef.current,
                targetLocation?.id,
                latitude,
                longitude,
                prayerSummary.trim() || undefined,
                prayerJournal.trim() || undefined
            );

            if (res.data.success) {
                if (ws.current) ws.current.close();
                if (locationSubscription.current) locationSubscription.current.remove();
                setWalkSummary({
                    pointsEarned: Number(res.data.pointsEarned || 0),
                    durationSeconds: elapsedSecondsRef.current,
                    distanceMeters: distanceWalkedMetersRef.current,
                    routePoints: routePointsRef.current.length > 1
                        ? routePointsRef.current
                        : (currentLocationRef.current ? [currentLocationRef.current] : []),
                });
            } else {
                Alert.alert('Validation Error', res.data.error || 'Walk completion failed.');
                setIsTimerRunning(true);
            }
        } catch (e: any) {
            const errorMessage = e.response?.data?.error || (e.message === 'Location unavailable'
                ? 'Unable to get current location. Please move to an open area and try again.'
                : 'Failed to complete walk');
            Alert.alert('Error', errorMessage);
            setIsTimerRunning(true);
        } finally {
            setIsCompleting(false);
        }
    };

    if (walkSummary) {
        const summaryStart = walkSummary.routePoints[0] || currentLocation;
        return (
            <ScrollView contentContainerStyle={styles.container}>
                <View style={styles.headerContainer}>
                    <CheckCircle size={48} color="#10B981" style={{ marginBottom: 12 }} />
                    <Text style={styles.title}>Walk Completed</Text>
                    <Text style={styles.subTitle}>{session.branch || 'International'} Branch</Text>
                </View>

                {!!summaryStart && (
                    <View style={styles.mapCard}>
                        <MapView
                            style={styles.map}
                            initialRegion={{
                                latitude: summaryStart.latitude,
                                longitude: summaryStart.longitude,
                                latitudeDelta: 0.01,
                                longitudeDelta: 0.01,
                            }}
                        >
                            {walkSummary.routePoints.length > 1 && (
                                <Polyline
                                    coordinates={walkSummary.routePoints}
                                    strokeColor="#4F46E5"
                                    strokeWidth={5}
                                />
                            )}
                            {walkSummary.routePoints[0] && (
                                <Marker coordinate={walkSummary.routePoints[0]} title="Start" pinColor="#10B981" />
                            )}
                            {walkSummary.routePoints.length > 1 && (
                                <Marker
                                    coordinate={walkSummary.routePoints[walkSummary.routePoints.length - 1]}
                                    title="End"
                                    pinColor="#EF4444"
                                />
                            )}
                        </MapView>
                    </View>
                )}

                <View style={styles.statsGrid}>
                    <View style={styles.statBox}>
                        <Clock size={24} color="#6366F1" />
                        <Text style={styles.statValue}>{formatDuration(walkSummary.durationSeconds)}</Text>
                        <Text style={styles.statLabel}>Duration</Text>
                    </View>
                    <View style={styles.statBox}>
                        <Navigation2 size={24} color="#10B981" />
                        <Text style={styles.statValue}>{metersToKm(walkSummary.distanceMeters)}</Text>
                        <Text style={styles.statLabel}>KM</Text>
                    </View>
                    <View style={styles.statBox}>
                        <CheckCircle size={24} color="#F59E0B" />
                        <Text style={styles.statValue}>{walkSummary.pointsEarned}</Text>
                        <Text style={styles.statLabel}>XP Earned</Text>
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.primaryButton, { marginTop: 32 }]}
                    onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Map' }] })}
                >
                    <Text style={styles.primaryButtonText}>Finish & Return</Text>
                </TouchableOpacity>
            </ScrollView>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
            {/* Header Area */}
            <View style={styles.headerContainer}>
                <Text style={styles.title}>{targetLocation?.name || 'Open Prayer Walk'}</Text>
                <Text style={styles.subTitle}>{session.branch || 'International'} Branch</Text>
            </View>

            {/* Live Stats Row */}
            <View style={styles.liveStatsRow}>
                <View style={styles.liveStatItem}>
                    <Clock size={20} color="#6366F1" />
                    <Text style={styles.liveStatText}>{formatDuration(elapsedSeconds)}</Text>
                </View>
                <View style={styles.liveStatItem}>
                    <Navigation2 size={20} color="#10B981" />
                    <Text style={styles.liveStatText}>{metersToKm(distanceWalkedMeters)} km</Text>
                </View>
            </View>

            {/* Team Area */}
            {participants.length > 0 && (
                <View style={[styles.card, styles.teamCard]}>
                    <Text style={styles.cardSectionTitle}>Team Members</Text>
                    <View style={styles.teamList}>
                        {participants.map((p, i) => (
                            <View key={i} style={styles.teamBadge}>
                                <Text style={styles.teamText}>{p}</Text>
                            </View>
                        ))}
                    </View>
                </View>
            )}

            {/* Map Area */}
            {currentLocation && (
                <View style={styles.mapCard}>
                    <MapView
                        style={styles.map}
                        initialRegion={{
                            latitude: currentLocation.latitude,
                            longitude: currentLocation.longitude,
                            latitudeDelta: 0.005,
                            longitudeDelta: 0.005,
                        }}
                        region={{
                            latitude: currentLocation.latitude,
                            longitude: currentLocation.longitude,
                            latitudeDelta: 0.005,
                            longitudeDelta: 0.005,
                        }}
                        showsUserLocation
                        userInterfaceStyle="light"
                    >
                        {routePoints.length > 1 && (
                            <Polyline
                                coordinates={routePoints}
                                strokeColor="#4F46E5"
                                strokeWidth={5}
                                lineCap="round"
                                lineJoin="round"
                            />
                        )}
                        {targetCoords && (
                            <Marker
                                coordinate={targetCoords}
                                title={targetLocation?.name || 'Prayer Target'}
                                pinColor="#F59E0B"
                            />
                        )}
                    </MapView>
                </View>
            )}

            {/* Status & Inputs Area */}
            {!isArrived ? (
                <View style={styles.card}>
                    <View style={styles.statusHeader}>
                        <Navigation size={24} color="#6366F1" />
                        <Text style={styles.statusText}>
                            {targetLocation ? "Navigating to Target" : "Prayer Walk Active"}
                        </Text>
                    </View>

                    {targetLocation && distance !== null && (
                        <View style={styles.distanceContainer}>
                            <Text style={styles.distanceValue}>{Math.round(distance)}</Text>
                            <Text style={styles.distanceUnit}>meters away</Text>

                            <View style={styles.progressBarBg}>
                                <Animated.View style={[styles.progressBarFill, { width: `${Math.max(0, Math.min(100, 100 - (distance / 10)))}%` }]} />
                            </View>
                        </View>
                    )}

                    <View style={styles.inputsContainer}>
                        <View style={styles.inputGroup}>
                            <View style={styles.inputHeader}>
                                <AlignLeft size={16} color="#6B7280" />
                                <Text style={styles.inputLabel}>Prayer Summary</Text>
                            </View>
                            <TextInput
                                style={styles.textInput}
                                placeholder="What did you focus on praying for?"
                                placeholderTextColor="#9CA3AF"
                                value={prayerSummary}
                                onChangeText={setPrayerSummary}
                                multiline
                                numberOfLines={3}
                                maxLength={600}
                                textAlignVertical="top"
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <View style={styles.inputHeader}>
                                <PenLine size={16} color="#6B7280" />
                                <Text style={styles.inputLabel}>Journal Reflection</Text>
                            </View>
                            <TextInput
                                style={[styles.textInput, styles.journalInput]}
                                placeholder="Jot down any specific thoughts or reflections..."
                                placeholderTextColor="#9CA3AF"
                                value={prayerJournal}
                                onChangeText={setPrayerJournal}
                                multiline
                                numberOfLines={5}
                                maxLength={2000}
                                textAlignVertical="top"
                            />
                        </View>
                    </View>

                    <TouchableOpacity
                        style={[styles.primaryButton, styles.dangerButton, { marginTop: 24 }]}
                        onPress={handleComplete}
                        disabled={isCompleting}
                    >
                        <Text style={styles.primaryButtonText}>{isCompleting ? 'Completing...' : 'End Walk Early'}</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <View style={[styles.card, styles.arrivedCard]}>
                    <View style={styles.arrivedHeader}>
                        <View style={styles.iconCircle}>
                            <MapPin size={28} color="#10B981" />
                        </View>
                        <Text style={styles.arrivedTitle}>Target Reached</Text>
                        <Text style={styles.arrivedSubTitle}>You're aligned with your prayer focus.</Text>
                    </View>

                    <View style={styles.prayerContentBox}>
                        <Text style={styles.prayerFocusTitle}>Prayer Focus</Text>
                        <Text style={styles.prayerText}>{prayerContent?.prayerText || "Loading..."}</Text>

                        {prayerContent?.prayers?.map((p: any) => (
                            <View key={p.id} style={styles.prayerItem}>
                                <Text style={styles.itemTitle}>{p.title}</Text>
                                <Text style={styles.itemContent}>{p.content}</Text>
                            </View>
                        ))}
                    </View>

                    <View style={styles.inputsContainer}>
                        <View style={styles.inputGroup}>
                            <View style={styles.inputHeader}>
                                <AlignLeft size={16} color="#6B7280" />
                                <Text style={styles.inputLabel}>Prayer Summary</Text>
                            </View>
                            <TextInput
                                style={styles.textInput}
                                placeholder="What did you focus on praying for?"
                                placeholderTextColor="#9CA3AF"
                                value={prayerSummary}
                                onChangeText={setPrayerSummary}
                                multiline
                                numberOfLines={3}
                                maxLength={600}
                                textAlignVertical="top"
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <View style={styles.inputHeader}>
                                <PenLine size={16} color="#6B7280" />
                                <Text style={styles.inputLabel}>Journal Reflection</Text>
                            </View>
                            <TextInput
                                style={[styles.textInput, styles.journalInput]}
                                placeholder="Jot down any specific thoughts or reflections..."
                                placeholderTextColor="#9CA3AF"
                                value={prayerJournal}
                                onChangeText={setPrayerJournal}
                                multiline
                                numberOfLines={5}
                                maxLength={2000}
                                textAlignVertical="top"
                            />
                        </View>
                    </View>

                    <TouchableOpacity
                        style={[styles.primaryButton, { marginTop: 24 }]}
                        onPress={handleComplete}
                        disabled={isCompleting}
                    >
                        <Text style={styles.primaryButtonText}>{isCompleting ? 'Completing...' : 'Complete Prayer Walk'}</Text>
                        {!isCompleting && <Check size={20} color="white" style={{ marginLeft: 8 }} />}
                    </TouchableOpacity>
                </View>
            )}

            <View style={{ height: 40 }} />
        </ScrollView>
    );
}

const dropShadow = Platform.select({
    ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
    },
    android: {
        elevation: 4,
    },
});

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 40,
        backgroundColor: '#F3F4F6',
        alignItems: 'center',
    },
    headerContainer: {
        alignItems: 'center',
        marginBottom: 20,
        paddingHorizontal: 16,
    },
    title: {
        fontSize: 26,
        fontWeight: '800',
        color: '#111827',
        marginBottom: 6,
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    subTitle: {
        fontSize: 15,
        color: '#6B7280',
        fontWeight: '500',
    },
    liveStatsRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 16,
        marginBottom: 24,
    },
    liveStatItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 16,
        ...(dropShadow as any),
    },
    liveStatText: {
        marginLeft: 8,
        fontSize: 16,
        fontWeight: '700',
        color: '#374151',
    },
    card: {
        width: '100%',
        backgroundColor: 'white',
        borderRadius: 24,
        padding: 24,
        marginBottom: 20,
        ...(dropShadow as any),
    },
    teamCard: {
        padding: 20,
    },
    cardSectionTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#9CA3AF',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 12,
    },
    teamList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    teamBadge: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#DBEAFE',
    },
    teamText: {
        color: '#2563EB',
        fontSize: 13,
        fontWeight: '600',
    },
    mapCard: {
        width: '100%',
        height: 240,
        borderRadius: 24,
        overflow: 'hidden',
        marginBottom: 24,
        ...(dropShadow as any),
    },
    map: {
        width: '100%',
        height: '100%',
    },
    statusHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    statusText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111827',
        marginLeft: 10,
    },
    distanceContainer: {
        alignItems: 'center',
        marginBottom: 32,
    },
    distanceValue: {
        fontSize: 56,
        fontWeight: '900',
        color: '#4F46E5',
        lineHeight: 64,
        letterSpacing: -2,
    },
    distanceUnit: {
        fontSize: 16,
        color: '#6B7280',
        fontWeight: '600',
        marginTop: -4,
        marginBottom: 16,
    },
    progressBarBg: {
        height: 12,
        backgroundColor: '#F3F4F6',
        borderRadius: 6,
        width: '100%',
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#4F46E5',
        borderRadius: 6,
    },
    inputsContainer: {
        width: '100%',
        gap: 20,
    },
    inputGroup: {
        width: '100%',
    },
    inputHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#4B5563',
        marginLeft: 6,
    },
    textInput: {
        backgroundColor: '#F9FAFB',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 16,
        fontSize: 15,
        color: '#111827',
        minHeight: 100,
    },
    journalInput: {
        minHeight: 140,
    },
    primaryButton: {
        backgroundColor: '#4F46E5',
        flexDirection: 'row',
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        ...(dropShadow as any),
    },
    dangerButton: {
        backgroundColor: '#EF4444',
    },
    primaryButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    arrivedCard: {
        paddingTop: 32,
    },
    arrivedHeader: {
        alignItems: 'center',
        marginBottom: 24,
    },
    iconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#D1FAE5',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    arrivedTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: '#065F46',
        marginBottom: 4,
    },
    arrivedSubTitle: {
        fontSize: 15,
        color: '#059669',
        fontWeight: '500',
    },
    prayerContentBox: {
        backgroundColor: '#F8FAFC',
        borderRadius: 20,
        padding: 20,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    prayerFocusTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#64748B',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 12,
    },
    prayerText: {
        fontSize: 16,
        lineHeight: 24,
        color: '#334155',
        marginBottom: 20,
    },
    prayerItem: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderLeftWidth: 4,
        borderLeftColor: '#3B82F6',
        ...(dropShadow as any),
    },
    itemTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1E293B',
        marginBottom: 6,
    },
    itemContent: {
        fontSize: 15,
        color: '#475569',
        lineHeight: 22,
    },
    statsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        gap: 12,
        marginTop: 16,
    },
    statBox: {
        flex: 1,
        backgroundColor: 'white',
        padding: 20,
        borderRadius: 20,
        alignItems: 'center',
        ...(dropShadow as any),
    },
    statValue: {
        fontSize: 18,
        fontWeight: '800',
        color: '#111827',
        marginTop: 12,
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6B7280',
        textTransform: 'uppercase',
    },
});
