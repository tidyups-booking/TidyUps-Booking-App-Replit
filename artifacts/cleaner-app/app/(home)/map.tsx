/**
 * Live Map — shows today's jobs and teammates' live positions.
 * Same data source as the dispatcher web portal (GET /api/map/data).
 * View-only for cleaners: tapping a job opens the job details screen.
 *
 * The actual map rendering lives in components/JobMap (native) with a list
 * fallback in components/JobMap.web (react-native-maps is native-only).
 */
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useStaff } from '@/context/StaffContext';
import { useMapData, type MapBooking } from '@/hooks/useMapData';
import { JobMap } from '@/components/JobMap';
import type { JobPin } from '@/components/jobMapTypes';

// Edmonton fallback centre when nothing is geocoded yet.
const DEFAULT_REGION = {
  latitude: 53.5461,
  longitude: -113.4938,
  latitudeDelta: 0.35,
  longitudeDelta: 0.35,
};

const STATUS_COLORS: Record<MapBooking['status'], string> = {
  pending: '#d97706',
  confirmed: '#2563eb',
  in_progress: '#16a34a',
  completed: '#6b7280',
  cancelled: '#9ca3af',
};

function statusLabel(status: MapBooking['status']): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'pending':
      return 'Pending';
    case 'confirmed':
      return 'Confirmed';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
  }
}

export default function LiveMapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { staffId, isLoaded: staffLoaded, refetch: refetchStaff } = useStaff();
  const isWeb = Platform.OS === 'web';
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const { data, isLoading, isError, refetch } = useMapData(today);
  const notLinked = staffLoaded && staffId === null;
  const waiting = !staffLoaded || (isLoading && !notLinked);

  const jobPins = useMemo(
    () =>
      (data?.bookings ?? []).filter(
        (b): b is JobPin =>
          b.addressLat !== null && b.addressLng !== null && b.status !== 'cancelled',
      ),
    [data?.bookings],
  );

  const staffPins = useMemo(
    () => (data?.staff ?? []).filter((s) => s.position !== null),
    [data?.staff],
  );

  const staffNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of data?.staff ?? []) m.set(s.id, s.name);
    return m;
  }, [data?.staff]);

  const initialRegion = useMemo(() => {
    const coords = [
      ...jobPins.map((b) => ({ lat: b.addressLat, lng: b.addressLng })),
      ...staffPins.map((s) => ({ lat: s.position!.lat, lng: s.position!.lng })),
    ];
    if (coords.length === 0) return DEFAULT_REGION;
    const lats = coords.map((c) => c.lat);
    const lngs = coords.map((c) => c.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.05),
      longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.05),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobPins, staffPins]);

  const headerTopPad = isWeb ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: headerTopPad + 12,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Live Map</Text>
          <Pressable
            onPress={() => refetch()}
            hitSlop={12}
            style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.5 }]}
          >
            <Ionicons name="refresh" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {jobPins.length} job{jobPins.length === 1 ? '' : 's'} on the map today
        </Text>
      </View>

      {notLinked ? (
        <View style={styles.center}>
          <Ionicons name="person-circle-outline" size={48} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.foreground }]}>Account not linked</Text>
          <Text style={[styles.notLinkedSub, { color: colors.mutedForeground }]}>
            Ask your dispatcher to add your email to your staff record, then tap
            Check again.
          </Text>
          <Pressable
            onPress={() => refetchStaff()}
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.retryText}>Check again</Text>
          </Pressable>
        </View>
      ) : waiting ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.foreground }]}>
            Couldn't load the map
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <JobMap
            jobPins={jobPins}
            staffPins={staffPins}
            staffNameById={staffNameById}
            ownStaffId={staffId}
            initialRegion={initialRegion}
            onOpenJob={(id) => router.push(`/job/${id}`)}
            statusColors={STATUS_COLORS}
            statusLabel={statusLabel}
          />
          {!isWeb && (
            <View
              style={[
                styles.legend,
                {
                  bottom: insets.bottom + 50 + 12,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <LegendDot color={STATUS_COLORS.confirmed} label="Job" colors={colors} />
              <LegendDot
                color={STATUS_COLORS.in_progress}
                label="In progress"
                colors={colors}
              />
              <LegendDot color="#16a34a" label="Cleaner (live)" round colors={colors} />
              <LegendDot color="#64748b" label="Cleaner (home)" round colors={colors} />
            </View>
          )}
        </>
      )}
    </View>
  );
}

function LegendDot({
  color,
  label,
  round,
  colors,
}: {
  color: string;
  label: string;
  round?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[styles.legendSwatch, { backgroundColor: color, borderRadius: round ? 6 : 3 }]}
      />
      <Text style={[styles.legendText, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 14, marginTop: 2 },
  refreshBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 16, fontWeight: '600' },
  notLinkedSub: { fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: '#fff', fontWeight: '600' },
  legend: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 12, height: 12 },
  legendText: { fontSize: 12 },
});
