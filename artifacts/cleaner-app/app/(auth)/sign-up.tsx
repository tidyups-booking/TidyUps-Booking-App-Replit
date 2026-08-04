/**
 * Sign-up screen for the 833 Tidyups cleaner app.
 *
 * Cleaners create their own account here with the email their dispatcher put
 * on their staff record. After the email is verified, the API self-links the
 * account to the staff record (see api-server src/lib/callerRole.ts), so
 * their schedule loads automatically — no manual linking step.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSignUp } from '@clerk/expo/legacy';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { type Href, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export default function SignUpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, setActive, isLoaded } = useSignUp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSignUp = async () => {
    if (!isLoaded || !email || !password || isSubmitting) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      await signUp.create({ emailAddress: email.trim(), password });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (err: any) {
      setErrorMsg(
        err?.errors?.[0]?.longMessage ??
        err?.errors?.[0]?.message ??
        'Could not create the account. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async () => {
    if (!isLoaded || !code || isSubmitting) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const result = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/(home)/schedule' as Href);
      } else {
        setErrorMsg('Verification could not be completed. Please try again.');
      }
    } catch (err: any) {
      setErrorMsg(
        err?.errors?.[0]?.longMessage ??
        err?.errors?.[0]?.message ??
        'Invalid verification code.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 32);
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 16);

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.card,
      borderColor: colors.border,
      color: colors.foreground,
      borderRadius: colors.radius,
      fontFamily: 'Poppins_400Regular',
    },
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ paddingTop: topPad, paddingBottom: botPad, paddingHorizontal: 28 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand header */}
        <View style={styles.header}>
          <LinearGradient
            colors={[colors.primary, colors.secondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.logoCircle, { borderRadius: 20 }]}
          >
            <Ionicons name="sparkles" size={30} color="#fff" />
          </LinearGradient>
          <Text style={[styles.appName, { color: colors.foreground, fontFamily: 'Poppins_700Bold' }]}>
            {pendingVerification ? 'Check your email' : 'Create your account'}
          </Text>
          <Text style={[styles.appRole, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
            {pendingVerification
              ? `We sent a 6-digit code to ${email.trim()}`
              : 'Use the email your dispatcher has on file'}
          </Text>
        </View>

        {pendingVerification ? (
          <>
            {/* Verification code */}
            <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>
              Verification code
            </Text>
            <TextInput
              style={inputStyle}
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              autoCapitalize="none"
              autoCorrect={false}
              testID="code-input"
            />

            {errorMsg ? (
              <Text style={[styles.errorText, { color: colors.destructive, fontFamily: 'Poppins_400Regular' }]}>
                {errorMsg}
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { borderRadius: colors.radius },
                (!code || isSubmitting) && { opacity: 0.48 },
                pressed && { opacity: 0.8 },
              ]}
              onPress={handleVerify}
              disabled={!code || isSubmitting}
              testID="verify-button"
            >
              <LinearGradient
                colors={[colors.primary, colors.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              {isSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[styles.primaryBtnText, { fontFamily: 'Poppins_600SemiBold' }]}>Verify Email</Text>
              )}
            </Pressable>

            <Pressable onPress={() => { setPendingVerification(false); setCode(''); setErrorMsg(''); }}>
              <Text style={[styles.linkText, { color: colors.primary, fontFamily: 'Poppins_500Medium' }]}>
                Use a different email
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* Email */}
            <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>Email</Text>
            <TextInput
              style={inputStyle}
              value={email}
              onChangeText={setEmail}
              placeholder="your@email.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              testID="email-input"
            />

            {/* Password */}
            <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>
              Choose a password
            </Text>
            <View>
              <TextInput
                style={[...inputStyle, { paddingRight: 48 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="At least 8 characters"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
                testID="password-input"
              />
              <Pressable style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>

            {errorMsg ? (
              <Text style={[styles.errorText, { color: colors.destructive, fontFamily: 'Poppins_400Regular' }]}>
                {errorMsg}
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { borderRadius: colors.radius },
                (!email || !password || isSubmitting) && { opacity: 0.48 },
                pressed && { opacity: 0.8 },
              ]}
              onPress={handleSignUp}
              disabled={!email || !password || isSubmitting}
              testID="sign-up-button"
            >
              <LinearGradient
                colors={[colors.primary, colors.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              {isSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[styles.primaryBtnText, { fontFamily: 'Poppins_600SemiBold' }]}>Create Account</Text>
              )}
            </Pressable>

            <Pressable onPress={() => router.back()}>
              <Text style={[styles.linkText, { color: colors.primary, fontFamily: 'Poppins_500Medium' }]}>
                Already have an account? Sign in
              </Text>
            </Pressable>

            <Text style={[styles.inviteNote, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
              Your schedule appears automatically when you sign up with the same
              email your dispatcher added to the team list.
            </Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: 36 },
  logoCircle: { width: 68, height: 68, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  appName: { fontSize: 24, textAlign: 'center' },
  appRole: { fontSize: 14, marginTop: 6, textAlign: 'center', lineHeight: 20 },
  label: { fontSize: 14, marginBottom: 7 },
  input: { height: 50, borderWidth: 1, paddingHorizontal: 14, fontSize: 15, marginBottom: 16 },
  eyeBtn: { position: 'absolute', right: 12, top: 14 },
  errorText: { fontSize: 13, marginBottom: 10, marginTop: -8 },
  primaryBtn: {
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginTop: 6,
    marginBottom: 20,
  },
  primaryBtnText: { color: '#fff', fontSize: 16 },
  linkText: { fontSize: 14, textAlign: 'center', marginBottom: 20 },
  inviteNote: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
