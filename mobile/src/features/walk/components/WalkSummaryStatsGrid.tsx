import React from 'react';
import { View, Text } from 'react-native';
import { Clock, Navigation2, CheckCircle } from 'lucide-react-native';

type Props = {
  durationLabel: string;
  distanceKmLabel: string;
  pointsEarned: number;
  styles: any;
};

export function WalkSummaryStatsGrid({ durationLabel, distanceKmLabel, pointsEarned, styles }: Props) {
  return (
    <View style={styles.statsGrid}>
      <View style={styles.statBox}>
        <Clock size={24} color="#6366F1" />
        <Text style={styles.statValue}>{durationLabel}</Text>
        <Text style={styles.statLabel}>Duration</Text>
      </View>
      <View style={styles.statBox}>
        <Navigation2 size={24} color="#10B981" />
        <Text style={styles.statValue}>{distanceKmLabel}</Text>
        <Text style={styles.statLabel}>KM</Text>
      </View>
      <View style={styles.statBox}>
        <CheckCircle size={24} color="#F59E0B" />
        <Text style={styles.statValue}>{pointsEarned}</Text>
        <Text style={styles.statLabel}>XP Earned</Text>
      </View>
    </View>
  );
}
