/**
 * Sign-in screen for the 833 Tidyups cleaner app.
 * New cleaners create their own account on the sign-up screen with the email
 * their dispatcher put on their staff record; the API self-links the account
 * to the staff record on first request (api-server src/lib/callerRole.ts).
 */
import React, { useState, useCallback, useEffect } from 'react';
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
import { useSignIn } from '@clerk/expo/legacy';
import { useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { type Href, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { startSSOFlow } = useSSO();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Warm up Android browser for OAuth
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);

  const navigateHome = useCallback(() => {
    router.replace('/(home)/schedule' as Href);
  }, [router]);

  const handleSignIn = async () => {
    if (!isLoaded || !email || !password || isSubmitting) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        navigateHome();
      } else {
        setErrorMsg('Sign-in could not be completed. Please try again.');
      }
    } catch (err: any) {
      const msg =
        err?.errors?.[0]?.longMessage ??
        err?.errors?.[0]?.message ??
        'Invalid email or password.';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setErrorMsg('');
    try {
      const { createdSessionId, setActive: ssoSetActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && ssoSetActive) {
        await ssoSetActive({ session: createdSessionId });
        navigateHome();
      }
    } catch (err: any) {
      setErrorMsg(
        err?.errors?.[0]?.longMessage ??
        err?.errors?.[0]?.message ??
        'Google sign-in failed.',
      );
    }
  }, [startSSOFlow, navigateHome]);

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 32);
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 16);

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
            833 Tidyups
          </Text>
          <Text style={[styles.appRole, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
            Cleaner App
          </Text>
        </View>

        {/* Google */}
        <Pressable
          style={({ pressed }) => [
            styles.socialBtn,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            pressed && { opacity: 0.72 },
          ]}
          onPress={handleGoogleSignIn}
        >
          <Ionicons name="logo-google" size={18} color={colors.foreground} />
          <Text style={[styles.socialBtnText, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>
            Continue with Google
          </Text>
        </Pressable>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
            or
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        {/* Email */}
        <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>Email</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
              borderRadius: colors.radius,
              fontFamily: 'Poppins_400Regular',
            },
          ]}
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
        <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Poppins_500Medium' }]}>Password</Text>
        <View>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius,
                fontFamily: 'Poppins_400Regular',
                paddingRight: 48,
              },
            ]}
            value={password}
            onChangeText={setPassword}
            placeholder="Enter password"
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

        {/* Sign in button */}
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            { borderRadius: colors.radius },
            (!email || !password || isSubmitting) && { opacity: 0.48 },
            pressed && { opacity: 0.8 },
          ]}
          onPress={handleSignIn}
          disabled={!email || !password || isSubmitting}
          testID="sign-in-button"
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
            <Text style={[styles.primaryBtnText, { fontFamily: 'Poppins_600SemiBold' }]}>Sign In</Text>
          )}
        </Pressable>

        {/* Create account link */}
        <Pressable onPress={() => router.push('/(auth)/sign-up' as Href)} testID="go-to-sign-up">
          <Text style={[styles.signUpLink, { color: colors.primary, fontFamily: 'Poppins_500Medium' }]}>
            First time here? Create your account
          </Text>
        </Pressable>

        {/* Team-only notice */}
        <Text style={[styles.inviteNote, { color: colors.mutedForeground, fontFamily: 'Poppins_400Regular' }]}>
          For 833 Tidyups team members. Sign up with the email your dispatcher
          has on file and your schedule connects automatically.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: 36 },
  logoCircle: { width: 68, height: 68, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  appName: { fontSize: 26 },
  appRole: { fontSize: 14, marginTop: 3 },
  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 50,
    borderWidth: 1,
    marginBottom: 18,
  },
  socialBtnText: { fontSize: 15 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 13 },
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
    marginBottom: 16,
  },
  primaryBtnText: { color: '#fff', fontSize: 16 },
  signUpLink: { fontSize: 14, textAlign: 'center', marginBottom: 18 },
  inviteNote: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
