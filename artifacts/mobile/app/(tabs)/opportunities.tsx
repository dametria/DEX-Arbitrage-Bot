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
  getGetOpportunitiesQueryKey,
  useGetOpportunities,
} from "@workspace/api-client-react";

import { useBotContext } from "@/context/BotContext";
import { useColors } from "@/hooks/useColors";
import { OpportunityCard } from "@/components/SharedComponents";

type StatusFilter = "all" | "pending" | "executing" | "executed" | "failed";

const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "pending",
  "executing",
  "executed",
  "failed",
];

export default function OpportunitiesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bot = useBotContext();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const { data: opportunities = [], isLoading } = useGetOpportunities({
    query: {
      queryKey: getGetOpportunitiesQueryKey(),
      refetchInterval: bot.isRunning ? 4000 : 15000,
    },
  });

  const filtered =
    statusFilter === "all"
      ? opportunities
      : opportunities.filter((o) => o.status === statusFilter);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({
      queryKey: getGetOpportunitiesQueryKey(),
    });
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
        <View style={styles.titleRow}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Opportunities
          </Text>
          <View
            style={[
              styles.countBadge,
              { backgroundColor: colors.primary + "22" },
            ]}
          >
            <Text style={[styles.countText, { color: colors.primary }]}>
              {opportunities.filter((o) => o.status === "pending").length}
            </Text>
          </View>
        </View>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
          Flash loan arbitrage routes
        </Text>

        <View style={styles.filterRow}>
          {STATUS_FILTERS.map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setStatusFilter(s)}
              style={[
                styles.filterBtn,
                {
                  backgroundColor:
                    statusFilter === s ? colors.primary : colors.secondary,
                  borderColor:
                    statusFilter === s ? colors.primary : colors.border,
                },
              ]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterBtnText,
                  {
                    color:
                      statusFilter === s
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                  },
                ]}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {isLoading && filtered.length === 0 ? (
        <View style={styles.centerBox}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Scanning opportunities...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <OpportunityCard
              buyDex={item.buyDex}
              sellDex={item.sellDex}
              network={item.network}
              profitPct={item.profitPct}
              estimatedProfit={item.estimatedProfit}
              hops={item.hops}
              status={item.status}
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
                name="crosshair"
                size={28}
                color={colors.mutedForeground}
              />
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                {bot.isRunning
                  ? "No opportunities detected"
                  : "Start the bot to detect opportunities"}
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
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    letterSpacing: -0.5,
  },
  countBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
  },
  headerSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  filterRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
    flexWrap: "wrap",
  },
  filterBtn: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
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
    gap: 12,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
  },
});
