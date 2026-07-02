const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_REQUESTS || '5');
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10');
const RETRY_ATTEMPTS = parseInt(process.env.RETRY_ATTEMPTS || '3');
const RETRY_DELAY = parseFloat(process.env.RETRY_DELAY || '2.0');
const RATE_LIMIT_DELAY = 10.0;

const NETWORK_ERRORS = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT'];

const DEX_TYPE_MAP = {
  'uniswap': 0,
  'sushiswap': 0,
  'ramses': 0,
  'pancakeswap': 1,
  'uniswap_v2': 2,
  'camelot_v2': 5,
  'zyberswap_v2': 5,
  'swapr_v2': 5,
  'chronos_v2': 5,
  'arbswap_v2': 2,
  'deltaswap_v2': 2,
  'elkfinance_v2': 2,
  'magicswap_v2': 2,
  'mindgames_v2': 2,
  'oreoswap_v2': 2,
  'ramses_v2': 2,
  'solidlizard_v2': 2,
  'spartadex_v2': 2,
  'sterling_v2': 2,
  'sushiswap_v2': 3,
  'pancakeswap_v2': 4,
};

const V2_DEX_TYPES = new Set([2, 3, 4]);
const ALGEBRA_DEX_TYPES = new Set([5]);
const UNSUPPORTED_DEX_PREFIX = ['0x'];

function isupportedDex(dexId) {
  if (UNSUPPORTED_DEX_PREFIX.some(prefix => dexId.startsWith(prefix))) {
    return false;
  }
  return dexId.toLowerCase() in DEX_TYPE_MAP;
}

function dexTypeFor(dexId) {
  const t = DEX_TYPE_MAP[dexId.toLowerCase()];
  if (t === undefined) {
    if (!UNSUPPORTED_DEX_PREFIX.some(prefix => dexId.startsWith(prefix))) {
      console.warn(`Unknown dexId='${dexId}', type → 0`);
    }
    return 0;
  }
  return t;
}

function isV2Dex(dexId) {
  return V2_DEX_TYPES.has(dexTypeFor(dexId));
}

function isAlgebraDex(dexId) {
  return ALGEBRA_DEX_TYPES.has(dexTypeFor(dexId));
}

function buildQuotePath(poolsInOrder, tokenKeys) {
  let path = Buffer.alloc(0);
  for (let idx = 0; idx < poolsInOrder.length; idx++) {
    const pool = poolsInOrder[idx];
    const [inKey, outKey] = tokenKeys[idx];
    if (idx === 0) {
      path = Buffer.concat([path, Buffer.from(pool[inKey].address.replace('0x', '').padStart(40, '0'), 'hex')]);
    }
    path = Buffer.concat([path, Buffer.from(pool.fee.toString(16).padStart(6, '0'), 'hex')]);
    path = Buffer.concat([path, Buffer.from(pool[outKey].address.replace('0x', '').padStart(40, '0'), 'hex')]);
  }
  return '0x' + path.toString('hex');
}

