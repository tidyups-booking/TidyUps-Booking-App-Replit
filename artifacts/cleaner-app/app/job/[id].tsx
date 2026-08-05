import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetBooking, useUpdateBooking } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import {
  useGetStaffMe,
  getGetStaffMeQueryKey,
  getGetBookingQueryKey,
} from '@workspace/api-client-react';

function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function formatService(type: string) {
  const map: Record<string, string> = {
    standard_clean: 'Standard Clean',
    deep_clean: 'Deep Clean',
    move_in_out: 'Move In/Out',
    move_in: 'Move-In Clean',
    move_out: 'Move-Out Clean',
    post_construction: 'Post Construction',
  };
  return map[type] ?? type;
}

function formatFrequency(f: string) {
  return f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StatusConfig {
  label: string;
  color: string;
  bg: string;
}

function statusConfig(status: string): StatusConfig {
  switch (status) {
    case 'pending':     return { label: 'Pending',     color: '#92400E', bg: '#FEF3C7' };
    case 'confirmed':   return { label: 'Confirmed',   color: '#065F46', bg: '#D1FAE5' };
    case 'in_progress': return { label: 'In Progress', color: '#1E40AF', bg: '#DBEAFE' };
    case 'completed':   return { label: 'Completed',   color: '#5B21B6', bg: '#EDE9FE' };
    case 'cancelled':   return { label: 'Cancelled',   color: '#991B1B', bg: '#FEE2E2' };
    default:            return { label: status,        color: '#374151', bg: '#F3F4F6' };
  }
}

function InfoRow({
  icon,
  label,
  value,
  colors,
}: {
  icon: string;
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: colors.muted }]}>
        <Ionicons name={icon as any} size={17} color={colors.mutedForeground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
          {label}
        </Text>
        <Text style={[styles.infoValue, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>
          {value}
        </Text>
      </View>
    </View>
  );
}

export default function JobDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = Number(id);

  // This route lives outside (home)'s StaffProvider, so resolve the caller's
  // staff record directly. The query is shared/cached with the provider's.
  //
  // Account-switch safety: because StaffProvider may not be mounted (deep link
  // straight to this screen right after switching accounts), mirror its guard
  // here — the moment the Clerk userId changes, PURGE both non-user-scoped
  // cache entries this screen reads (/staff/me AND the ID-keyed booking), and
  // keep both queries disabled + masked until the purge has run. Removing the
  // cache entries (not just masking) matters: once the guard lifts, the hooks
  // find an empty cache and must refetch under the NEW user's token — they can
  // never serve the previous cleaner's staff record or booking.
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef(userId);
  const userChanged = prevUserIdRef.current !== userId;
  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      // Purge BEFORE clearing the guard so no render can ever observe the old
      // user's cached data: by the time userChanged flips false, both entries
      // are gone and the hooks are in a fresh loading state.
      queryClient.removeQueries({ queryKey: getGetStaffMeQueryKey() });
      queryClient.removeQueries({ queryKey: getGetBookingQueryKey(bookingId) });
      prevUserIdRef.current = userId;
    }
  }, [userId, bookingId, queryClient]);

  const queriesEnabled = !!userId && !userChanged;
  const { data: meRaw } = useGetStaffMe({
    query: { enabled: queriesEnabled, retry: 2, retryDelay: 2_000, staleTime: 5 * 60 * 1_000 } as any,
  });
  const me = userChanged ? undefined : meRaw;
  const staffId = me?.id ?? null;
  const {
    data: bookingRaw,
    isLoading,
    isError,
  } = useGetBooking(bookingId, { query: { enabled: queriesEnabled } as any });
  const booking = userChanged ? undefined : bookingRaw;
  const { mutate: updateBooking, isPending: isUpdating } = useUpdateBooking();

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 20);

  const openMaps = () => {
    if (!booking) return;
    const addr = encodeURIComponent(`${booking.address}, ${booking.city}, ${booking.province ?? 'AB'}`);
    const url =
      Platform.OS === 'ios'
        ? `maps:?address=${addr}`
        : `https://maps.google.com/?q=${addr}`;
    void Linking.openURL(url);
  };

  const confirmStatusUpdate = (newStatus: 'in_progress' | 'completed') => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const label = newStatus === 'in_progress' ? 'Start Job' : 'Complete Job';
    Alert.alert(label, `Mark this job as ${newStatus.replace('_', ' ')}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: label,
        onPress: () =>
          updateBooking(
            { id: bookingId, data: { status: newStatus } },
            {
              onError: () =>
                Alert.alert('Error', 'Could not update status. Please try again.'),
            },
          ),
      },
    ]);
  };

  // --- Loading (treat a just-switched account as loading, never "not found") ---
  if (isLoading || userChanged) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // --- Error / not found ---
  if (isError || !booking) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <Ionicons name="cloud-offline-outline" size={52} color={colors.mutedForeground} />
        <Text style={[styles.notFoundText, { color: colors.foreground, fontFamily: 'Poppins_600SemiBold' }]}>
          Job not found
        </Text>
        <Pressable
          style={[styles.backBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
          onPress={() => router.back()}
        >
          <Text style={[{ color: colors.primary, fontFamily: 'Poppins_500Medium', fontSize: 15 }]}>
            Go back
          </Text>
        </Pressable>
      </View>
    );
  }

  const sc = statusConfig(booking.status);
  // Teammates' jobs are read-only: no status controls. The server enforces
  // this too, but we hide the buttons so cleaners aren't misled.
  const isMine = staffId != null && booking.staffId === staffId;
  const canStart = isMine && (booking.status === 'pending' || booking.status === 'confirmed');
  const canComplete = isMine && booking.status === 'in_progress';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <LinearGradient
        colors={[colors.primary, colors.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 14 }]}
      >
        <Pressable onPress={() => router.back()} style={styles.backArrow} testID="back-button">
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>

        <View style={[styles.statusChip, { backgroundColor: sc.bg }]}>
          <Text style={[styles.statusChipText, { color: sc.color, fontFamily: 'Poppins_600SemiBold' }]}>
            {sc.label}
          </Text>
        </View>
        <Text style={[styles.clientName, { fontFamily: 'Poppins_700Bold' }]}>
          {booking.firstName} {booking.lastName}
        </Text>
        <Text style={[styles.serviceLabel, { fontFamily: 'Poppins_400Regular' }]}>
          {formatService(booking.serviceType)}
        </Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: botPad }}>
        {/* Time / date / frequency */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <InfoRow icon="time-outline"    label="Time"      value={formatTime(booking.scheduledTime)} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <InfoRow icon="calendar-outline" label="Date"      value={booking.scheduledDate} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <InfoRow icon="repeat-outline"  label="Frequency" value={formatFrequency(booking.frequency)} colors={colors} />
        </View>

        {/* Address + directions */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <View style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: colors.primary + '18' }]}>
              <Ionicons name="location-outline" size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
                Address
              </Text>
              <Text style={[styles.infoValue, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>
                {booking.address}
              </Text>
              <Text style={[styles.infoSub, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
                {booking.city}, {booking.province ?? 'AB'} {booking.postalCode ?? ''}
              </Text>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.directionsBtn,
              { backgroundColor: colors.primary, borderRadius: colors.radius - 4 },
              pressed && { opacity: 0.82 },
            ]}
            onPress={openMaps}
            testID="directions-button"
          >
            <Ionicons name="navigate-outline" size={18} color="#fff" />
            <Text style={[styles.directionsBtnText, { fontFamily: 'Poppins_600SemiBold' }]}>
              Get Directions
            </Text>
          </Pressable>
        </View>

        {/* Job details */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <InfoRow icon="bed-outline"  label="Bedrooms"  value={String(booking.bedrooms)}  colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <InfoRow icon="water-outline" label="Bathrooms" value={String(booking.bathrooms)} colors={colors} />
          {booking.estimatedPrice != null && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <InfoRow icon="cash-outline" label="Estimated" value={`$${booking.estimatedPrice}`} colors={colors} />
            </>
          )}
          {booking.extras && booking.extras.length > 0 && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <InfoRow icon="list-outline" label="Extras" value={booking.extras.join(', ')} colors={colors} />
            </>
          )}
        </View>

        {/* Notes */}
        {booking.notes && (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: colors.muted }]}>
                <Ionicons name="document-text-outline" size={17} color={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
                  Notes
                </Text>
                <Text style={[styles.infoValue, { color: colors.foreground, fontFamily: 'Poppins_400Regular' }]}>
                  {booking.notes}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Status actions */}
        {(canStart || canComplete) && (
          <View style={styles.actionsRow}>
            {isUpdating ? (
              <View style={[styles.loadingBtn, { borderRadius: colors.radius }]}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : (
              <>
                {canStart && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtn,
                      { backgroundColor: '#3B82F6', borderRadius: colors.radius, flex: 1 },
                      pressed && { opacity: 0.82 },
                    ]}
                    onPress={() => confirmStatusUpdate('in_progress')}
                    testID="start-job-button"
                  >
                    <Ionicons name="play-circle-outline" size={20} color="#fff" />
                    <Text style={[styles.actionBtnText, { fontFamily: 'Poppins_600SemiBold' }]}>
                      Start Job
                    </Text>
                  </Pressable>
                )}
                {canComplete && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionBtn,
                      { backgroundColor: '#10B981', borderRadius: colors.radius, flex: 1 },
                      pressed && { opacity: 0.82 },
                    ]}
                    onPress={() => confirmStatusUpdate('completed')}
                    testID="complete-job-button"
                  >
                    <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                    <Text style={[styles.actionBtnText, { fontFamily: 'Poppins_600SemiBold' }]}>
                      Complete Job
                    </Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  notFoundText: { fontSize: 18 },
  backBtn: { paddingHorizontal: 22, paddingVertical: 10, borderWidth: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 26, gap: 6 },
  backArrow: { marginBottom: 10 },
  statusChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusChipText: { fontSize: 12 },
  clientName: { color: '#fff', fontSize: 26 },
  serviceLabel: { color: 'rgba(255,255,255,0.82)', fontSize: 15 },
  card: { borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  infoLabel: { fontSize: 11, marginBottom: 2 },
  infoValue: { fontSize: 15 },
  infoSub: { fontSize: 13, marginTop: 2 },
  divider: { height: 1, marginHorizontal: 14 },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    margin: 12,
    marginTop: 4,
    height: 44,
  },
  directionsBtnText: { color: '#fff', fontSize: 15 },
  actionsRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
  },
  actionBtnText: { color: '#fff', fontSize: 16 },
  loadingBtn: {
    flex: 1,
    height: 54,
    backgroundColor: '#6B7280',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
