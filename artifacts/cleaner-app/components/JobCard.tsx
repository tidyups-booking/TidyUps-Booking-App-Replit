import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { Booking } from '@workspace/api-client-react';

interface JobCardProps {
  booking: Booking;
  onPress: () => void;
  /** Shown when viewing the whole team's schedule and the job belongs to someone else (or is unassigned). */
  assigneeName?: string | null;
  /** When set, renders a Claim button (unassigned jobs in the team view). */
  onClaim?: () => void;
  /** Disables the Claim button while a claim request is in flight. */
  claiming?: boolean;
}

function statusStyle(status: string) {
  switch (status) {
    case 'confirmed':   return { bg: '#D1FAE5', text: '#065F46', dot: '#10B981' };
    case 'in_progress': return { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' };
    case 'completed':   return { bg: '#EDE9FE', text: '#5B21B6', dot: '#7C3AED' };
    case 'cancelled':   return { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444' };
    default:            return { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' };
  }
}

function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
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

export function JobCard({ booking, onPress, assigneeName, onClaim, claiming }: JobCardProps) {
  const colors = useColors();
  const st = statusStyle(booking.status);

  return (
    <Pressable
      testID={`job-card-${booking.id}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
        pressed && { opacity: 0.82 },
      ]}
      onPress={onPress}
    >
      {/* Time + status */}
      <View style={styles.topRow}>
        <View style={styles.timeRow}>
          <Ionicons name="time-outline" size={13} color={colors.primary} />
          <Text style={[styles.time, { color: colors.primary, fontFamily: 'Poppins_600SemiBold' }]}>
            {formatTime(booking.scheduledTime)}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: st.bg }]}>
          <View style={[styles.dot, { backgroundColor: st.dot }]} />
          <Text style={[styles.badgeText, { color: st.text, fontFamily: 'Poppins_500Medium' }]}>
            {booking.status.replace('_', ' ')}
          </Text>
        </View>
      </View>

      {/* Client */}
      <Text style={[styles.client, { color: colors.foreground, fontFamily: 'Poppins_600SemiBold' }]}>
        {booking.firstName} {booking.lastName}
      </Text>

      {/* Address */}
      <View style={styles.addressRow}>
        <Ionicons name="location-outline" size={13} color={colors.mutedForeground} />
        <Text
          style={[styles.address, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}
          numberOfLines={1}
        >
          {booking.address}, {booking.city}
        </Text>
      </View>

      {/* Assignee (team view) */}
      {assigneeName !== undefined && (
        <View style={styles.addressRow}>
          <Ionicons name="person-outline" size={13} color={colors.mutedForeground} />
          <Text
            style={[styles.address, { color: colors.mutedForeground, fontFamily: 'Poppins_500Medium' }]}
            numberOfLines={1}
          >
            {assigneeName ?? 'Unassigned'}
          </Text>
        </View>
      )}

      {/* Details */}
      <View style={styles.detailsRow}>
        <Detail icon="brush-outline" text={formatService(booking.serviceType)} colors={colors} />
        <Detail icon="bed-outline" text={`${booking.bedrooms}bd / ${booking.bathrooms}ba`} colors={colors} />
        {booking.estimatedPrice != null && (
          <Text style={[styles.price, { color: colors.primary, fontFamily: 'Poppins_600SemiBold' }]}>
            ${booking.estimatedPrice}
          </Text>
        )}
      </View>

      {/* Claim (unassigned jobs in team view) */}
      {onClaim && (
        <Pressable
          testID={`job-claim-${booking.id}`}
          disabled={claiming}
          onPress={(e) => {
            // Don't also open the job detail underneath
            e.stopPropagation();
            onClaim();
          }}
          style={({ pressed }) => [
            styles.claimBtn,
            { backgroundColor: colors.primary, borderRadius: colors.radius },
            (pressed || claiming) && { opacity: 0.7 },
          ]}
        >
          <Ionicons name="hand-right-outline" size={15} color="#fff" />
          <Text style={[styles.claimText, { fontFamily: 'Poppins_600SemiBold' }]}>
            {claiming ? 'Claiming…' : 'Claim this job'}
          </Text>
        </Pressable>
      )}

      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} style={styles.chevron} />
    </Pressable>
  );
}

function Detail({ icon, text, colors }: { icon: string; text: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.detail}>
      <Ionicons name={icon as any} size={12} color={colors.mutedForeground} />
      <Text style={[styles.detailText, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { fontSize: 13 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    gap: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, textTransform: 'capitalize' },
  client: { fontSize: 16, marginBottom: 4 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  address: { fontSize: 13, flex: 1 },
  detailsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  detailText: { fontSize: 12 },
  price: { fontSize: 13 },
  chevron: { position: 'absolute', right: 12, top: '50%', marginTop: -8 },
  claimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 12,
    paddingVertical: 10,
  },
  claimText: { color: '#fff', fontSize: 14 },
});
