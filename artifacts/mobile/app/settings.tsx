import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBotContext, type BotConfig } from "@/context/BotContext";
import { useColors } from "@/hooks/useColors";

const NETWORKS = ["avalanche", "arbitrum", "optimism"] as const;
const NETWORK_LABELS: Record<string, string> = {
  avalanche: "Avalanche (AVAX)",
  arbitrum: "Arbitrum One",
  optimism: "Optimism",
};

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bot = useBotContext();

  const [gasSource, setGasSource] = useState<"flashloan" | "contract">(
    bot.config.gasSource,
  );
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>(
    bot.config.networks,
  );
  const [minProfitPct, setMinProfitPct] = useState(bot.config.minProfitPct);
  const [walletAddress, setWalletAddress] = useState(bot.config.walletAddress);
  const [privateKey, setPrivateKey] = useState(bot.config.privateKey);
  const [showKey, setShowKey] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 20;

  const toggleNetwork = (net: string) => {
    setSelectedNetworks((prev) =>
      prev.includes(net) ? prev.filter((n) => n !== net) : [...prev, net],
    );
  };

  const handleStart = async () => {
    if (selectedNetworks.length === 0) {
      Alert.alert("Error", "Select at least one network to monitor.");
      return;
    }
    if (!walletAddress.trim()) {
      Alert.alert("Error", "Wallet address is required to execute trades.");
      return;
    }
    if (!privateKey.trim()) {
      Alert.alert("Error", "Private key is required to sign transactions.");
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const cfg: BotConfig = {
      gasSource,
      networks: selectedNetworks,
      minProfitPct,
      slippageTolerance: 0.01,
      walletAddress: walletAddress.trim(),
      privateKey: privateKey.trim(),
    };
    await bot.start(cfg);
    router.back();
  };

  const handleSave = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await bot.updateConfig({
      gasSource,
      networks: selectedNetworks,
      minProfitPct,
      walletAddress: walletAddress.trim(),
      privateKey: privateKey.trim(),
    });
    router.back();
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: bottomPad },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.secondary }]}
          activeOpacity={0.7}
        >
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Bot Settings
        </Text>
      </View>

      <View style={styles.warningBanner}>
        <Feather name="shield" size={14} color={colors.warning} />
        <Text style={[styles.warningText, { color: colors.warning }]}>
          Your private key is stored locally only. Never share it with anyone.
        </Text>
      </View>

      <Section title="Gas Fee Source" colors={colors}>
        <Text style={[styles.sectionDesc, { color: colors.mutedForeground }]}>
          Choose where gas fees are paid from on each transaction.
        </Text>
        {(["flashloan", "contract"] as const).map((opt) => (
          <TouchableOpacity
            key={opt}
            onPress={() => setGasSource(opt)}
            activeOpacity={0.8}
            style={[
              styles.radioRow,
              {
                backgroundColor:
                  gasSource === opt
                    ? colors.primary + "15"
                    : colors.secondary,
                borderColor:
                  gasSource === opt ? colors.primary : colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.radioCircle,
                {
                  borderColor:
                    gasSource === opt ? colors.primary : colors.mutedForeground,
                },
              ]}
            >
              {gasSource === opt && (
                <View
                  style={[
                    styles.radioFill,
                    { backgroundColor: colors.primary },
                  ]}
                />
              )}
            </View>
            <View style={styles.radioLabel}>
              <Text style={[styles.radioTitle, { color: colors.foreground }]}>
                {opt === "flashloan"
                  ? "Flash Loan (recommended)"
                  : "Contract Wallet"}
              </Text>
              <Text
                style={[styles.radioDesc, { color: colors.mutedForeground }]}
              >
                {opt === "flashloan"
                  ? "Gas fees deducted from flash loan proceeds"
                  : "Gas fees paid from contract balance"}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </Section>

      <Section title="Networks" colors={colors}>
        <Text style={[styles.sectionDesc, { color: colors.mutedForeground }]}>
          Select networks to monitor. Minimum 3 DEXs per network.
        </Text>
        {NETWORKS.map((net) => {
          const active = selectedNetworks.includes(net);
          return (
            <TouchableOpacity
              key={net}
              onPress={() => toggleNetwork(net)}
              activeOpacity={0.8}
              style={[
                styles.checkRow,
                {
                  backgroundColor: active
                    ? colors.accent + "15"
                    : colors.secondary,
                  borderColor: active
                    ? colors.accent + "66"
                    : colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: active ? colors.accent : "transparent",
                    borderColor: active
                      ? colors.accent
                      : colors.mutedForeground,
                  },
                ]}
              >
                {active && (
                  <Feather name="check" size={12} color={colors.accentForeground} />
                )}
              </View>
              <Text style={[styles.checkLabel, { color: colors.foreground }]}>
                {NETWORK_LABELS[net]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </Section>

      <Section title="Profit Threshold" colors={colors}>
        <Text style={[styles.sectionDesc, { color: colors.mutedForeground }]}>
          Minimum profit percentage to trigger execution. Default: 0.15%
        </Text>
        <View style={styles.thresholdRow}>
          {[0.15, 0.2, 0.3, 0.5, 0.75, 1.0].map((v) => (
            <TouchableOpacity
              key={v}
              onPress={() => setMinProfitPct(v)}
              activeOpacity={0.8}
              style={[
                styles.thresholdBtn,
                {
                  backgroundColor:
                    minProfitPct === v
                      ? colors.primary
                      : colors.secondary,
                  borderColor:
                    minProfitPct === v ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.thresholdText,
                  {
                    color:
                      minProfitPct === v
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                  },
                ]}
              >
                {v}%
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Section>

      <Section title="Execution Settings" colors={colors}>
        <View style={styles.infoRow}>
          <Feather name="sliders" size={14} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Slippage tolerance: 1% (fixed)
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Feather name="dollar-sign" size={14} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Flash loan amount: $10,000 USDT
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Feather name="git-branch" size={14} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Max route hops: 2
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Feather name="shield" size={14} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Anti-frontrun: deadline + gas bump
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Feather name="zap" size={14} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Flash loan provider: Aave V3
          </Text>
        </View>
      </Section>

      <Section title="Wallet" colors={colors}>
        <Text style={[styles.sectionDesc, { color: colors.mutedForeground }]}>
          Required to execute on-chain transactions.
        </Text>
        <View style={styles.inputWrapper}>
          <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
            Wallet Address
          </Text>
          <TextInput
            value={walletAddress}
            onChangeText={setWalletAddress}
            placeholder="0x..."
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              {
                backgroundColor: colors.secondary,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.inputWrapper}>
          <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
            Private Key
          </Text>
          <View style={styles.pkRow}>
            <TextInput
              value={privateKey}
              onChangeText={setPrivateKey}
              placeholder={showKey ? "0x..." : "••••••••••••••••••••"}
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showKey}
              style={[
                styles.input,
                styles.pkInput,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              onPress={() => setShowKey((v) => !v)}
              style={[styles.eyeBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              activeOpacity={0.7}
            >
              <Feather
                name={showKey ? "eye-off" : "eye"}
                size={18}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
          </View>
        </View>
      </Section>

      <View style={styles.btnGroup}>
        <TouchableOpacity
          onPress={handleStart}
          disabled={bot.isStarting}
          style={[
            styles.startBtn,
            { backgroundColor: bot.isStarting ? colors.accent + "66" : colors.accent },
          ]}
          activeOpacity={0.85}
        >
          {bot.isStarting ? (
            <ActivityIndicator size="small" color={colors.accentForeground} />
          ) : (
            <>
              <Feather name="play" size={18} color={colors.accentForeground} />
              <Text
                style={[styles.startBtnText, { color: colors.accentForeground }]}
              >
                Start Bot
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSave}
          style={[
            styles.saveBtn,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
          activeOpacity={0.7}
        >
          <Text style={[styles.saveBtnText, { color: colors.mutedForeground }]}>
            Save & Close
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 20 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    letterSpacing: -0.5,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#f59e0b18",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#f59e0b33",
    padding: 12,
  },
  warningText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },
  section: { gap: 8 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    letterSpacing: 0.3,
  },
  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  sectionDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 17,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 12,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  radioLabel: { flex: 1 },
  radioTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  radioDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  thresholdRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  thresholdBtn: {
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  thresholdText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  inputWrapper: { gap: 6 },
  inputLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  pkRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  pkInput: { flex: 1 },
  eyeBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGroup: { gap: 10 },
  startBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  startBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  saveBtn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
});
