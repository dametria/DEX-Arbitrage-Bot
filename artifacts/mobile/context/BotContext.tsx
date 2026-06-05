import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  getGetBotStatusQueryKey,
  useGetBotStatus,
  useStartBot,
  useStopBot,
} from "@workspace/api-client-react";

export interface BotConfig {
  gasSource: "flashloan" | "contract";
  networks: string[];
  minProfitPct: number;
  slippageTolerance: number;
  walletAddress: string;
  privateKey: string;
}

const DEFAULT_CONFIG: BotConfig = {
  gasSource: "flashloan",
  networks: ["avalanche", "arbitrum", "optimism"],
  minProfitPct: 0.15,
  slippageTolerance: 0.01,
  walletAddress: "",
  privateKey: "",
};

const CONFIG_KEY = "@arb_bot_config";

interface BotContextValue {
  config: BotConfig;
  updateConfig: (partial: Partial<BotConfig>) => Promise<void>;
  isConfigLoaded: boolean; 
  isRunning: boolean;
  isStarting: boolean;
  isStopping: boolean;
  totalProfit: number;
  totalTrades: number;
  successRate: number;
  start: (cfg: BotConfig) => Promise<void>;
  stop: () => Promise<void>;
  error: string | null;
}

const BotContext = createContext<BotContextValue | null>(null);

export function BotProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
  AsyncStorage.getItem(CONFIG_KEY).then((raw) => {
    if (raw) {
      try {
        const saved = JSON.parse(raw) as Partial<BotConfig>;
        setConfig((prev) => ({ ...prev, ...saved }));
      } catch (err) {
        // Optional: log, or just silently ignore bad JSON
        console.warn("Failed to parse saved bot config", err);
      }
    }
    setIsConfigLoaded(true);
  });
}, []);

  const updateConfig = useCallback(async (partial: Partial<BotConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const { data: statusData } = useGetBotStatus({
    query: {
      queryKey: getGetBotStatusQueryKey(),
      refetchInterval: 3000,
    },
  });

  const startMutation = useStartBot({
    mutation: {
      onError: (err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Failed to start bot";
        setError(msg);
      },
      onSuccess: () => {
        setError(null);
        queryClient.invalidateQueries({
          queryKey: getGetBotStatusQueryKey(),
        });
      },
    },
  });

  const stopMutation = useStopBot({
    mutation: {
      onError: (err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Failed to stop bot";
        setError(msg);
      },
      onSuccess: () => {
        setError(null);
        queryClient.invalidateQueries({
          queryKey: getGetBotStatusQueryKey(),
        });
      },
    },
  });

  const start = useCallback(
    async (cfg: BotConfig) => {
      setError(null);
      await updateConfig(cfg);
      await startMutation.mutateAsync({
        data: {
          gasSource: cfg.gasSource,
          networks: cfg.networks,
          minProfitPct: cfg.minProfitPct,
          slippageTolerance: cfg.slippageTolerance,
          walletAddress: cfg.walletAddress,
          privateKey: cfg.privateKey,
        },
      });
    },
    [startMutation, updateConfig],
  );

  const stop = useCallback(async () => {
    setError(null);
    await stopMutation.mutateAsync();
  }, [stopMutation]);

  const stats = statusData?.stats;
  const isRunning = statusData?.running ?? false;
  const totalProfit = stats?.totalProfit ?? 0;
  const totalTrades = stats?.totalTrades ?? 0;
  const successful = stats?.successfulTrades ?? 0;
  const successRate =
    totalTrades > 0 ? Math.round((successful / totalTrades) * 100) : 0;

  return (
    <BotContext.Provider
      value={{
        config,
        updateConfig,
        isConfigLoaded,  
        isRunning,
        isStarting: startMutation.isPending,
        isStopping: stopMutation.isPending,
        totalProfit,
        totalTrades,
        successRate,
        start,
        stop,
        error,
      }}
    >
      {children}
    </BotContext.Provider>
  );
}

export function useBotContext() {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error("useBotContext must be used inside BotProvider");
  return ctx;
}
