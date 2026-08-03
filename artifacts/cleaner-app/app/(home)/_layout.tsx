import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { Redirect, Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { StaffProvider } from '@/context/StaffContext';
import { LocationProvider } from '@/context/LocationContext';

export default function HomeLayout() {
  const { isSignedIn, getToken, isLoaded } = useAuth();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const insets = useSafeAreaInsets();

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  // Register the Clerk bearer token getter BEFORE StaffProvider / LocationProvider
  // mount so the very first /staff/me request is authenticated.
  // Called synchronously in the render body (after the auth guard above confirms
  // isSignedIn=true) so it runs before any child useEffect or query fires.
  setAuthTokenGetter(() => getToken());

  return (
    <StaffProvider>
      <LocationProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.mutedForeground,
            tabBarStyle: {
              position: 'absolute',
              backgroundColor: isIOS ? 'transparent' : colors.background,
              borderTopWidth: isWeb ? 1 : 0,
              borderTopColor: colors.border,
              elevation: 0,
              paddingBottom: isIOS ? insets.bottom : 0,
              ...(isWeb ? { height: 84 } : {}),
            },
            tabBarBackground: () =>
              isIOS ? (
                <BlurView
                  intensity={100}
                  tint={isDark ? 'dark' : 'light'}
                  style={StyleSheet.absoluteFill}
                />
              ) : isWeb ? (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
              ) : null,
          }}
        >
          <Tabs.Screen
            name="schedule"
            options={{
              title: 'Schedule',
              tabBarIcon: ({ color }) =>
                isIOS ? (
                  <SymbolView name="calendar" tintColor={color} size={24} />
                ) : (
                  <Feather name="calendar" size={22} color={color} />
                ),
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              title: 'Profile',
              tabBarIcon: ({ color }) =>
                isIOS ? (
                  <SymbolView name="person" tintColor={color} size={24} />
                ) : (
                  <Feather name="user" size={22} color={color} />
                ),
            }}
          />
        </Tabs>
      </LocationProvider>
    </StaffProvider>
  );
}