const POOL_V2_ABI = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint112', name: 'reserve0', type: 'uint112' },
      { internalType: 'uint112', name: 'reserve1', type: 'uint112' },
      { internalType: 'uint32', name: 'blockTimestampLast', type: 'uint32' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const POOL_LIQ_ABI = [
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint32' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

const QUOTE_EXACT_INPUT_ABI = [
  {
    inputs: [
      { internalType: 'bytes', name: 'path', type: 'bytes' },
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
    ],
    name: 'quoteExactInput',
    outputs: [
      { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
      { internalType: 'uint160[]', name: 'sqrtPriceX96AfterList', type: 'uint160[]' },
      { internalType: 'uint32[]', name: 'initializedTicksCrossedList', type: 'uint32[]' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'tokenIn', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        internalType: 'struct IQuoterV2.QuoteExactInputSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
      { internalType: 'uint160', name: 'sqrtPriceX96After', type: 'uint160' },
      { internalType: 'uint32', name: 'initializedTicksCrossed', type: 'uint32' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

function liqUnitsToUsd(liquidity, sqrtPriceX96, dec0, dec1, token0IsStable) {
  if (sqrtPriceX96 === 0n || liquidity === 0n) {
    return 0.0;
  }

  const sqrtPriceFloat = Number(sqrtPriceX96) / Math.pow(2, 96);
  const price = sqrtPriceFloat * sqrtPriceFloat * Math.pow(10, dec0) / Math.pow(10, dec1);

  if (price <= 0) {
    return 0.0;
  }

  const amount0 = Number(liquidity) / sqrtPriceFloat / Math.pow(10, dec0);
  const amount1 = Number(liquidity) * sqrtPriceFloat / Math.pow(10, dec1);

  if (token0IsStable) {
    return amount0 + amount1 / price;
  } else {
    return amount0 * price + amount1;
  }
}

const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'USD₮0', 'USDC.e', 'USDT.e', 'BUSD', 'LUSD', 'crvUSD']);

function isStable(symbol) {
  return STABLE_SYMBOLS.has(symbol.toUpperCase());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withRetry(attempts = RETRY_ATTEMPTS, delay = RETRY_DELAY) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      let lastErr = null;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          lastErr = error;
          const wait = (error.status === 429 ? RATE_LIMIT_DELAY : delay) * attempt;
          if (attempt < attempts) {
            await sleep(wait * 1000);
          }
        }
      }
      console.debug(`[${originalMethod.name}] All attempts exhausted: ${lastErr}`);
      return null;
    };

    return descriptor;
  };
}

class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
    } else {
      await new Promise(resolve => this.queue.push(resolve));
      this.current++;
    }
  }

  release() {
    this.current--;
    const resolve = this.queue.shift();
    if (resolve) resolve();
  }
}

class MultiChainSearcher {
  constructor(activeSteps, executeFn, minProfitPct, sharedWeb3 = null) {
    const bad = activeSteps.filter(s => ![2, 3, 4, 5].includes(s));
    if (bad.length > 0) {
      throw new Error(`active_steps must be in (2,3,4,5): ${bad}`);
    }

    this.activeSteps = [...new Set(activeSteps)].sort();
    this.executeFn = executeFn;
    this.minProfitPct = minProfitPct;
    this.scriptDir = __dirname;

    this.ownWeb3 = sharedWeb3 === null;
    this.web3 = sharedWeb3 || new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL);
    this.semaphore = new Semaphore(MAX_CONCURRENT);

    this.allPools = {};
    this.cumulativeTokenName = '';
    this.cumulativeTokenAddress = '';
    this.listQuoter = {};
    this.amountHuman = 0.0;
    this.slippageBps = 8;
    this.gasCostUsd = 0.028;
    this.maxPriceImpactPct = 0.10;

