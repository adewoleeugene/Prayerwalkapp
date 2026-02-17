import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Button, ActivityIndicator } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

export default function ProfileScreen() {
    const { user, logout } = useAuth();
    const [profile, setProfile] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            const res = await api.auth.me();
            setProfile(res.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <ActivityIndicator size="large" />;

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Profile</Text>
            <Text style={styles.label}>Name: {user?.name}</Text>
            <Text style={styles.label}>Email: {user?.email}</Text>

            {profile && (
                <View style={styles.stats}>
                    <Text>Total Distance: {profile.user.stats.totalDistanceMeters}m</Text>
                    <Text>Badges: {profile.user.stats.badgesCount}</Text>
                    <Text>Points: {profile.user.stats.totalPoints}</Text>
                </View>
            )}

            <Button title="Log Out" onPress={logout} color="red" />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        backgroundColor: '#fff',
        marginTop: 50,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
    },
    label: {
        fontSize: 18,
        marginBottom: 10,
    },
    stats: {
        marginTop: 20,
        marginBottom: 40,
        padding: 15,
        backgroundColor: '#f9f9f9',
        borderRadius: 8,
    }
});
