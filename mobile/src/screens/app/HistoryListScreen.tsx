import React, { useEffect, useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    Platform,
    RefreshControl,
    Modal,
    ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api/client';

type WalkHistoryItem = {
    sessionId: string;
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
    walkerDisplayName?: string;
    points: Array<{ latitude: number; longitude: number }>;
};

type DaysFilter = 1 | 7 | 30 | 90;

function toDurationLabel(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes === 0) return '< 1m';
    return `${minutes}m`;
}

function toDistanceLabel(meters: number): string {
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
    return `${Math.round(meters)} m`;
}

function toWalkLabel(walk: WalkHistoryItem): string {
    const start = walk.startLocationName?.trim();
    const end = walk.endLocationName?.trim();
    if (start && end && start !== end) return `${start} → ${end}`;
    return end ?? start ?? walk.prayerFocus ?? 'Prayer Walk';
}

function StatusPill({ status }: { status: WalkHistoryItem['status'] }) {
    const map = {
        completed: { bg: '#DCFCE7', text: '#15803D', label: 'Completed' },
        active: { bg: '#DBEAFE', text: '#1D4ED8', label: 'Active' },
        abandoned: { bg: '#F3F4F6', text: '#6B7280', label: 'Abandoned' },
    };
    const c = map[status] ?? map.completed;
    return (
        <View style={[styles.statusPill, { backgroundColor: c.bg }]}>
            <Text style={[styles.statusPillText, { color: c.text }]}>{c.label}</Text>
        </View>
    );
}