    this.liqCache = {};
  }

  uploadingData() {
    try {
      const poolPath = path.join(this.scriptDir, 'pool_collection', 'pools', 'all_pools.json');
      this.allPools = JSON.parse(fs.readFileSync(poolPath, 'utf-8'));

      const cumulativeTokenStr = process.env.CUMULATIVE_TOKEN;
      const [name, addr] = JSON.parse(cumulativeTokenStr);
      this.cumulativeTokenName = name;
      this.cumulativeTokenAddress = addr.toLowerCase();

      this.listQuoter = {
        uniswap: process.env.UNISWAP_QUOTER || '',
        sushiswap: process.env.SUSHISWAP_QUOTER || '',
        pancakeswap: process.env.PANCAKESWAP_QUOTER || '',
        ramses: process.env.RAMSES_QUOTER || '',
        camelot_v2: process.env.CAMELOT_QUOTER || '',
        zyberswap_v2: process.env.CAMELOT_QUOTER || '',
        swapr_v2: process.env.CAMELOT_QUOTER || '',
        chronos_v2: process.env.CAMELOT_QUOTER || '',
      };

      this.amountHuman = parseFloat(process.env.AMOUNT);
      this.slippageBps = parseInt(process.env.SLIPPAGE_BPS || '8');
      this.gasCostUsd = parseFloat(process.env.GAS_COST_USD || '0.028');
      this.maxPriceImpactPct = parseFloat(process.env.MAX_PRICE_IMPACT_PCT || '0.10');

      return true;
    } catch (error) {
      console.error(`Error loading data: ${error.message}`);
      return false;
    }
  }

  async fetchPoolLiquidity(poolInfo) {
    const poolAddr = poolInfo.pool;
    const dexId = poolInfo.dexId || 'uniswap';
    const isV2 = isV2Dex(dexId);

    const dec0 = poolInfo.token0.decimals;
    const dec1 = poolInfo.token1.decimals;
    const sym0 = poolInfo.token0.symbol;
    const sym1 = poolInfo.token1.symbol;

    const t0Stable = isStable(sym0);
    const t1Stable = isStable(sym1);

    try {
      await this.semaphore.acquire();

      try {
        const addrCs = ethers.getAddress(poolAddr);

        if (isV2) {
          const contract = new ethers.Contract(addrCs, POOL_V2_ABI, this.web3);
          let reserves;
          try {
            reserves = await contract.getReserves();
          } catch {
            const abi2 = [
              {
                inputs: [],
                name: 'getReserves',
                outputs: [
                  { name: 'reserve0', type: 'uint128' },
                  { name: 'reserve1', type: 'uint128' },
                ],
                stateMutability: 'view',
                type: 'function',
              },
            ];
            const contract2 = new ethers.Contract(addrCs, abi2, this.web3);
            reserves = await contract2.getReserves();
          }

          const r0 = BigInt(reserves[0]);
          const r1 = BigInt(reserves[1]);

          if (r0 === 0n && r1 === 0n) {
            return 0.0;
          }

          if (!t0Stable && !t1Stable) {
            return Infinity;
          }

          if (t0Stable) {
            return (Number(r0) / Math.pow(10, dec0)) * 2;
          } else {
            return (Number(r1) / Math.pow(10, dec1)) * 2;
          }
        } else {
          const contract = new ethers.Contract(addrCs, POOL_LIQ_ABI, this.web3);
          const [liqRaw, slot0] = await Promise.all([
            contract.liquidity(),
            contract.slot0(),
          ]);

          if (liqRaw === 0n) {
            return 0.0;
          }

          if (!t0Stable && !t1Stable) {
            return Infinity;
          }

          return liqUnitsToUsd(liqRaw, slot0[0], dec0, dec1, t0Stable);
        }
      } finally {
        this.semaphore.release();
      }
    } catch {
      return null;
    }
  }

  async refreshLiquidityCache() {
    const allPoolInfos = {};
    for (const pools of Object.values(this.allPools)) {
      for (const p of pools) {
        const key = p.pool.toLowerCase();
        if (!(key in allPoolInfos)) {
          allPoolInfos[key] = p;
        }
      }
    }

    const total = Object.keys(allPoolInfos).length;
    console.log(`  🔍 Refreshing liquidity for ${total} pools...`);

    const results = await Promise.all(
      Object.values(allPoolInfos).map(info => this.fetchPoolLiquidity(info))
    );

    this.liqCache = {};
    let ok = 0, skipped = 0, zero = 0;

    for (const [poolInfo, liq] of Object.entries(Object.fromEntries(
      Object.values(allPoolInfos).map((p, i) => [p.pool.toLowerCase(), [p, results[i]]])
    ))) {
      const key = liq[0].pool.toLowerCase();
      if (liq[1] === null) {
        this.liqCache[key] = null;
        skipped++;
      } else if (liq[1] === 0.0) {
        this.liqCache[key] = 0.0;
        zero++;
      } else {
        this.liqCache[key] = liq[1];
        ok++;
      }
    }

    const minLiq = this.minLiqUsd();
    const passing = Object.values(this.liqCache).filter(
      v => v !== null && (v === Infinity || v >= minLiq)
    ).length;

    console.log(
      `  📊 Liquidity: read=${ok} | empty=${zero} | errors=${skipped} | passing filter=$${minLiq.toFixed(0)}: ${passing}/${total}`
    );
  }

  minLiqUsd() {
    return this.amountHuman * 100.0 / (2.0 * this.maxPriceImpactPct);
  }

  poolLiqOk(poolAddr) {
    const key = poolAddr.toLowerCase();
    const liq = this.liqCache[key];

    if (liq === undefined) {
      return [true, null];
    }

    if (liq === 0.0) {
      return [false, 0.0];
    }

    if (liq === Infinity) {
      return [true, null];
    }

    const minLiq = this.minLiqUsd();
    return [liq >= minLiq, liq];
  }

  chainLiqOk(pools) {
    const minLiq = this.minLiqUsd();
    for (const pool of pools) {
      const [ok, liqUsd] = this.poolLiqOk(pool.pool);
      if (!ok) {
        const sym0 = pool.token0.symbol;
        const sym1 = pool.token1.symbol;
        const liqStr = liqUsd !== null ? `$${liqUsd.toFixed(0)}` : '?';
        return [
          false,
          `${sym0}/${sym1} liq=${liqStr} < min=$${minLiq.toFixed(0)} (impact>${(this.maxPriceImpactPct * 100).toFixed(2)}%)`,
        ];
      }
    }
    return [true, ''];
  }

  initTokens(pool) {
    if (pool.token0.address.toLowerCase() === this.cumulativeTokenAddress) {
      return ['token1', 'token0'];
    } else if (pool.token1.address.toLowerCase() === this.cumulativeTokenAddress) {
      return ['token0', 'token1'];
    }
    return [null, null];
  }

  static tokensByAddr(pool, addr) {
    const a = addr.toLowerCase();
    if (pool.token0.address.toLowerCase() === a) {
      return ['token0', 'token1'];
    } else if (pool.token1.address.toLowerCase() === a) {
      return ['token1', 'token0'];
    }
    return [null, null];
  }

  async quoteChainAtomic(poolsInOrder, tokenKeys, amountInWei, dexId) {
    const quoterAddr = this.listQuoter[dexId];
    if (!quoterAddr) {
      return null;
    }

    const path = buildQuotePath(poolsInOrder, tokenKeys);

    await this.semaphore.acquire();
    try {
      const quoter = new ethers.Contract(
        ethers.getAddress(quoterAddr),
        QUOTE_EXACT_INPUT_ABI,
        this.web3
      );
      const result = await quoter.quoteExactInput(path, amountInWei);
      const out = BigInt(result[0]);
      return out > 0n ? out : null;
    } catch {
      return null;
    } finally {
      this.semaphore.release();
    }
  }

  async quoteChainMixed(poolsInOrder, tokenKeys, amountInWei) {
    let current = amountInWei;
    for (let i = 0; i < poolsInOrder.length; i++) {
      const pool = poolsInOrder[i];
      const [inKey, outKey] = tokenKeys[i];
      const dexId = pool.dexId;

      let out;
      if (isV2Dex(dexId)) {
        out = await this.quoteV2(pool, inKey, current);
      } else {
        out = await this.quoteSingle(pool, inKey, outKey, current);
      }

      if (out === null || out === 0n) {
        return null;
      }
      current = out;
    }
    return current;
  }

  async quoteSingle(pool, tokenInKey, tokenOutKey, amountInWei) {
    const quoterAddr = this.listQuoter[pool.dexId];
    if (!quoterAddr) {
      return null;
    }

    await this.semaphore.acquire();
    try {
      const quoter = new ethers.Contract(
        ethers.getAddress(quoterAddr),
        QUOTE_EXACT_INPUT_ABI,
        this.web3
      );
      const result = await quoter.quoteExactInputSingle({
        tokenIn: ethers.getAddress(pool[tokenInKey].address),
        tokenOut: ethers.getAddress(pool[tokenOutKey].address),
        amountIn: amountInWei,
        fee: pool.fee,
        sqrtPriceLimitX96: 0n,
      });
      const out = BigInt(result[0]);
      return out > 0n ? out : null;
    } catch {
      return null;
    } finally {
      this.semaphore.release();
    }
  }

  async quoteV2(pool, tokenInKey, amountInWei) {
    try {
      await this.semaphore.acquire();
      try {
        const contract = new ethers.Contract(
          ethers.getAddress(pool.pool),
          POOL_V2_ABI,
          this.web3
        );
        const reserves = await contract.getReserves();
        const r0 = BigInt(reserves[0]);
        const r1 = BigInt(reserves[1]);

        const t0Addr = pool.token0.address.toLowerCase();
        const tinAddr = pool[tokenInKey].address.toLowerCase();

        let rIn, rOut;
        if (tinAddr === t0Addr) {
          rIn = r0;
          rOut = r1;
        } else {
          rIn = r1;
          rOut = r0;
        }

        if (rIn === 0n || rOut === 0n) {
          return null;
        }

        const feeNum = amountInWei * 997n;
        const amountOut = (feeNum * rOut) / (rIn * 1000n + feeNum);
        return amountOut > 0n ? amountOut : null;
      } finally {
        this.semaphore.release();
      }
    } catch {
      return null;
    }
  }

  async bestSingleQuote(pools, inKey, outKey, amountInWei) {
    const results = await Promise.all(
      pools.map(async (p) => {
        const dexId = p.dexId;
        let out;
        if (isV2Dex(dexId)) {
          out = await this.quoteV2(p, inKey, amountInWei);
        } else {
          out = await this.quoteSingle(p, inKey, outKey, amountInWei);
        }
        return out ? { pool: p, amount: out } : null;
      })
    );

    const valid = results.filter(r => r !== null);
    if (valid.length === 0) {
      return [null, 0n];
    }

    const best = valid.reduce((max, current) =>
      current.amount > max.amount ? current : max
    );
    return [best.pool, best.amount];
  }

  buildCandidates(stepCount) {
    const cum = this.cumulativeTokenName;
    const pairs = Object.keys(this.allPools);

    if (stepCount === 2) {
      const result = pairs.filter(p => p.split('-').includes(cum)).map(p => [p]);
      console.debug(`[2-step] Candidates before liquidity filter: ${result.length}`);
      return result;
    }

    const adj = {};
    for (const pair of pairs) {
      const [a1, a2] = pair.split('-');
      if (!adj[a1]) adj[a1] = [];
      if (!adj[a2]) adj[a2] = [];
      adj[a1].push(pair);
      adj[a2].push(pair);
    }

    const result = [];
    const n = stepCount;

    const dfs = (path, curToken, depth, used) => {
      if (depth === n) {
        if (curToken === cum) {
          result.push(path);
        }
        return;
      }

      for (const edge of adj[curToken] || []) {
        if (used.has(edge)) continue;
        const [a1, a2] = edge.split('-');
        const nxt = a1 === curToken ? a2 : a1;
        if (depth < n - 1 && nxt === cum) continue;
        dfs([...path, edge], nxt, depth + 1, new Set([...used, edge]));
      }
    };

    for (const startP of adj[cum] || []) {
      const [a1, a2] = startP.split('-');
      const mid1 = a1 === cum ? a2 : a1;
      dfs([startP], mid1, 1, new Set([startP]));
    }

    console.debug(`[${n}-step] Candidates before liquidity filter: ${result.length}`);
    return result;
  }

  async processChain(pairNames, stepCount) {
    const candidatePools = [];
    for (const pairName of pairNames) {
      const pairPoolList = this.allPools[pairName];
      if (!pairPoolList) {
        return null;
      }

      let bestCandidate = null;
      for (const p of pairPoolList) {
        if (!isupportedDex(p.dexId)) continue;
        const [ok] = this.poolLiqOk(p.pool);
        if (ok) {
          bestCandidate = p;
          break;
        }
      }

      if (bestCandidate === null) {
        const liqVals = [];
        for (const p of pairPoolList) {
          const [, lv] = this.poolLiqOk(p.pool);
          if (lv !== null && lv !== Infinity) {
            liqVals.push(lv);
          }
        }
        const minLiq = this.minLiqUsd();
        const bestLiq = liqVals.length > 0 ? Math.max(...liqVals) : 0;
        console.debug(
          `  ⛔ ${pairName}: liquidity $${bestLiq.toFixed(0)} < min $${minLiq.toFixed(0)} (impact>${(this.maxPriceImpactPct * 100).toFixed(2)}%) → skipping`
        );
        return null;
      }

      candidatePools.push(bestCandidate);
    }

    const firstPools = this.allPools[pairNames[0]];
    const [auxKey, cumKey] = this.initTokens(firstPools[0]);
    if (auxKey === null) {
      return null;
    }

    const cumDecimals = firstPools[0][cumKey].decimals;
    const amountInWei = BigInt(Math.floor(this.amountHuman * Math.pow(10, cumDecimals)));

    let bestPools = [];
    let tokenKeys = [];

    if (stepCount === 2) {
      const [best1, amt1] = await this.bestSingleQuote(firstPools, cumKey, auxKey, amountInWei);
      if (best1 === null) return null;
      const [best2] = await this.bestSingleQuote(firstPools, auxKey, cumKey, amt1 || amountInWei);
      if (best2 === null) return null;
      bestPools = [best1, best2];
      tokenKeys = [[cumKey, auxKey], [auxKey, cumKey]];
    } else {
      const [best1, cur] = await this.bestSingleQuote(firstPools, cumKey, auxKey, amountInWei);
      if (best1 === null) return null;
      bestPools.push(best1);
      tokenKeys.push([cumKey, auxKey]);
      let prevAddr = firstPools[0][auxKey].address;

      for (const pairName of pairNames.slice(1)) {
        const pools = this.allPools[pairName];
        const [tin, tout] = MultiChainSearcher.tokensByAddr(pools[0], prevAddr);
        if (tin === null) return null;
        const [bestP, curNew] = await this.bestSingleQuote(pools, tin, tout, cur);
        if (bestP === null) return null;
        bestPools.push(bestP);
        tokenKeys.push([tin, tout]);
        prevAddr = pools[0][tout].address;
      }
    }

    const [liqOk, rejectReason] = this.chainLiqOk(bestPools);
    if (!liqOk) {
      console.debug(`  ⛔ ${pairNames.join(' → ')}: ${rejectReason}`);
      return null;
    }

    const liqInfo = bestPools.map(p => ({
      pair: `${p.token0.symbol}/${p.token1.symbol}`,
      liq_usd: this.liqCache[p.pool.toLowerCase()],
    }));

    let amountOutWei;
    const hasV2Classic = bestPools.some(p => isV2Dex(p.dexId));
    const hasAlgebra = bestPools.some(p => isAlgebraDex(p.dexId));
    const quoterAddrs = new Set(bestPools.map(p => this.listQuoter[p.dexId]));
    const singleQuoter = quoterAddrs.size === 1 && !quoterAddrs.has(undefined);
    const hasMixed = hasV2Classic || hasAlgebra || !singleQuoter;

    if (hasMixed) {
      amountOutWei = await this.quoteChainMixed(bestPools, tokenKeys, amountInWei);
    } else {
      const dexIdFirst = bestPools[0].dexId;
      amountOutWei = await this.quoteChainAtomic(bestPools, tokenKeys, amountInWei, dexIdFirst);
    }

    if (amountOutWei === null) {
      return null;
    }

    const tokenPath = [];
    for (let idx = 0; idx < bestPools.length; idx++) {
      const [inK, outK] = tokenKeys[idx];
      if (idx === 0) {
        tokenPath.push(bestPools[idx][inK].address);
      }
      tokenPath.push(bestPools[idx][outK].address);
    }

    const amountOutHuman = Number(amountOutWei) / Math.pow(10, cumDecimals);
    const grossProfit = amountOutHuman - this.amountHuman;
    const netProfit = grossProfit - this.gasCostUsd;
    const profitPct = (netProfit / this.amountHuman) * 100;
    const chainLabel = pairNames.join(' → ');
    const sign = netProfit >= 0 ? '+' : '';

    const poolLabel = (poolInfo) => {
      const dex = poolInfo.dexId;
      const base = dex.includes('_v2') ? dex.split('_v2')[0] : dex;
      const name = base.charAt(0).toUpperCase() + base.slice(1, 4);
      let ver;
      if (isAlgebraDex(dex)) {
        ver = 'Alg';
      } else if (isV2Dex(dex)) {
        ver = 'V2';
      } else {
        ver = 'V3';
      }
      return name + ver;
    };

    const dexRoute = bestPools.map(poolLabel).join('→');

    const validLiqs = liqInfo
      .map(li => li.liq_usd)
      .filter(l => l !== null && l !== Infinity);
    const minPoolLiq = validLiqs.length > 0 ? Math.min(...validLiqs) : null;
    const liqStr = minPoolLiq !== null ? `min_liq=$${minPoolLiq.toFixed(0)}` : 'liq=?';

    console.log(
      `[${stepCount}step|${dexRoute}] ${chainLabel}: in=${this.amountHuman.toFixed(2)} gross=${grossProfit.toFixed(6)} net=${sign}${netProfit.toFixed(6)} (${sign}${profitPct.toFixed(4)}%) ${liqStr}`
    );

    if (profitPct < this.minProfitPct) {
      return null;
    }

    const amountOutMin = (amountOutWei * BigInt(10000 - this.slippageBps)) / 10000n;
    const poolsAddresses = bestPools.map(p => p.pool);
    const dexTypesList = bestPools.map(p => dexTypeFor(p.dexId));

    console.log(`  💰 [${stepCount}step|${dexRoute}] ${chainLabel}: net=${sign}${netProfit.toFixed(4)}$ (${sign}${profitPct.toFixed(4)}%) ${liqStr} → executing...`);

    return {
      stepCount,
      chainLabel,
      dexRoute,
      poolsAddresses,
      dexTypes: dexTypesList,
      tokenPath,
      amountInWei: amountInWei.toString(),
      amountOutMin: amountOutMin.toString(),
      profit: netProfit,
      profitPct,
      cumulativeDecimals: cumDecimals,
      bestPools,
      liqInfo,
    };
  }

  async run() {
    if (!await this.web3.getNetwork()) {
      throw new Error('No Web3 connection. Check ARBITRUM_RPC_URL.');
    }

    await this.refreshLiquidityCache();

    for (const stepCount of this.activeSteps) {
      const candidates = this.buildCandidates(stepCount);
      if (candidates.length === 0) {
        console.log(`[${stepCount}-step] No candidates`);
        continue;
      }

      const total = candidates.length;
      const minLiq = this.minLiqUsd();
      console.log(
        `[${stepCount}-step] ${total} chains | filter: impact≤${(this.maxPriceImpactPct * 100).toFixed(2)}% → min.liquidity $${minLiq.toFixed(0)}`
      );

      for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
        const batch = candidates.slice(batchStart, batchStart + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(c => this.processChain(c, stepCount))
        );

        for (const r of results) {
          if (r && typeof r === 'object') {
            await this.executeFn(r);
          }
        }
      }
    }
  }

  async close() {
    if (this.ownWeb3) {
      // Close web3 connection if needed
    }
  }
}

module.exports = MultiChainSearcher;
