import React from 'react';
import { View, Text } from 'react-native';
import { Clock, Navigation2 } from 'lucide-react-native';

type Props = {
  elapsedLabel: string;
  distanceKmLabel: string;
  styles: any;
};

export function WalkLiveStatsRow({ elapsedLabel, distanceKmLabel, styles }: Props) {
  return (
    <View style={styles.liveStatsRow}>
      <View style={styles.liveStatItem}>
        <Clock size={20} color="#6366F1" />
        <Text style={styles.liveStatText}>{elapsedLabel}</Text>
      </View>
      <View style={styles.liveStatItem}>
        <Navigation2 size={20} color="#10B981" />
        <Text style={styles.liveStatText}>{distanceKmLabel} km</Text>
      </View>
    </View>
  );
}
