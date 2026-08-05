/**
 * JobMap (web) — react-native-maps cannot run in the browser (it imports
 * native-only react-native internals), so the web preview shows the same
 * data as a tidy list: teammates' positions first, then today's jobs.
 * The interactive map renders on the phone (Expo Go / native build).
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { JobMapProps } from './jobMapTypes';

export function JobMap({
  jobPins,
  staffPins,
  staffNameById,
  ownStaffId,
  onOpenJob,
  statusColors,
  statusLabel,
}: JobMapProps) {
  const colors = useColors();

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      <View style={[styles.note, { backgroundColor: colors.muted }]}>
        <Ionicons name="map-outline" size={16} color={colors.mutedForeground} />
        <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
          The interactive map shows on the phone app — here's today at a glance.
        </Text>
      </View>

      {staffPins.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Team</Text>
          {staffPins.map((s) => (
            <View
              key={`staff-${s.id}`}
              style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      s.position!.source === 'live' ? '#16a34a' : '#64748b',
                    borderRadius: 8,
                  },
                ]}
              />
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  {s.id === ownStaffId ? `${s.name} (you)` : s.name}
                </Text>
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                  {s.position!.source === 'live' ? 'Live location' : 'Home base'}
                </Text>
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Jobs</Text>
      {jobPins.length === 0 ? (
        <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
          No jobs on the map today.
        </Text>
      ) : (
        jobPins.map((b) => (
          <Pressable
            key={`job-${b.id}`}
            onPress={() => onOpenJob(b.id)}
            style={({ pressed }) => [
              styles.row,
              { borderColor: colors.border, backgroundColor: colors.card },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: statusColors[b.status] }]} />
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                {b.scheduledTime} — {b.firstName} {b.lastName}
              </Text>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                {statusLabel(b.status)} ·{' '}
                {b.staffId === null
                  ? 'Unassigned'
                  : b.staffId === ownStaffId
                    ? 'You'
                    : (staffNameById.get(b.staffId) ?? 'Assigned')}{' '}
                · {b.address}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 120, gap: 8 },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    marginBottom: 4,
  },
  noteText: { fontSize: 13, flex: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 10, marginBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
  },
  dot: { width: 12, height: 12, borderRadius: 3 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 13, marginTop: 2 },
});
