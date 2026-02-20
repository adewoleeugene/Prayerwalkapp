import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { api, getWebSocketUrl } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '@react-navigation/native';

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
    const [walkSummary, setWalkSummary] = useState<{
        trustScore: number;
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
    const [integrity, setIntegrity] = useState<number>(100);
    const [isArrived, setIsArrived] = useState(false);
    const [prayerContent, setPrayerContent] = useState<any>(null);
    const ws = useRef<WebSocket | null>(null);
    const locationSubscription = useRef<Location.LocationSubscription | null>(null);
    const sessionIdRef = useRef(session.id);

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
        const interval = setInterval(() => {
            setElapsedSeconds((prev) => prev + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

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

        // Anti-Cheat: Report device-level mock detection and physics
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
            if (targetLocation) {
                const res = await api.walks.arrive(sessionIdRef.current, targetLocation.id, latitude, longitude);
                setIntegrity(res.data.integrityScore || 100);

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
        const loc = await Location.getCurrentPositionAsync({});
        try {
            const res = await api.walks.complete(
                sessionIdRef.current,
                targetLocation?.id,
                loc.coords.latitude,
                loc.coords.longitude
            );

            if (res.data.success) {
                if (ws.current) ws.current.close();
                if (locationSubscription.current) locationSubscription.current.remove();
                setWalkSummary({
                    trustScore: Number(res.data.trustScore || 0),
                    pointsEarned: Number(res.data.pointsEarned || 0),
                    durationSeconds: elapsedSeconds,
                    distanceMeters: distanceWalkedMeters,
                    routePoints: routePoints.length > 1 ? routePoints : (currentLocation ? [currentLocation] : []),
                });
            } else {
                Alert.alert('Validation Error', res.data.error || 'Walk integrity too low.');
            }
        } catch (e: any) {
            Alert.alert('Error', e.response?.data?.error || 'Failed to complete walk');
        } finally {
            setIsCompleting(false);
        }
    };

    if (walkSummary) {
        const summaryStart = walkSummary.routePoints[0] || currentLocation;
        return (
            <ScrollView contentContainerStyle={styles.container}>
                <View style={styles.header}>
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
                                    strokeColor="#1971C2"
                                    strokeWidth={5}
                                />
                            )}
                            {walkSummary.routePoints[0] && (
                                <Marker coordinate={walkSummary.routePoints[0]} title="Start" pinColor="#2F9E44" />
                            )}
                            {walkSummary.routePoints.length > 1 && (
                                <Marker
                                    coordinate={walkSummary.routePoints[walkSummary.routePoints.length - 1]}
                                    title="End"
                                    pinColor="#FA5252"
                                />
                            )}
                        </MapView>
                    </View>
                )}

                <View style={styles.summaryCard}>
                    <Text style={styles.summaryLine}>Time: {formatDuration(walkSummary.durationSeconds)}</Text>
                    <Text style={styles.summaryLine}>Distance: {metersToKm(walkSummary.distanceMeters)} km</Text>
                    <Text style={styles.summaryLine}>Integrity: {walkSummary.trustScore}%</Text>
                    <Text style={styles.summaryLine}>Points: {walkSummary.pointsEarned} XP</Text>
                </View>

                <TouchableOpacity
                    style={styles.completeButton}
                    onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Map' }] })}
                >
                    <Text style={styles.buttonText}>Done</Text>
                </TouchableOpacity>
            </ScrollView>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>{targetLocation?.name || 'Open Prayer Walk'}</Text>
                <Text style={styles.subTitle}>{session.branch || 'International'} Branch</Text>
                <View style={styles.timerBadge}>
                    <Text style={styles.timerText}>Time: {formatDuration(elapsedSeconds)}</Text>
                </View>
            </View>

            {participants.length > 0 && (
                <View style={styles.teamContainer}>
                    <Text style={styles.teamLabel}>Team:</Text>
                    <View style={styles.teamList}>
                        {participants.map((p, i) => (
                            <View key={i} style={styles.teamBadge}>
                                <Text style={styles.teamText}>{p}</Text>
                            </View>
                        ))}
                    </View>
                </View>
            )}

            {targetLocation && (
                <View style={styles.integrityBadge}>
                    <Text style={styles.integrityText}>🛡️ Route Integrity: {integrity}%</Text>
                </View>
            )}

            {currentLocation && (
                <View style={styles.mapCard}>
                    <MapView
                        style={styles.map}
                        initialRegion={{
                            latitude: currentLocation.latitude,
                            longitude: currentLocation.longitude,
                            latitudeDelta: 0.01,
                            longitudeDelta: 0.01,
                        }}
                        region={{
                            latitude: currentLocation.latitude,
                            longitude: currentLocation.longitude,
                            latitudeDelta: 0.01,
                            longitudeDelta: 0.01,
                        }}
                        showsUserLocation
                    >
                        {routePoints.length > 1 && (
                            <Polyline
                                coordinates={routePoints}
                                strokeColor="#1971C2"
                                strokeWidth={5}
                            />
                        )}
                        {targetCoords && (
                            <Marker
                                coordinate={targetCoords}
                                title={targetLocation?.name || 'Prayer Target'}
                                pinColor="#FF922B"
                            />
                        )}
                    </MapView>
                </View>
            )}

            {!isArrived ? (
                <View style={styles.statusBox}>
                    <Text style={styles.status}>
                        {targetLocation ? "Move towards the target..." : "Walk and pray..."}
                    </Text>
                    {targetLocation && distance !== null && (
                        <>
                            <Text style={styles.distance}>{Math.round(distance)}m away</Text>
                            <View style={styles.progressBar}>
                                <View style={[styles.progressFill, { width: `${100 - Math.min(100, (distance || 1000) / 10)}%` }]} />
                            </View>
                        </>
                    )}

                    <TouchableOpacity
                        style={[styles.completeButton, { marginTop: 30, backgroundColor: '#FA5252' }]}
                        onPress={handleComplete}
                        disabled={isCompleting}
                    >
                        <Text style={styles.buttonText}>{isCompleting ? 'Ending...' : 'End Prayer Walk'}</Text>
                    </TouchableOpacity>

                </View>
            ) : (
                <View style={styles.contentBox}>
                    <Text style={styles.unlocked}>✨ Arrived & Validated ✨</Text>
                    <Text style={styles.prayerTitle}>Prayer Focus</Text>
                    <Text style={styles.prayerText}>{prayerContent?.prayerText || "Loading..."}</Text>

                    {prayerContent?.prayers?.map((p: any) => (
                        <View key={p.id} style={styles.prayerItem}>
                            <Text style={styles.itemTitle}>{p.title}</Text>
                            <Text style={styles.itemContent}>{p.content}</Text>
                        </View>
                    ))}

                    <TouchableOpacity
                        style={styles.completeButton}
                        onPress={handleComplete}
                        disabled={isCompleting}
                    >
                        <Text style={styles.buttonText}>{isCompleting ? 'Ending...' : 'Confirm Prayer Completion'}</Text>
                    </TouchableOpacity>
                    {integrity < 70 && (
                        <Text style={styles.warning}>Low integrity. Follow the path to earn rewards.</Text>
                    )}
                </View>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        padding: 20,
        backgroundColor: '#F8F9FA',
        alignItems: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#1A1B1E',
        marginBottom: 10,
        textAlign: 'center',
    },
    integrityBadge: {
        backgroundColor: '#E7F5FF',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        marginBottom: 30,
    },
    integrityText: {
        color: '#228BE6',
        fontWeight: 'bold',
        fontSize: 12,
    },
    statusBox: {
        alignItems: 'center',
        padding: 40,
        backgroundColor: 'white',
        borderRadius: 20,
        width: '100%',
        elevation: 2,
    },
    status: {
        fontSize: 16,
        color: '#909296',
        marginBottom: 10,
    },
    distance: {
        fontSize: 48,
        fontWeight: '900',
        color: '#4C6EF5',
        marginVertical: 10,
    },
    progressBar: {
        height: 8,
        backgroundColor: '#E9ECEF',
        borderRadius: 4,
        width: '100%',
        marginTop: 20,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#4C6EF5',
    },
    contentBox: {
        width: '100%',
    },
    unlocked: {
        fontSize: 18,
        color: '#40C057',
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 20,
    },
    prayerTitle: {
        fontSize: 20,
        fontWeight: '800',
        marginBottom: 10,
    },
    prayerText: {
        fontSize: 16,
        lineHeight: 24,
        color: '#495057',
        marginBottom: 25,
    },
    prayerItem: {
        marginBottom: 15,
        padding: 15,
        backgroundColor: 'white',
        borderRadius: 12,
        borderLeftWidth: 4,
        borderLeftColor: '#4C6EF5',
    },
    itemTitle: {
        fontWeight: 'bold',
        fontSize: 16,
        marginBottom: 5,
    },
    itemContent: {
        color: '#495057',
    },
    completeButton: {
        backgroundColor: '#228BE6',
        padding: 18,
        borderRadius: 12,
        marginTop: 20,
        alignItems: 'center',
        width: '100%',
    },
    buttonText: {
        color: 'white',
        fontWeight: '800',
        fontSize: 16,
    },
    warning: {
        color: '#FA5252',
        fontSize: 12,
        textAlign: 'center',
        marginTop: 10,
    },
    header: {
        alignItems: 'center',
        marginBottom: 20,
    },
    timerBadge: {
        marginTop: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: '#FFF3BF',
        borderRadius: 14,
    },
    timerText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#5F3DC4',
    },
    subTitle: {
        fontSize: 16,
        color: '#666',
        marginTop: 5,
    },
    mapCard: {
        width: '100%',
        height: 220,
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 20,
        backgroundColor: '#fff',
        elevation: 2,
    },
    map: {
        width: '100%',
        height: '100%',
    },
    summaryCard: {
        width: '100%',
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    summaryLine: {
        fontSize: 16,
        marginBottom: 8,
        color: '#1A1B1E',
    },
    teamContainer: {
        width: '100%',
        backgroundColor: 'white',
        padding: 15,
        borderRadius: 12,
        marginBottom: 20,
        elevation: 1,
    },
    teamLabel: {
        fontWeight: 'bold',
        marginBottom: 10,
        color: '#555',
    },
    teamList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    teamBadge: {
        backgroundColor: '#e3f2fd',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 15,
        marginRight: 8,
        marginBottom: 8,
    },
    teamText: {
        color: '#1971c2',
        fontSize: 12,
        fontWeight: '600',
    }
});
