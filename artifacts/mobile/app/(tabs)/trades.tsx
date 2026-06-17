import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetTradesQueryKey,
  useGetTrades,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { TradeCard } from "@/components/SharedComponents";

type TradeFilter = "all" | "success" | "failed";

export default function TradesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TradeFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const { data: trades = [], isLoading } = useGetTrades({
    query: {
      queryKey: getGetTradesQueryKey(),
      refetchInterval: 10000,
    },
  });

  const filtered =
    filter === "all"
      ? trades
      : filter === "failed"
        ? trades.filter((t) => t.status === "failed" || t.status === "reverted")
        : trades.filter((t) => t.status === filter);

  const totalProfit = trades
    .filter((t) => t.status === "success")
    .reduce((s, t) => s + t.profit, 0);
  const successCount = trades.filter((t) => t.status === "success").length;
  const failCount = trades.filter((t) => t.status !== "success").length;

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: getGetTradesQueryKey() });
    setRefreshing(false);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 20;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 16, borderBottomColor: colors.border },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Trade History
        </Text>
        <View style={styles.summaryRow}>
          <View
            style={[
              styles.summaryChip,
              { backgroundColor: colors.accent + "22", borderColor: colors.accent + "44" },
            ]}
          >
            <Feather name="check-circle" size={12} color={colors.accent} />
            <Text style={[styles.summaryText, { color: colors.accent }]}>
              {successCount} wins
            </Text>
          </View>
          <View
            style={[
              styles.summaryChip,
              {
                backgroundColor: colors.destructive + "22",
                borderColor: colors.destructive + "44",
              },
            ]}
          >
            <Feather name="x-circle" size={12} color={colors.destructive} />
            <Text style={[styles.summaryText, { color: colors.destructive }]}>
              {failCount} fails
            </Text>
          </View>
          <View
            style={[
              styles.summaryChip,
              {
                backgroundColor:
                  totalProfit >= 0
                    ? colors.accent + "22"
                    : colors.destructive + "22",
                borderColor:
                  totalProfit >= 0
                    ? colors.accent + "44"
                    : colors.destructive + "44",
              },
            ]}
          >
            <Feather
              name="trending-up"
              size={12}
              color={totalProfit >= 0 ? colors.accent : colors.destructive}
            />
            <Text
              style={[
                styles.summaryText,
                {
                  color:
                    totalProfit >= 0 ? colors.accent : colors.destructive,
                },
              ]}
            >
              ${totalProfit.toFixed(2)} P&L
            </Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          {(["all", "success", "failed"] as TradeFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[
                styles.filterBtn,
                {
                  backgroundColor:
                    filter === f ? colors.primary : colors.secondary,
                  borderColor:
                    filter === f ? colors.primary : colors.border,
                },
              ]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterBtnText,
                  {
                    color:
                      filter === f
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                  },
                ]}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {isLoading && filtered.length === 0 ? (
        <View style={styles.centerBox}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Loading trades...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TradeCard
              buyDex={item.buyDex}
              sellDex={item.sellDex}
              network={item.network}
              profit={item.profit}
              profitPct={item.profitPct}
              gasCost={item.gasCost}
              gasSource={item.gasSource}
              status={item.status}
              executedAt={item.executedAt}
              txHash={item.txHash}
              errorMessage={item.errorMessage}
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: bottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <Feather
                name="clock"
                size={28}
                color={colors.mutedForeground}
              />
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                No trades yet
              </Text>
              <Text
                style={[styles.emptySubText, { color: colors.mutedForeground }]}
              >
                Completed trades will appear here
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    letterSpacing: -0.5,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  summaryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  summaryText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  filterRow: {
    flexDirection: "row",
    gap: 6,
  },
  filterBtn: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  filterBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  listContent: {
    padding: 16,
  },
  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 8,
  },
  emptyText: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
  emptySubText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
});
