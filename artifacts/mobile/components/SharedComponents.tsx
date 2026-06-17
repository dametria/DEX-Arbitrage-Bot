import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useColors } from "@/hooks/useColors";

export const NETWORK_COLORS: Record<string, string> = {
  avalanche: "#e84142",
  arbitrum: "#28a0f0",
  optimism: "#ff0420",
};

export const NETWORK_LABELS: Record<string, string> = {
  avalanche: "AVAX",
  arbitrum: "ARB",
  optimism: "OP",
};

interface NetworkBadgeProps {
  network: string;
  size?: "sm" | "md";
}

export function NetworkBadge({ network, size = "md" }: NetworkBadgeProps) {
  const color = NETWORK_COLORS[network] ?? "#64748b";
  const label = NETWORK_LABELS[network] ?? network.toUpperCase().slice(0, 4);
  const fontSize = size === "sm" ? 9 : 10;
  const px = size === "sm" ? 5 : 7;
  const py = size === "sm" ? 2 : 3;
  return (
    <View
      style={[
        styles.networkBadge,
        {
          backgroundColor: color + "22",
          borderColor: color + "66",
          paddingHorizontal: px,
          paddingVertical: py,
        },
      ]}
    >
      <Text style={[styles.networkBadgeText, { color, fontSize }]}>
        {label}
      </Text>
    </View>
  );
}

interface PulseProps {
  active: boolean;
  size?: number;
}

export function PulseDot({ active, size = 10 }: PulseProps) {
  const colors = useColors();
  const opacity = useSharedValue(1);

  React.useEffect(() => {
    if (active) {
      opacity.value = withRepeat(withTiming(0.3, { duration: 900 }), -1, true);
    } else {
      opacity.value = 1;
    }
  }, [active, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const color = active ? colors.accent : colors.mutedForeground;

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        animStyle,
      ]}
    />
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: string;
  valueColor?: string;
}