function WalkDetailModal({
    walk,
    onClose,
}: {
    walk: WalkHistoryItem | null;
    onClose: () => void;
}) {
    if (!walk) return null;
    return (
        <Modal
            transparent
            visible
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalSheet}>
                    <View style={styles.modalHandle} />

                    <ScrollView showsVerticalScrollIndicator={false}>
                        <Text style={styles.modalTitle}>{toWalkLabel(walk)}</Text>

                        <StatusPill status={walk.status} />

                        <Text style={styles.modalMeta}>
                            {new Date(walk.startedAt).toLocaleString('en-GB', {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                        </Text>

                        <View style={styles.statsRow}>
                            <View style={styles.statItem}>
                                <Text style={styles.statValue}>{toDurationLabel(walk.durationSeconds)}</Text>
                                <Text style={styles.statLabel}>Duration</Text>
                            </View>
                            <View style={styles.statDivider} />
                            <View style={styles.statItem}>
                                <Text style={styles.statValue}>{toDistanceLabel(walk.distanceMeters)}</Text>
                                <Text style={styles.statLabel}>Distance</Text>
                            </View>
                            <View style={styles.statDivider} />
                            <View style={styles.statItem}>
                                <Text style={styles.statValue}>{walk.branch || '—'}</Text>
                                <Text style={styles.statLabel}>Branch</Text>
                            </View>
                        </View>

                        {walk.prayerSummary ? (
                            <View style={styles.summaryBox}>
                                <Text style={styles.summaryLabel}>Prayer Summary</Text>
                                <Text style={styles.summaryText}>{walk.prayerSummary}</Text>
                            </View>
                        ) : null}

                        {walk.prayerJournal ? (
                            <View style={[styles.summaryBox, { borderLeftColor: '#10B981' }]}>
                                <Text style={[styles.summaryLabel, { color: '#059669' }]}>Walk Journal</Text>
                                <Text style={styles.summaryText}>{walk.prayerJournal}</Text>
                            </View>
                        ) : null}
                    </ScrollView>

                    <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                        <Text style={styles.closeBtnText}>Close</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

export default function HistoryListScreen() {
    const navigation = useNavigation<any>();
    const [walks, setWalks] = useState<WalkHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [daysFilter, setDaysFilter] = useState<DaysFilter>(7);
    const [selectedWalk, setSelectedWalk] = useState<WalkHistoryItem | null>(null);

    const fetchHistory = useCallback(async (days: DaysFilter, isRefresh = false) => {
        if (!isRefresh) setLoading(true);
        try {
            const res = await api.walks.history(300, { days, walkType: 'all', includeActive: false });
            const routes: any[] = res.data?.routes ?? [];
            const parsed: WalkHistoryItem[] = routes
                .filter((r) => r.status !== 'active')
                .map((r) => ({
                    sessionId: String(r.sessionId),
                    branch: r.branch || 'Unknown',
                    status: r.status,
                    startedAt: String(r.startedAt),
                    endedAt: r.endedAt ?? null,
                    durationSeconds: Number(r.durationSeconds || 0),
                    distanceMeters: Number(r.distanceMeters || 0),
                    startLocationName: r.startLocationName ?? null,
                    endLocationName: r.endLocationName ?? null,
                    prayerSummary: r.prayerSummary ?? null,
                    prayerJournal: r.prayerJournal ?? null,
                    prayerFocus: r.prayerFocus || 'Prayer Walk',
                    walkerDisplayName: r.walkerDisplayName,
                    points: Array.isArray(r.points) ? r.points : [],
                }));
            setWalks(parsed);
        } catch {
            // Keep existing list on error
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchHistory(daysFilter);
    }, [daysFilter]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchHistory(daysFilter, true);
    };

    const FILTERS: { label: string; value: DaysFilter }[] = [
        { label: 'Today', value: 1 },
        { label: '7 days', value: 7 },
        { label: '30 days', value: 30 },
        { label: 'All', value: 90 },
    ];

    const renderItem = ({ item }: { item: WalkHistoryItem }) => (
        <TouchableOpacity style={styles.card} onPress={() => setSelectedWalk(item)} activeOpacity={0.7}>
            <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={2}>{toWalkLabel(item)}</Text>
                <StatusPill status={item.status} />
            </View>

            <Text style={styles.cardDate}>
                {new Date(item.startedAt).toLocaleString('en-GB', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                })}
            </Text>

            <View style={styles.cardStats}>
                <Text style={styles.cardStat}>⏱ {toDurationLabel(item.durationSeconds)}</Text>
                <Text style={styles.cardStatDivider}>·</Text>
                <Text style={styles.cardStat}>📍 {toDistanceLabel(item.distanceMeters)}</Text>
                <Text style={styles.cardStatDivider}>·</Text>
                <Text style={styles.cardStat}>{item.branch}</Text>
            </View>

            {item.prayerSummary ? (
                <Text style={styles.cardSummary} numberOfLines={2}>{item.prayerSummary}</Text>
            ) : null}
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack}>
                    <Text style={styles.headerBackText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Walk History</Text>
                <View style={{ width: 60 }} />
            </View>

            {/* Day filter chips */}
            <View style={styles.filtersRow}>
                {FILTERS.map((f) => (
                    <TouchableOpacity
                        key={f.value}
                        style={[styles.chip, daysFilter === f.value && styles.chipActive]}
                        onPress={() => setDaysFilter(f.value)}
                    >
                        <Text style={[styles.chipText, daysFilter === f.value && styles.chipTextActive]}>
                            {f.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#4C6EF5" />
                </View>
            ) : walks.length === 0 ? (
                <View style={styles.center}>
                    <Text style={styles.emptyText}>No walks recorded yet.</Text>
                    <Text style={styles.emptySubText}>Start a prayer walk from the map to see history here.</Text>
                </View>
            ) : (
                <FlatList
                    data={walks}
                    keyExtractor={(item) => item.sessionId}
                    renderItem={renderItem}
                    contentContainerStyle={styles.list}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4C6EF5" />
                    }
                    ListHeaderComponent={
                        <Text style={styles.countText}>{walks.length} walk{walks.length !== 1 ? 's' : ''}</Text>
                    }
                />
            )}

            <WalkDetailModal walk={selectedWalk} onClose={() => setSelectedWalk(null)} />
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
        padding: 32,
    },
    emptyText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
    },
    emptySubText: {
        fontSize: 14,
        color: '#9CA3AF',
        textAlign: 'center',
        lineHeight: 20,
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
    filtersRow: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 8,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    chip: {
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: '#F3F4F6',
    },
    chipActive: {
        backgroundColor: '#4C6EF5',
    },
    chipText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#6B7280',
    },
    chipTextActive: {
        color: '#FFFFFF',
    },
    list: {
        padding: 16,
        paddingBottom: 32,
    },
    countText: {
        fontSize: 13,
        color: '#9CA3AF',
        fontWeight: '500',
        marginBottom: 12,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 2,
    },
    cardTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 4,
        gap: 8,
    },
    cardTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: '700',
        color: '#111827',
        lineHeight: 20,
    },
    statusPill: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
    },
    statusPillText: {
        fontSize: 11,
        fontWeight: '700',
    },
    cardDate: {
        fontSize: 12,
        color: '#9CA3AF',
        marginBottom: 8,
    },
    cardStats: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    cardStat: {
        fontSize: 13,
        color: '#374151',
        fontWeight: '500',
    },
    cardStatDivider: {
        color: '#D1D5DB',
        fontSize: 13,
    },
    cardSummary: {
        marginTop: 8,
        fontSize: 13,
        color: '#6B7280',
        lineHeight: 18,
        fontStyle: 'italic',
    },
    // Modal
    modalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    modalSheet: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        paddingBottom: Platform.OS === 'ios' ? 40 : 24,
        maxHeight: '80%',
    },
    modalHandle: {
        alignSelf: 'center',
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#D1D5DB',
        marginBottom: 16,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 8,
    },
    modalMeta: {
        fontSize: 13,
        color: '#9CA3AF',
        marginTop: 6,
        marginBottom: 16,
    },
    statsRow: {
        flexDirection: 'row',
        backgroundColor: '#F9FAFB',
        borderRadius: 12,
        padding: 14,
        marginBottom: 16,
    },
    statItem: {
        flex: 1,
        alignItems: 'center',
    },
    statValue: {
        fontSize: 15,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 2,
    },
    statLabel: {
        fontSize: 11,
        color: '#9CA3AF',
        fontWeight: '500',
    },
    statDivider: {
        width: 1,
        backgroundColor: '#E5E7EB',
        marginVertical: 4,
    },
    summaryBox: {
        borderLeftWidth: 3,
        borderLeftColor: '#4C6EF5',
        backgroundColor: '#F8FAFF',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
    },
    summaryLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#4C6EF5',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 6,
    },
    summaryText: {
        fontSize: 14,
        color: '#374151',
        lineHeight: 21,
    },
    closeBtn: {
        marginTop: 8,
        paddingVertical: 13,
        borderRadius: 12,
        backgroundColor: '#F3F4F6',
        alignItems: 'center',
    },
    closeBtnText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#374151',
    },
});
