import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getGetOpportunitiesQueryKey,
  getGetBotStatusQueryKey,
  useGetOpportunities,
  useWithdrawProfits,
  useInitDexConfigs,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { useBotContext } from "@/context/BotContext";
import { useColors } from "@/hooks/useColors";
import { OpportunityCard, PulseDot, StatCard } from "@/components/SharedComponents";

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bot = useBotContext();
  const { isConfigLoaded } = bot;
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);
  const [withdrawStatus, setWithdrawStatus] = React.useState<
    "idle" | "pending" | "success" | "error"
  >("idle");
  const [withdrawMsg, setWithdrawMsg] = React.useState<string>("");

  const { mutateAsync: withdraw, isPending: isWithdrawing } = useWithdrawProfits();

  const [initStatus, setInitStatus] = React.useState<
    "idle" | "pending" | "success" | "error"
  >("idle");
  const [initMsg, setInitMsg] = React.useState<string>("");
  const { mutateAsync: initDex, isPending: isIniting } = useInitDexConfigs();

  const handleInitDex = async () => {
   if (!isConfigLoaded) {
     setInitStatus("error");
     setInitMsg("Configuration still loading — try again");
     return;
   } 
   if (!bot.config.privateKey) {
      setInitStatus("error");
      setInitMsg("Enter your private key in Settings first");
      return;
    }
    await 

Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setInitStatus("pending");
    setInitMsg("");
    try {
      const result = await initDex({ data: { privateKey: bot.config.privateKey } });
      if (result.success) {
        const parts: string[] = [];
        if (result.configured.length > 0) parts.push(`Set: ${result.configured.join(", ")}`);
        if (result.alreadySet.length > 0) parts.push(`Already done: ${result.alreadySet.join(", ")}`);
        setInitStatus("success");
        setInitMsg(parts.join(" · ") || "All DEXs configured");
      } else {
        setInitStatus("error");
        setInitMsg(result.failed[0] ?? "Some DEXs failed to configure");
      }
    } catch {
      setInitStatus("error");
      setInitMsg("Network error — try again");
    }
    setTimeout(() => setInitStatus("idle"), 8000);
  };

  const { data: opportunities = [] } = useGetOpportunities({
    query: {
      queryKey: getGetOpportunitiesQueryKey(),
      refetchInterval: bot.isRunning ? 5000 : 10000,
    },
  });

  const pendingOpps = opportunities
    .filter((o) => o.status === "pending")
    .slice(0, 3);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetOpportunitiesQueryKey() });
    setRefreshing(false);
  }, [queryClient]);

  const handleWithdraw = async () => {
    if (!bot.config.privateKey || !bot.config.walletAddress) {
      setWithdrawStatus("error");
      setWithdrawMsg("Set wallet address and private key in Settings first");
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setWithdrawStatus("pending");
    setWithdrawMsg("");
    try {
      const result = await withdraw({
        data: {
          network: bot.config.networks[0] ?? "arbitrum",
          privateKey: bot.config.privateKey,
          toAddress: bot.config.walletAddress,
        },
      });
      if (result.status === "success") {
        setWithdrawStatus("success");
        setWithdrawMsg(`Sent to ${result.toAddress.slice(0, 6)}...${result.toAddress.slice(-4)}`);
      } else {
        setWithdrawStatus("error");
        setWithdrawMsg(result.errorMessage ?? "Withdrawal failed");
      }
    } catch {
      setWithdrawStatus("error");
      setWithdrawMsg("Network error — try again");
    }
    setTimeout(() => setWithdrawStatus("idle"), 6000);
  };

  const handleBotToggle = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (bot.isRunning) {
      await bot.stop();
    } else {
      router.push("/settings");
    }
  };

  const topPad =
    Platform.OS === "web" ? 67 : insets.top;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: topPad + 16,
          paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 20,
        },
      ]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.appTitle, { color: colors.foreground }]}>
            ArbBot
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            WBTC/USDT Flash Arbitrage
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/settings")}
          style={[styles.settingsBtn, { backgroundColor: colors.secondary }]}
          activeOpacity={0.7}
        >
          <Feather name="settings" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.statusCard,
          {
            backgroundColor: colors.card,
            borderColor: bot.isRunning ? colors.accent + "44" : colors.border,
          },
        ]}
      >
        <View style={styles.statusLeft}>
          <PulseDot active={bot.isRunning} size={12} />
          <View>
            <Text style={[styles.statusLabel, { color: colors.foreground }]}>
              {bot.isRunning ? "Bot Active" : "Bot Idle"}
            </Text>
            <Text style={[styles.statusSub, { color: colors.mutedForeground }]}>
              {bot.isRunning
                ? `Monitoring ${bot.config.networks.length} network${bot.config.networks.length !== 1 ? "s" : ""}`
                : "Press Start to initialize"}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={handleBotToggle}
          disabled={bot.isStarting || bot.isStopping}
          style={[
            styles.toggleBtn,
            {
              backgroundColor: bot.isRunning
                ? colors.destructive + "22"
                : colors.accent,
              borderColor: bot.isRunning ? colors.destructive : colors.accent,
            },
          ]}
          activeOpacity={0.8}
        >
          {bot.isStarting || bot.isStopping ? (
            <ActivityIndicator
              size="small"
              color={bot.isRunning ? colors.destructive : colors.accentForeground}
            />
          ) : (
            <Text
              style={[
                styles.toggleBtnText,
                {
                  color: bot.isRunning
                    ? colors.destructive
                    : colors.accentForeground,
                },
              ]}
            >
              {bot.isRunning ? "Stop" : "Start"}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {bot.error ? (
        <View
          style={[
            styles.errorBanner,
            { backgroundColor: colors.destructive + "22", borderColor: colors.destructive + "44" },
          ]}
        >
          <Feather name="alert-circle" size={14} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            {bot.error}
          </Text>
        </View>
      ) : null}

      <View style={styles.statsRow}>
        <StatCard
          label="Total P&L"
          value={`$${bot.totalProfit.toFixed(2)}`}
          icon="trending-up"
          valueColor={bot.totalProfit >= 0 ? colors.accent : colors.destructive}
        />
        <StatCard
          label="Trades"
          value={String(bot.totalTrades)}
          icon="activity"
        />
        <StatCard
          label="Win Rate"
          value={`${bot.successRate}%`}
          icon="award"
          valueColor={
            bot.successRate >= 70
              ? colors.accent
              : bot.successRate >= 40
                ? colors.warning
                : colors.destructive
          }
        />
      </View>

      <View
        style={[
          styles.withdrawCard,
          {
            backgroundColor: colors.card,
            borderColor:
              initStatus === "success" ? colors.accent + "66" :
              initStatus === "error"   ? colors.destructive + "66" :
              "#f59e0b66",
          },
        ]}
      >
        <View style={styles.withdrawLeft}>
          <Feather
            name="settings"
            size={16}
            color={
              initStatus === "success" ? colors.accent :
              initStatus === "error"   ? colors.destructive :
              "#f59e0b"
            }
          />
          <View>
            <Text style={[styles.withdrawLabel, { color: colors.foreground }]}>
              Initialize DEX Adapters
            </Text>
            <Text style={[styles.withdrawSub, { color:
              initStatus === "success" ? colors.accent :
              initStatus === "error"   ? colors.destructive :
              "#f59e0b"
            }]}>
              {initStatus === "idle"    ? "Required once before first trade" :
               initStatus === "pending" ? "Registering DEX routers on-chain…" :
               initStatus === "success" ? `✓ ${initMsg}` :
               `✗ ${initMsg}`}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={handleInitDex}
          disabled={isIniting || initStatus === "pending" || !isConfigLoaded}
          style={[
            styles.withdrawBtn,
            {
              backgroundColor:
                initStatus === "success" ? colors.accent + "22" :
                initStatus === "error"   ? colors.destructive + "22" :
                "#f59e0b22",
              borderColor:
                initStatus === "success" ? colors.accent :
                initStatus === "error"   ? colors.destructive :
                "#f59e0b",
              opacity: isIniting ? 0.6 : 1,
            },
          ]}
          activeOpacity={0.8}
        >
          {isIniting ? (
            <ActivityIndicator size="small" color="#f59e0b" />
          ) : (
            <Text style={[styles.withdrawBtnText, {
              color:
                initStatus === "success" ? colors.accent :
                initStatus === "error"   ? colors.destructive :
                "#f59e0b",
            }]}>
              {initStatus === "success" ? "Done" :
               initStatus === "error"   ? "Retry" :
               "Initialize"}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.withdrawCard,
          {
            backgroundColor: colors.card,
            borderColor:
              withdrawStatus === "success" ? colors.accent + "66" :
              withdrawStatus === "error"   ? colors.destructive + "66" :
              colors.border,
          },
        ]}
      >
        <View style={styles.withdrawLeft}>
          <Feather
            name="download"
            size={16}
            color={
              withdrawStatus === "success" ? colors.accent :
              withdrawStatus === "error"   ? colors.destructive :
              colors.primary
            }
          />
          <View>
            <Text style={[styles.withdrawLabel, { color: colors.foreground }]}>
              Withdraw Profits
            </Text>
            <Text style={[styles.withdrawSub, { color:
              withdrawStatus === "success" ? colors.accent :
              withdrawStatus === "error"   ? colors.destructive :
              colors.mutedForeground
            }]}>
              {withdrawStatus === "idle"    ? `Contract: 0x818D...500C on ${bot.config.networks[0] ?? "arbitrum"}` :
               withdrawStatus === "pending" ? "Sending transaction…" :
               withdrawStatus === "success" ? `✓ ${withdrawMsg}` :
               `✗ ${withdrawMsg}`}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={handleWithdraw}
          disabled={isWithdrawing || withdrawStatus === "pending"}
          style={[
            styles.withdrawBtn,
            {
              backgroundColor:
                withdrawStatus === "success" ? colors.accent + "22" :
                withdrawStatus === "error"   ? colors.destructive + "22" :
                colors.primary + "22",
              borderColor:
                withdrawStatus === "success" ? colors.accent :
                withdrawStatus === "error"   ? colors.destructive :
                colors.primary,
              opacity: isWithdrawing ? 0.6 : 1,
            },
          ]}
          activeOpacity={0.8}
        >
          {isWithdrawing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.withdrawBtnText, {
              color:
                withdrawStatus === "success" ? colors.accent :
                withdrawStatus === "error"   ? colors.destructive :
                colors.primary,
            }]}>
              {withdrawStatus === "success" ? "Done" :
               withdrawStatus === "error"   ? "Retry" :
               "Withdraw"}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.configRow}>
        <View
          style={[
            styles.configChip,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
        >
          <Feather name="zap" size={11} color={colors.primary} />
          <Text style={[styles.configChipText, { color: colors.primary }]}>
            {bot.config.gasSource === "flashloan"
              ? "Gas: Loan"
              : "Gas: Contract"}
          </Text>
        </View>
        <View
          style={[
            styles.configChip,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
        >
          <Feather name="percent" size={11} color={colors.mutedForeground} />
          <Text
            style={[styles.configChipText, { color: colors.mutedForeground }]}
          >
            Min: {bot.config.minProfitPct}%
          </Text>
        </View>
        <View
          style={[
            styles.configChip,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
        >
          <Feather name="sliders" size={11} color={colors.mutedForeground} />
          <Text
            style={[styles.configChipText, { color: colors.mutedForeground }]}
          >
            Slip: 1%
          </Text>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Live Opportunities
        </Text>
        <TouchableOpacity onPress={() => router.push("/(tabs)/opportunities")}>
          <Text style={[styles.seeAll, { color: colors.primary }]}>
            See all
          </Text>
        </TouchableOpacity>
      </View>

      {pendingOpps.length === 0 ? (
        <View
          style={[
            styles.emptyBox,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={22} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {bot.isRunning
              ? "Scanning for opportunities..."
              : "Start the bot to discover opportunities"}
          </Text>
        </View>
      ) : (
        pendingOpps.map((opp) => (
          <OpportunityCard
            key={opp.id}
            buyDex={opp.buyDex}
            sellDex={opp.sellDex}
            network={opp.network}
            profitPct={opp.profitPct}
            estimatedProfit={opp.estimatedProfit}
            hops={opp.hops}
            status={opp.status}
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  appTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    letterSpacing: -1,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  statusCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  statusLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  statusSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  toggleBtn: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 72,
    alignItems: "center",
  },
  toggleBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  errorBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    flex: 1,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  configRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  configChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  configChipText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  seeAll: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  emptyBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 32,
    alignItems: "center",
    gap: 10,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
  },
  withdrawCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  withdrawLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  withdrawLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  withdrawSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginTop: 2,
  },
  withdrawBtn: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 80,
    alignItems: "center",
  },
  withdrawBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
});