export function StatCard({ label, value, icon, valueColor }: StatCardProps) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name={icon as never} size={14} color={colors.mutedForeground} />
      <Text style={[styles.statValue, { color: valueColor ?? colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

interface PriceCardProps {
  dex: string;
  network: string;
  price: number;
  liquidity: number;
  spread?: number;
}

export function PriceCard({
  dex,
  network,
  price,
  liquidity,
  spread,
}: PriceCardProps) {
  const colors = useColors();
  const spreadColor =
    spread !== undefined
      ? spread > 0.3
        ? colors.accent
        : spread > 0
          ? colors.warning
          : colors.mutedForeground
      : colors.mutedForeground;

  return (
    <View
      style={[
        styles.priceCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.priceCardHeader}>
        <View style={styles.priceCardLeft}>
          <Text
            style={[styles.dexName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {dex}
          </Text>
          <NetworkBadge network={network} size="sm" />
        </View>
        {spread !== undefined && (
          <Text style={[styles.spreadText, { color: spreadColor }]}>
            {spread > 0 ? "+" : ""}
            {spread.toFixed(3)}%
          </Text>
        )}
      </View>
      <Text style={[styles.priceValue, { color: colors.foreground }]}>
        ${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </Text>
      <Text style={[styles.liquidityText, { color: colors.mutedForeground }]}>
        Liq: ${(liquidity / 1_000_000).toFixed(2)}M
      </Text>
    </View>
  );
}

interface OpportunityCardProps {
  buyDex: string;
  sellDex: string;
  network: string;
  profitPct: number;
  estimatedProfit: number;
  hops: number;
  status: string;
  onPress?: () => void;
}

export function OpportunityCard({
  buyDex,
  sellDex,
  network,
  profitPct,
  estimatedProfit,
  hops,
  status,
  onPress,
}: OpportunityCardProps) {
  const colors = useColors();
  const statusColor =
    status === "executed"
      ? colors.success
      : status === "failed" || status === "reverted"
        ? colors.destructive
        : status === "executing"
          ? colors.warning
          : status === "expired"
            ? colors.mutedForeground
            : colors.accent;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[
        styles.oppCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: statusColor,
        },
      ]}
    >
      <View style={styles.oppHeader}>
        <View style={styles.oppRoute}>
          <Text
            style={[styles.oppDex, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {buyDex}
          </Text>
          <Feather name="arrow-right" size={12} color={colors.mutedForeground} />
          <Text
            style={[styles.oppDex, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {sellDex}
          </Text>
        </View>
        <Text style={[styles.oppProfit, { color: colors.accent }]}>
          +{profitPct.toFixed(3)}%
        </Text>
      </View>
      <View style={styles.oppFooter}>
        <NetworkBadge network={network} size="sm" />
        <Text style={[styles.oppMeta, { color: colors.mutedForeground }]}>
          {hops} hop{hops !== 1 ? "s" : ""}
        </Text>
        <Text style={[styles.oppEstimate, { color: colors.accent }]}>
          ~${estimatedProfit.toFixed(2)}
        </Text>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: statusColor },
          ]}
        />
        <Text style={[styles.oppMeta, { color: statusColor }]}>
          {status}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

interface TradeCardProps {
  buyDex: string;
  sellDex: string;
  network: string;
  profit: number;
  profitPct: number;
  gasCost: number;
  gasSource: string;
  status: string;
  executedAt: string;
  txHash?: string;
  errorMessage?: string;
}

export function TradeCard({
  buyDex,
  sellDex,
  network,
  profit,
  profitPct,
  gasCost,
  gasSource,
  status,
  executedAt,
  txHash,
  errorMessage,
}: TradeCardProps) {
  const colors = useColors();
  const isSuccess = status === "success";
  const profitColor = isSuccess
    ? profit >= 0
      ? colors.accent
      : colors.destructive
    : colors.destructive;

  const dateStr = new Date(executedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <View
      style={[
        styles.tradeCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: isSuccess ? colors.accent : colors.destructive,
        },
      ]}
    >
      <View style={styles.tradeHeader}>
        <View style={styles.oppRoute}>
          <Text
            style={[styles.oppDex, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {buyDex}
          </Text>
          <Feather name="arrow-right" size={11} color={colors.mutedForeground} />
          <Text
            style={[styles.oppDex, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {sellDex}
          </Text>
        </View>
        <Text style={[styles.tradeProfit, { color: profitColor }]}>
          {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
        </Text>
      </View>
      <View style={styles.tradeMeta}>
        <NetworkBadge network={network} size="sm" />
        <Text style={[styles.oppMeta, { color: colors.mutedForeground }]}>
          {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(3)}%
        </Text>
        <Text style={[styles.oppMeta, { color: colors.mutedForeground }]}>
          Gas: ${gasCost.toFixed(2)} ({gasSource})
        </Text>
      </View>
      <View style={styles.tradeFooter}>
        <Text style={[styles.tradeDate, { color: colors.mutedForeground }]}>
          {dateStr}
        </Text>
        {txHash && (
          <Text
            style={[styles.txHash, { color: colors.primary }]}
            numberOfLines={1}
          >
            {txHash.slice(0, 8)}...{txHash.slice(-6)}
          </Text>
        )}
      </View>
      {!isSuccess && errorMessage ? (
        <Text
          style={[styles.tradeError, { color: colors.destructive }]}
          numberOfLines={2}
        >
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  networkBadge: {
    borderRadius: 4,
    borderWidth: 1,
  },
  networkBadgeText: {
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
  },
  statLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  priceCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  priceCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  priceCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  dexName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    flex: 1,
  },
  spreadText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  priceValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    letterSpacing: -0.5,
  },
  liquidityText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginTop: 2,
  },
  oppCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 14,
    marginBottom: 8,
  },
  oppHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  oppRoute: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  oppDex: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    maxWidth: 90,
  },
  oppProfit: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
  },
  oppFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  oppMeta: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  oppEstimate: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    marginLeft: "auto" as never,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tradeCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 14,
    marginBottom: 8,
    gap: 8,
  },
  tradeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tradeProfit: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  tradeMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tradeFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tradeDate: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  txHash: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
  tradeError: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginTop: 6,
    lineHeight: 15,
  },
});
