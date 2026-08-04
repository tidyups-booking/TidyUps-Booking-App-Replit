import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGetStaffSchedule, useGetDaySchedule } from '@workspace/api-client-react';
import type { Booking } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useUser } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { useStaff } from '@/context/StaffContext';
import { JobCard } from '@/components/JobCard';

function formatTodayLong() {
  return new Date().toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

type ViewMode = 'mine' | 'all';

type TeamJob = { booking: Booking; staffId: number; staffName: string };

export default function ScheduleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { staffId, isLoaded: staffLoaded, refetch: refetchStaff } = useStaff();
  const { user } = useUser();
  const signedInEmail = user?.primaryEmailAddress?.emailAddress ?? null;
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [viewMode, setViewMode] = useState<ViewMode>('mine');

  const {
    data: myJobs = [],
    isLoading: myLoading,
    isError: myError,
    refetch: refetchMine,
  } = useGetStaffSchedule(
    staffId ?? 0,
    { date: today },
    { query: { enabled: !!staffId, refetchInterval: 60_000, queryKey: [] as unknown[] } as any },
  );

  const {
    data: teamSchedules = [],
    isLoading: teamLoading,
    isError: teamError,
    refetch: refetchTeam,
  } = useGetDaySchedule(
    { date: today },
    {
      query: {
        enabled: !!staffId && viewMode === 'all',
        refetchInterval: 60_000,
        queryKey: [] as unknown[],
      } as any,
    },
  );

  // Flatten the per-staff team schedule into one time-ordered list.
  const teamJobs: TeamJob[] = useMemo(() => {
    const flat: TeamJob[] = [];
    for (const entry of teamSchedules) {
      for (const booking of entry.bookings) {
        flat.push({ booking, staffId: entry.staff.id, staffName: entry.staff.name });
      }
    }
    flat.sort((a, b) => a.booking.scheduledTime.localeCompare(b.booking.scheduledTime));
    return flat;
  }, [teamSchedules]);

  const showAll = viewMode === 'all';
  const isLoading = showAll ? teamLoading : myLoading;
  const isError = showAll ? teamError : myError;
  const refetch = showAll ? refetchTeam : refetchMine;
  const jobCount = showAll ? teamJobs.length : myJobs.length;

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  // Enough bottom padding so last card clears the tab bar
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 90);

  const handleJobPress = (id: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/job/${id}`);
  };

  const handleModeChange = (mode: ViewMode) => {
    if (mode === viewMode) return;
    void Haptics.selectionAsync();
    setViewMode(mode);
  };

  if (!staffLoaded) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const renderToggle = () => (
    <View style={styles.toggleWrap}>
      {(
        [
          ['mine', 'My jobs'],
          ['all', 'All jobs'],
        ] as [ViewMode, string][]
      ).map(([mode, label]) => {
        const active = viewMode === mode;
        return (
          <Pressable
            key={mode}
            testID={`schedule-toggle-${mode}`}
            style={[styles.toggleBtn, active && styles.toggleBtnActive]}
            onPress={() => handleModeChange(mode)}
          >
            <Text
              style={[
                styles.toggleText,
                {
                  color: active ? colors.primary : 'rgba(255,255,255,0.85)',
                  fontFamily: active ? 'Poppins_600SemiBold' : 'Poppins_500Medium',
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Gradient header */}
      <LinearGradient
        colors={[colors.primary, colors.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 18 }]}
      >
        <View style={styles.headerContent}>
          <View>
            <Text style={[styles.headerSub, { fontFamily: 'Poppins_400Regular' }]}>Today</Text>
            <Text style={[styles.headerDate, { fontFamily: 'Poppins_700Bold' }]}>
              {formatTodayLong()}
            </Text>
          </View>
          {staffId && (
            <View style={styles.countBubble}>
              <Text style={[styles.countNum, { fontFamily: 'Poppins_700Bold' }]}>{jobCount}</Text>
              <Text style={[styles.countLabel, { fontFamily: 'Poppins_400Regular' }]}>
                {jobCount === 1 ? 'job' : 'jobs'}
              </Text>
            </View>
          )}
        </View>
        {staffId ? renderToggle() : null}
      </LinearGradient>

      {/* Account not linked to a staff record */}
      {!staffId && (
        <View style={styles.emptyWrap}>
          <Ionicons name="person-circle-outline" size={60} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Poppins_600SemiBold' }]}>
            Account not linked
          </Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
            Your account was created, but it isn't connected to a staff record
            yet. Ask your dispatcher to add this email to your staff record,
            then tap Check again:
          </Text>
          {signedInEmail && (
            <Text style={[styles.emptyEmail, { color: colors.foreground, fontFamily: 'Poppins_600SemiBold' }]}>
              {signedInEmail}
            </Text>
          )}
          <Pressable
            style={[styles.retryBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
            onPress={() => refetchStaff()}
          >
            <Text style={[styles.retryText, { color: '#fff', fontFamily: 'Poppins_600SemiBold' }]}>Check again</Text>
          </Pressable>
        </View>
      )}

      {/* Loading */}
      {staffId && isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {/* Error */}
      {staffId && isError && (
        <View style={styles.emptyWrap}>
          <Ionicons name="cloud-offline-outline" size={52} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Poppins_600SemiBold' }]}>
            Couldn't load schedule
          </Text>
          <Pressable
            style={[styles.retryBtn, { borderColor: colors.border, borderRadius: colors.radius }]}
            onPress={() => refetch()}
          >
            <Text style={[styles.retryText, { color: colors.primary, fontFamily: 'Poppins_500Medium' }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      )}

      {/* My jobs list */}
      {staffId && !isLoading && !isError && !showAll && (
        <FlatList
          data={myJobs}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <JobCard booking={item} onPress={() => handleJobPress(item.id)} />
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: botPad }}
          scrollEnabled={!!myJobs.length}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="checkmark-circle-outline" size={60} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Poppins_600SemiBold' }]}>
                No jobs today
              </Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
                You're all clear — enjoy your day off!
              </Text>
            </View>
          }
        />
      )}

      {/* Whole-team jobs list */}
      {staffId && !isLoading && !isError && showAll && (
        <FlatList
          data={teamJobs}
          keyExtractor={(item) => String(item.booking.id)}
          renderItem={({ item }) => {
            const isMine = item.staffId === staffId;
            return (
              <JobCard
                booking={item.booking}
                assigneeName={isMine ? `${item.staffName} (you)` : item.staffName}
                // Only your own jobs open the detail screen — status changes
                // on other cleaners' jobs are blocked by the server anyway.
                onPress={isMine ? () => handleJobPress(item.booking.id) : () => {}}
              />
            );
          }}
          contentContainerStyle={{ padding: 16, paddingBottom: botPad }}
          scrollEnabled={!!teamJobs.length}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="people-outline" size={60} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Poppins_600SemiBold' }]}>
                No team jobs today
              </Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
                Nobody has a job scheduled for today.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingBottom: 18 },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  headerSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  headerDate: { color: '#fff', fontSize: 17, marginTop: 2 },
  countBubble: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  countNum: { color: '#fff', fontSize: 26 },
  countLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
  toggleWrap: {
    flexDirection: 'row',
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12,
    padding: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 10,
  },
  toggleBtnActive: {
    backgroundColor: '#fff',
  },
  toggleText: { fontSize: 13 },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    padding: 36,
  },
  emptyTitle: { fontSize: 18, textAlign: 'center' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  emptyEmail: { fontSize: 15, textAlign: 'center', marginTop: 10 },
  retryBtn: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderWidth: 1,
  },
  retryText: { fontSize: 15 },
});
