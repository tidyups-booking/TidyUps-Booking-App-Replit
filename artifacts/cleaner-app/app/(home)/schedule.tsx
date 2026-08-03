import React, { useMemo } from 'react';
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
import { useGetStaffSchedule } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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

export default function ScheduleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { staffId, isLoaded: staffLoaded } = useStaff();
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const { data: jobs = [], isLoading, isError, refetch } = useGetStaffSchedule(
    staffId ?? 0,
    { date: today },
    { query: { enabled: !!staffId, refetchInterval: 60_000, queryKey: [] as unknown[] } as any },
  );

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  // Enough bottom padding so last card clears the tab bar
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 90);

  const handleJobPress = (id: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/job/${id}`);
  };

  if (!staffLoaded) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

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
              <Text style={[styles.countNum, { fontFamily: 'Poppins_700Bold' }]}>{jobs.length}</Text>
              <Text style={[styles.countLabel, { fontFamily: 'Poppins_400Regular' }]}>
                {jobs.length === 1 ? 'job' : 'jobs'}
              </Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* Account not linked to a staff record */}
      {!staffId && (
        <View style={styles.emptyWrap}>
          <Ionicons name="person-circle-outline" size={60} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Poppins_600SemiBold' }]}>
            Account not linked
          </Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
            Ask your dispatcher to link your Clerk account to your staff record. Once linked, your jobs will appear here automatically.
          </Text>
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

      {/* Job list */}
      {staffId && !isLoading && !isError && (
        <FlatList
          data={jobs}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <JobCard booking={item} onPress={() => handleJobPress(item.id)} />
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: botPad }}
          scrollEnabled={!!jobs.length}
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
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingBottom: 22 },
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
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    padding: 36,
  },
  emptyTitle: { fontSize: 18, textAlign: 'center' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  retryBtn: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderWidth: 1,
  },
  retryText: { fontSize: 15 },
});
