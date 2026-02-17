import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useNavigation } from '@react-navigation/native';

// Use secure tunnel for WebSockets
const WS_URL = 'wss://charis-prayer-live-v101.loca.lt/ws';

export default function WalkScreen({ route }: { route: any }) {
    const { session, targetLocation } = route.params;
    const { token } = useAuth();
    const navigation = useNavigation<any>();
    const [distance, setDistance] = useState<number | null>(null);
    const [participants, setParticipants] = useState<string[]>([]);

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

    const connectWebSocket = () => {
        ws.current = new WebSocket(`${WS_URL}?token=${token}`);
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
        const loc = await Location.getCurrentPositionAsync({});
        try {
            const res = await api.walks.complete(
                sessionIdRef.current,
                targetLocation?.id,
                loc.coords.latitude,
                loc.coords.longitude
            );

            if (res.data.success) {
                Alert.alert('Walk Validated!', `Integrity: ${res.data.trustScore}% \nEarned: ${res.data.pointsEarned} XP`, [
                    { text: 'Praise God', onPress: () => navigation.navigate('Map') }
                ]);
            } else {
                Alert.alert('Validation Error', res.data.error || 'Walk integrity too low.');
            }
        } catch (e: any) {
            Alert.alert('Error', e.response?.data?.error || 'Failed to complete walk');
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>{targetLocation?.name || 'Open Prayer Walk'}</Text>
                <Text style={styles.subTitle}>{session.branch || 'International'} Branch</Text>
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

                    {!targetLocation && (
                        <TouchableOpacity
                            style={[styles.completeButton, { marginTop: 40, backgroundColor: '#FA5252' }]}
                            onPress={handleComplete}
                        >
                            <Text style={styles.buttonText}>End Prayer Walk</Text>
                        </TouchableOpacity>
                    )}
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
                        style={[styles.completeButton, integrity < 70 && { opacity: 0.5 }]}
                        onPress={handleComplete}
                        disabled={integrity < 50}
                    >
                        <Text style={styles.buttonText}>Confirm Prayer Completion</Text>
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
    subTitle: {
        fontSize: 16,
        color: '#666',
        marginTop: 5,
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
