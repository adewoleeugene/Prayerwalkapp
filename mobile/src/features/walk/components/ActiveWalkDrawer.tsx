import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

type Props = {
  participants: string[];
  elapsedLabel: string;
  isEndingWalk: boolean;
  onEndWalk: () => void;
  styles: any;
};

export function ActiveWalkDrawer({ participants, elapsedLabel, isEndingWalk, onEndWalk, styles }: Props) {
  return (
    <View style={styles.activeWalkDrawer}>
      <View style={styles.activeWalkHeader}>
        <Text style={styles.activeWalkTitle}>Walk in Progress</Text>
        <Text style={styles.activeWalkTimer}>{elapsedLabel}</Text>
      </View>

      {participants.length > 0 && (
        <View style={styles.activeParticipantsWrap}>
          <Text style={styles.activeParticipantsLabel}>Participants</Text>
          <View style={styles.activeParticipantsList}>
            {participants.map((name, idx) => (
              <View key={`${name}-${idx}`} style={styles.activeParticipantChip}>
                <Text style={styles.activeParticipantText}>{name}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <TouchableOpacity
        style={styles.endWalkButton}
        onPress={onEndWalk}
        disabled={isEndingWalk}
      >
        <Text style={styles.endWalkButtonText}>End Walk</Text>
      </TouchableOpacity>
    </View>
  );
}
