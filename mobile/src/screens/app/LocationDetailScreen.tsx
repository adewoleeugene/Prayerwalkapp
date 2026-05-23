import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MapPin, Star, Navigation } from 'lucide-react-native';

function DifficultyBadge({ difficulty }: { difficulty: string }) {
    const colors: Record<string, { bg: string; text: string }> = {
        easy: { bg: '#DCFCE7', text: '#15803D' },
        medium: { bg: '#FEF9C3', text: '#A16207' },
        hard: { bg: '#FEE2E2', text: '#B91C1C' },
    };
    const c = colors[difficulty] ?? colors.easy;
    return (
        <View style={[styles.badge, { backgroundColor: c.bg }]}>
            <Text style={[styles.badgeText, { color: c.text }]}>
                {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
            </Text>
        </View>
    );
}

export default function LocationDetailScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    const location = route.params?.location;

    if (!location) {
        return (
            <View style={styles.center}>
                <Text style={styles.errorText}>Location not found.</Text>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Text style={styles.backBtnText}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const handleStartWalk = () => {
        navigation.navigate('Map', { startLocation: location });
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack}>
                    <Text style={styles.headerBackText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle} numberOfLines={1}>{location.name}</Text>
                <View style={{ width: 60 }} />
            </View>

            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
                {/* Meta row */}
                <View style={styles.metaRow}>
                    {location.category ? (
                        <View style={styles.categoryBadge}>
                            <Text style={styles.categoryText}>{location.category}</Text>
                        </View>
                    ) : null}
                    <DifficultyBadge difficulty={location.difficulty ?? 'easy'} />
                    <View style={styles.pointsBadge}>
                        <Star size={13} color="#D97706" />
                        <Text style={styles.pointsText}>{location.points ?? 10} pts</Text>
                    </View>
                </View>

                {/* Address */}
                {location.address ? (
                    <View style={styles.addressRow}>
                        <MapPin size={14} color="#6B7280" />
                        <Text style={styles.addressText}>{location.address}</Text>
                    </View>
                ) : null}

                {/* Description */}
                {location.description ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>About this location</Text>
                        <Text style={styles.bodyText}>{location.description}</Text>
                    </View>
                ) : null}

                {/* Prayer text */}
                {location.prayerText || location.prayer_text ? (
                    <View style={styles.prayerBox}>
                        <Text style={styles.prayerLabel}>Prayer Focus</Text>
                        <Text style={styles.prayerText}>
                            {location.prayerText || location.prayer_text}
                        </Text>
                    </View>
                ) : null}

                {/* Radius info */}
                <View style={styles.infoRow}>
                    <Navigation size={14} color="#6B7280" />
                    <Text style={styles.infoText}>
                        Walk within {location.radiusMeters ?? location.radius_meters ?? 50}m of this location to complete it
                    </Text>
                </View>
            </ScrollView>

            <View style={styles.footer}>
                <TouchableOpacity style={styles.startButton} onPress={handleStartWalk}>
                    <Text style={styles.startButtonText}>Start Prayer Walk Here</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    errorText: {
        color: '#6B7280',
        fontSize: 16,
        marginBottom: 16,
    },
    backBtn: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        backgroundColor: '#E5E7EB',
        borderRadius: 8,
    },
    backBtnText: {
        color: '#374151',
        fontWeight: '600',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: Platform.OS === 'ios' ? 56 : 20,
        paddingBottom: 12,
        paddingHorizontal: 16,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    headerBack: {
        width: 60,
    },
    headerBackText: {
        color: '#4C6EF5',
        fontSize: 15,
        fontWeight: '600',
    },
    headerTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 17,
        fontWeight: '700',
        color: '#111827',
    },
    body: {
        padding: 20,
        paddingBottom: 40,
    },
    metaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
    },
    badge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: '600',
    },
    categoryBadge: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    categoryText: {
        color: '#1D4ED8',
        fontSize: 12,
        fontWeight: '600',
    },
    pointsBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#FEF3C7',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    pointsText: {
        color: '#92400E',
        fontSize: 12,
        fontWeight: '700',
    },
    addressRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        marginBottom: 16,
    },
    addressText: {
        flex: 1,
        color: '#6B7280',
        fontSize: 14,
        lineHeight: 20,
    },
    section: {
        marginBottom: 20,
    },
    sectionLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: '#6B7280',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 6,
    },
    bodyText: {
        fontSize: 15,
        color: '#374151',
        lineHeight: 22,
    },
    prayerBox: {
        backgroundColor: '#EFF6FF',
        borderLeftWidth: 4,
        borderLeftColor: '#4C6EF5',
        borderRadius: 8,
        padding: 16,
        marginBottom: 20,
    },
    prayerLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#4C6EF5',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    prayerText: {
        fontSize: 15,
        color: '#1E3A8A',
        lineHeight: 24,
        fontStyle: 'italic',
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        backgroundColor: '#F3F4F6',
        borderRadius: 8,
        padding: 12,
    },
    infoText: {
        flex: 1,
        color: '#6B7280',
        fontSize: 13,
        lineHeight: 18,
    },
    footer: {
        padding: 16,
        paddingBottom: Platform.OS === 'ios' ? 32 : 20,
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
    },
    startButton: {
        backgroundColor: '#4C6EF5',
        paddingVertical: 15,
        borderRadius: 14,
        alignItems: 'center',
        elevation: 4,
        shadowColor: '#4C6EF5',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
    },
    startButtonText: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 16,
    },
});
