import React from 'react';
import { View, Text } from 'react-native';

type Props = {
  participants: string[];
  styles: any;
};

export function TeamMembersCard({ participants, styles }: Props) {
  if (participants.length === 0) return null;

  return (
    <View style={[styles.card, styles.teamCard]}>
      <Text style={styles.cardSectionTitle}>Team Members</Text>
      <View style={styles.teamList}>
        {participants.map((p, i) => (
          <View key={`${p}-${i}`} style={styles.teamBadge}>
            <Text style={styles.teamText}>{p}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
