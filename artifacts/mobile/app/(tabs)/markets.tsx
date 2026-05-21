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
import { Feather } from "@expo/vector-icons";

import {
  getGetPricesQueryKey,
  useGetPrices,
  type DexPrice,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { useBotContext } from "@/context/BotContext";
import { useColors } from "@/hooks/useColors";
import { PriceCard } from "@/components/SharedComponents";

const NETWORKS = ["all", "avalanche", "arbitrum", "optimism"] as const;
type NetworkFilter = (typeof NETWORKS)[number];

function computeSpread(price: number, allPrices: DexPrice[]): number {
  if (allPrices.length < 2) return 0;
  const avg =
    allPrices.reduce((s, p) => s + p.price, 0) / allPrices.length;
  return avg > 0 ? ((price - avg) / avg) * 100 : 0;
}

export default function MarketsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bot = useBotContext();
  const queryClient = useQueryClient();
  const [activeNetwork, setActiveNetwork] = useState<NetworkFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const { data: prices = [], isLoading } = useGetPrices({
    query: {
      queryKey: getGetPricesQueryKey(),
      refetchInterval: bot.isRunning ? 5000 : 15000,
    },
  });

  const filtered =
    activeNetwork === "all"
      ? prices
      : prices.filter((p) => p.network === activeNetwork);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
    setRefreshing(false);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom + 20;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 16,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Markets
        </Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
          WBTC / USDT live prices
        </Text>
        <ScrollRow
          activeNetwork={activeNetwork}
          onSelect={setActiveNetwork}
          colors={colors}
        />
      </View>

      {isLoading && filtered.length === 0 ? (
        <View style={styles.loadingBox}>
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Fetching prices...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => `${item.network}-${item.dex}`}
          renderItem={({ item }) => (
            <PriceCard
              dex={item.dex}
              network={item.network}
              price={item.price}
              liquidity={item.liquidity}
              spread={computeSpread(item.price, prices.filter((p) => p.network === item.network))}
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
            <View style={styles.emptyBox}>
              <Feather name="bar-chart-2" size={24} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No price data available
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function ScrollRow({
  activeNetwork,
  onSelect,
  colors,
}: {
  activeNetwork: NetworkFilter;
  onSelect: (n: NetworkFilter) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const LABELS: Record<NetworkFilter, string> = {
    all: "All",
    avalanche: "Avalanche",
    arbitrum: "Arbitrum",
    optimism: "Optimism",
  };
  return (
    <View style={styles.filterRow}>
      {NETWORKS.map((n) => (
        <TouchableOpacity
          key={n}
          onPress={() => onSelect(n)}
          style={[
            styles.filterBtn,
            {
              backgroundColor:
                activeNetwork === n ? colors.primary : colors.secondary,
              borderColor:
                activeNetwork === n ? colors.primary : colors.border,
            },
          ]}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.filterBtnText,
              {
                color:
                  activeNetwork === n
                    ? colors.primaryForeground
                    : colors.mutedForeground,
              },
            ]}
          >
            {LABELS[n]}
          </Text>
        </TouchableOpacity>
      ))}
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
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    letterSpacing: -0.5,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  listContent: {
    padding: 16,
  },
  loadingBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
});
