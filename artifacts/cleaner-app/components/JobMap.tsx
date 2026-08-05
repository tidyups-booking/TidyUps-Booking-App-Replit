/**
 * JobMap (native) — interactive map with job pins and teammate positions.
 * Web builds resolve JobMap.web.tsx instead; react-native-maps must never be
 * imported on web (it pulls native-only react-native internals and breaks
 * the whole web bundle).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import type { JobMapProps } from './jobMapTypes';

export function JobMap({
  jobPins,
  staffPins,
  staffNameById,
  ownStaffId,
  initialRegion,
  onOpenJob,
  statusColors,
  statusLabel,
}: JobMapProps) {
  return (
    <MapView style={styles.map} initialRegion={initialRegion}>
      {jobPins.map((b) => (
        <Marker
          key={`job-${b.id}`}
          coordinate={{ latitude: b.addressLat, longitude: b.addressLng }}
          pinColor={statusColors[b.status]}
          title={`${b.scheduledTime} — ${b.firstName} ${b.lastName}`}
          description={`${statusLabel(b.status)} · ${
            b.staffId === null
              ? 'Unassigned'
              : b.staffId === ownStaffId
                ? 'You'
                : (staffNameById.get(b.staffId) ?? 'Assigned')
          } · ${b.address}`}
          onCalloutPress={() => onOpenJob(b.id)}
        />
      ))}
      {staffPins.map((s) => (
        <Marker
          key={`staff-${s.id}`}
          coordinate={{ latitude: s.position!.lat, longitude: s.position!.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          title={s.id === ownStaffId ? `${s.name} (you)` : s.name}
          description={s.position!.source === 'live' ? 'Live location' : 'Home base'}
        >
          <View
            style={[
              styles.staffDot,
              { backgroundColor: s.position!.source === 'live' ? '#16a34a' : '#64748b' },
            ]}
          >
            <Text style={styles.staffDotText}>
              {s.name
                .split(' ')
                .map((p) => p[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </Text>
          </View>
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  staffDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  staffDotText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
