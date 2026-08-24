import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { setBaseUrl } from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BotProvider } from "@/context/BotContext";

/**
 * Resolve API origin for web + native.
 * Priority:
 *   1. EXPO_PUBLIC_API_URL (full origin, e.g. https://host or http://localhost:3000)
 *   2. EXPO_PUBLIC_DOMAIN (host[:port] — http for localhost, https otherwise)
 *   3. Relative "" so web same-origin / Replit proxy can work
 */
function resolveApiBaseUrl(): string | null {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (domain) {
    const host = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!host || host === "undefined" || host === "null") return null;
    const isLocal =
      host.startsWith("localhost") ||
      host.startsWith("127.0.0.1") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.");
    return `${isLocal ? "http" : "https"}://${host}`;
  }

  // Web: same origin (works behind Replit proxy if API is routed there)
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return null;
}

const apiBase = resolveApiBaseUrl();
if (apiBase) {
  setBaseUrl(apiBase);
  console.log("[api] base URL:", apiBase);
} else {
  console.warn(
    "[api] No EXPO_PUBLIC_API_URL / EXPO_PUBLIC_DOMAIN — using relative paths",
  );
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5000,
    },
  },
});

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#07090e" },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="settings"
        options={{
          headerShown: false,
          presentation: "modal",
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <BotProvider>
                <RootLayoutNav />
              </BotProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
