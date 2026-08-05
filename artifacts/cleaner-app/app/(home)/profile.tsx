import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateStaff, getGetStaffMeQueryKey } from '@workspace/api-client-react';
import { useUser, useClerk } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useStaff } from '@/context/StaffContext';
import { useLocation } from '@/context/LocationContext';

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { staffId, staffName, staffPhone, staffEmail, isLoaded: staffLoaded, isLinked, refetch: refetchStaff } = useStaff();
  const { status: locationStatus, lastUpdate, requestPermission } = useLocation();

  // Contact info editing — same email shape validation as the web app
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const queryClient = useQueryClient();
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const updateStaff = useUpdateStaff();

  // Seed the inputs from the staff record once it loads (and on refetch)
  useEffect(() => {
    setPhoneInput(staffPhone ?? '');
    setEmailInput(staffEmail ?? '');
  }, [staffPhone, staffEmail]);

  const isDirty =
    (phoneInput.trim() || '') !== (staffPhone ?? '') ||
    (emailInput.trim() || '') !== (staffEmail ?? '');

  const handleSaveContact = () => {
    if (!staffId) return;
    const trimmedEmail = emailInput.trim();
    const trimmedPhone = phoneInput.trim();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setEmailError('Please enter a valid email address, e.g. name@example.com.');
      return;
    }
    setEmailError(null);
    setSaved(false);
    updateStaff.mutate(
      {
        id: staffId,
        data: {
          // phone is an optional string in the API contract (empty string clears it);
          // email accepts null/empty to clear.
          phone: trimmedPhone,
          email: trimmedEmail || null,
        },
      },
      {
        onSuccess: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setSaved(true);
          queryClient.invalidateQueries({ queryKey: getGetStaffMeQueryKey() });
        },
        onError: (err: any) => {
          const msg =
            err?.error ?? err?.message ?? 'Could not save your contact info. Please try again.';
          Alert.alert('Save failed', String(msg));
        },
      },
    );
  };

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 90);

  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.emailAddresses?.[0]?.emailAddress ?? '';
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const initials = (displayName?.[0] ?? email?.[0] ?? '?').toUpperCase();

  const locationStatusConfig: Record<string, { label: string; color: string }> = {
    idle:        { label: 'Not started', color: colors.mutedForeground },
    requesting:  { label: 'Requesting permission…', color: colors.primary },
    active:      { label: lastUpdate ? `Active · ${lastUpdate.toLocaleTimeString()}` : 'Active', color: '#10B981' },
    denied:      { label: 'Permission denied', color: colors.destructive },
    unavailable: { label: 'Unavailable on this device', color: colors.destructive },
  };
  const locConf = locationStatusConfig[locationStatus];

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          await signOut();
          // Drop every cached authenticated query (schedule, map, staff/me)
          // so a different account signing in on this device never sees the
          // previous user's data.
          queryClient.clear();
          router.replace('/(auth)/sign-in');
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* User header */}
      <View
        style={[
          styles.userHeader,
          { paddingTop: topPad + 18, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <View style={[styles.avatar, { backgroundColor: colors.primary + '22' }]}>
          <Text style={[styles.avatarText, { color: colors.primary, fontFamily: 'Poppins_700Bold' }]}>
            {initials}
          </Text>
        </View>
        <Text style={[styles.userName, { color: colors.foreground, fontFamily: 'Poppins_600SemiBold' }]}>
          {displayName}
        </Text>
        {email && displayName !== email && (
          <Text style={[styles.userEmail, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
            {email}
          </Text>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
      >
        {/* Staff identity card */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Poppins_500Medium' }]}>
          YOUR PROFILE
        </Text>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          {!staffLoaded ? (
            <View style={styles.cardRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.cardSub, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular', marginLeft: 10 }]}>
                Looking up your staff account…
              </Text>
            </View>
          ) : isLinked ? (
            <View style={styles.cardRow}>
              <View style={[styles.iconBox, { backgroundColor: colors.primary + '18' }]}>
                <Ionicons name="person-circle-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>
                  {staffName}
                </Text>
                <Text style={[styles.cardSub, { color: '#10B981', fontFamily: 'Poppins_400Regular' }]}>
                  Account linked · ID #{staffId}
                </Text>
              </View>
              <Ionicons name="checkmark-circle" size={22} color="#10B981" />
            </View>
          ) : (
            <View>
              <View style={styles.cardRow}>
                <View style={[styles.iconBox, { backgroundColor: colors.muted }]}>
                  <Ionicons name="person-outline" size={20} color={colors.mutedForeground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>
                    Account not linked
                  </Text>
                  <Text style={[styles.cardSub, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
                    Ask a dispatcher to link your Clerk account to your staff record.
                  </Text>
                </View>
              </View>
              <Pressable
                style={[styles.retryBtn, { borderColor: colors.primary, borderRadius: colors.radius - 4 }]}
                onPress={() => refetchStaff()}
              >
                <Text style={[styles.retryText, { color: colors.primary, fontFamily: 'Poppins_500Medium' }]}>
                  Check again
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Contact info card (only shown when linked) */}
        {isLinked && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Poppins_500Medium', marginTop: 18 }]}>
              CONTACT INFO
            </Text>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
              ]}
            >
              <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontFamily: 'Poppins_500Medium' }]}>
                Phone
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    borderRadius: colors.radius - 4,
                    backgroundColor: colors.background,
                    fontFamily: 'Poppins_400Regular',
                  },
                ]}
                value={phoneInput}
                onChangeText={(t) => { setPhoneInput(t); setSaved(false); }}
                placeholder="(555) 555-5555"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                autoComplete="tel"
              />
              <Text style={[styles.inputLabel, { color: colors.mutedForeground, fontFamily: 'Poppins_500Medium', marginTop: 12 }]}>
                Email
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: emailError ? colors.destructive : colors.border,
                    borderRadius: colors.radius - 4,
                    backgroundColor: colors.background,
                    fontFamily: 'Poppins_400Regular',
                  },
                ]}
                value={emailInput}
                onChangeText={(t) => { setEmailInput(t); setEmailError(null); setSaved(false); }}
                placeholder="name@example.com"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
              />
              {emailError && (
                <Text style={[styles.errorText, { color: colors.destructive, fontFamily: 'Poppins_400Regular' }]}>
                  {emailError}
                </Text>
              )}
              <Pressable
                style={[
                  styles.saveBtn,
                  {
                    backgroundColor: isDirty && !updateStaff.isPending ? colors.primary : colors.muted,
                    borderRadius: colors.radius - 4,
                  },
                ]}
                disabled={!isDirty || updateStaff.isPending}
                onPress={handleSaveContact}
              >
                {updateStaff.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text
                    style={[
                      styles.saveText,
                      {
                        color: isDirty ? colors.primaryForeground ?? '#fff' : colors.mutedForeground,
                        fontFamily: 'Poppins_500Medium',
                      },
                    ]}
                  >
                    Save Contact Info
                  </Text>
                )}
              </Pressable>
              {saved && !isDirty && (
                <Text style={[styles.savedText, { fontFamily: 'Poppins_400Regular' }]}>
                  ✓ Saved
                </Text>
              )}
            </View>
          </>
        )}

        {/* GPS status card (only shown when linked) */}
        {isLinked && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Poppins_500Medium', marginTop: 18 }]}>
              LOCATION SHARING
            </Text>
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
              ]}
            >
              <View style={styles.cardRow}>
                <View style={[styles.iconBox, { backgroundColor: colors.primary + '18' }]}>
                  <Ionicons name="location" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>
                    GPS Sharing
                  </Text>
                  <Text style={[styles.cardSub, { color: locConf.color, fontFamily: 'Poppins_400Regular' }]}>
                    {locConf.label}
                  </Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: locConf.color }]} />
              </View>
              {locationStatus === 'denied' && (
                <Pressable
                  style={[styles.retryBtn, { borderColor: colors.primary, borderRadius: colors.radius - 4, marginTop: 10 }]}
                  onPress={requestPermission}
                >
                  <Text style={[styles.retryText, { color: colors.primary, fontFamily: 'Poppins_500Medium' }]}>
                    Enable location
                  </Text>
                </Pressable>
              )}
              <Text style={[styles.gpsNote, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
                Shared automatically between 8 AM and 8 PM.
              </Text>
            </View>
          </>
        )}

        {/* Account section */}
        <Text
          style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: 'Poppins_500Medium', marginTop: 18 }]}
        >
          ACCOUNT
        </Text>

        <Pressable
          style={({ pressed }) => [
            styles.signOutBtn,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            pressed && { opacity: 0.7 },
          ]}
          onPress={handleSignOut}
        >
          <Ionicons name="log-out-outline" size={20} color={colors.destructive} />
          <Text style={[styles.signOutText, { color: colors.destructive, fontFamily: 'Poppins_500Medium' }]}>
            Sign Out
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  userHeader: { alignItems: 'center', paddingBottom: 20, borderBottomWidth: 1 },
  avatar: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  avatarText: { fontSize: 28 },
  userName: { fontSize: 18 },
  userEmail: { fontSize: 13, marginTop: 3 },
  sectionLabel: { fontSize: 11, letterSpacing: 1, marginBottom: 10, marginLeft: 2 },
  card: { borderWidth: 1, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  cardTitle: { fontSize: 14 },
  cardSub: { fontSize: 12, marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  retryBtn: { marginTop: 12, paddingVertical: 9, alignItems: 'center', borderWidth: 1 },
  retryText: { fontSize: 14 },
  gpsNote: { fontSize: 11, marginTop: 10, textAlign: 'center' },
  inputLabel: { fontSize: 11, letterSpacing: 0.5, marginBottom: 6 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  errorText: { fontSize: 12, marginTop: 6 },
  saveBtn: { marginTop: 14, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 14 },
  savedText: { fontSize: 12, marginTop: 8, textAlign: 'center', color: '#10B981' },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderWidth: 1 },
  signOutText: { fontSize: 15 },
});
