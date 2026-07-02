const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

const MIN_RESERVES = {
  stablecoins: 1_000,
  WETH: 0.5,
  WBTC: 0.03,
  default: 10_000,
};

const STABLECOINS = new Set([
  'USDC', 'USD₮0', 'USDC.e', 'xUSD', 'USDe', 'axlUSDC', 'MIM', 'USD24',
  'USDs', 'FRAX', 'alUSD', 'FUSD', 'fUSDC', 'GHO', 'satUSD', 'DAI',
  'USDai', 'USDS', 'MAI', 'DOLA', 'USDT', 'USD.a', 'EUROS', 'USDY',
  'UKSDT', 'USDRIF', 'USDV', 'gmUSD', 'BOB', 'USDT+', 'DAI+', 'USD0++',
  'FJPY', 'FEUR', 'EURS', 'FSGD', 'BUCK', 'rgUSD', 'USDW',
]);

const NETWORK_ERRORS = [
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT'
];

const MAX_RETRIES = 3;
const RETRY_DELAY = 2.0;
const MAX_CONCURRENCY = 5;

async function retryCall(coroFunc, args = [], options = {}) {
  const { retries = MAX_RETRIES, delay = RETRY_DELAY, label = '' } = options;
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await coroFunc(...args);
    } catch (error) {
      lastError = error;

      if (error.reason === 'reverted' || error.reason === 'bad-function-call-output') {
        console.debug(`[${label}] Contract returned error: ${error.reason}`);
        return null;
      }

      if (error.status === 429) {
        const wait = delay * attempt * 3;
        if (attempt < retries) {
          console.warn(
            `[${label}] 429 Too Many Requests (attempt ${attempt}/${retries}), waiting ${wait.toFixed(1)}s...`
          );
          await sleep(wait * 1000);
        }
      } else if (NETWORK_ERRORS.includes(error.code)) {
        console.warn(
          `[${label}] Network error (attempt ${attempt}/${retries}): ${error.code}: ${error.message}`
        );
        if (attempt < retries) {
          await sleep(delay * attempt * 1000);
        }
      } else {
        throw error;
      }
    }
  }

  console.error(`[${label}] All ${retries} attempts exhausted. Last error: ${lastError}`);
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class PoolsCheck {
  constructor() {
    const rpcUrl = process.env.ARBITRUM_RPC_URL;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.scriptDir = __dirname;
    this.erc20Abi = [];
    this.poolV3Abi = [];
    this.poolV2Abi = [];
    this.tokens = {};
    this.pools = {};
    this.allPools = {};
    this.lock = { locked: false, queue: [] };
  }

  loadJson(...pathParts) {
    const filePath = path.join(this.scriptDir, ...pathParts);
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  }

  uploadingData() {
    try {
      this.tokens = this.loadJson('pool_collection', 'pools', 'tokens.json');
      console.log('[DEBUG] File tokens.json loaded');

      this.erc20Abi = this.loadJson('pool_collection', 'abi', 'erc20.json');
      console.log('[DEBUG] File erc20.json loaded');

      this.poolV3Abi = this.loadJson('pool_collection', 'abi', 'pool_abi_v3.json');
      console.log('[DEBUG] File pool_abi_v3.json loaded (V3)');

      this.pools = this.loadJson('pool_collection', 'pools', 'pools_dexscreener.json');
      console.log('[DEBUG] File pools.json loaded');

      const v2AbiPath = path.join(this.scriptDir, 'pool_collection', 'abi', 'pool_abi_v2.json');
      if (fs.existsSync(v2AbiPath)) {
        this.poolV2Abi = this.loadJson('pool_collection', 'abi', 'pool_abi_v2.json');
        console.log('[DEBUG] File pool_abi_v2.json loaded (V2)');
      } else {
        this.poolV2Abi = this.builtinV2Abi();
        console.log('[DEBUG] Using built-in V2 ABI');
      }

      return true;
    } catch (error) {
      console.error(`Error loading data: ${error.message}`);
      return false;
    }
  }

  builtinV2Abi() {
    return [
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
        name: 'getReserves',
        outputs: [
          { internalType: 'uint112', name: 'reserve0', type: 'uint112' },
          { internalType: 'uint112', name: 'reserve1', type: 'uint112' },
          { internalType: 'uint32', name: 'blockTimestampLast', type: 'uint32' },
        ],
        stateMutability: 'view',
        type: 'function',
      },
    ];
  }

  async addPool(data) {
    const pool = {
      dexId: data.dex_id,
      pool: data.pool,
      fee: data.fee,
      token0: {
        address: data.token0_address,
        symbol: data.token0_symbol,
        decimals: data.token0_decimals,
      },
      token1: {
        address: data.token1_address,
        symbol: data.token1_symbol,
        decimals: data.token1_decimals,
      },
    };

    // Simple lock implementation
    while (this.lock.locked) {
      await new Promise(resolve => this.lock.queue.push(resolve));
    }
    this.lock.locked = true;

    try {
      const key = data.key_pairs;
      if (!this.allPools[key]) {
        this.allPools[key] = [];
      }
      if (!this.allPools[key].find(p => JSON.stringify(p) === JSON.stringify(pool))) {
        this.allPools[key].push(pool);
      }
    } finally {
      this.lock.locked = false;
      const resolve = this.lock.queue.shift();
      if (resolve) resolve();
    }
  }

  async start() {
    const startTime = Date.now();

    if (!this.uploadingData()) {
      return;
    }

    const connected = await retryCall(
      () => this.provider.getNetwork(),
      [],
      { label: 'Web3.isConnected' }
    );

    if (!connected) {
      console.error('❌ No Web3 connection. Check ARBITRUM_RPC_URL.');
      return;
    }

    const semaphore = new Semaphore(MAX_CONCURRENCY);
    const tasks = [];

    for (const [dexId, poolList] of Object.entries(this.pools)) {
      console.log(`Adding tasks for DEX ${dexId}`);
      for (const pool of poolList) {
        tasks.push(this.processPool(semaphore, dexId, pool));
      }
    }

    await Promise.all(tasks);

    if (Object.keys(this.allPools).length > 0) {
      this.saveResults();
    } else {
      console.warn('File all_pools.json not created — no valid pools');
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`Pool check completed in ${elapsed.toFixed(2)} seconds`);
  }

  async processPool(semaphore, dexId, pool) {
    await semaphore.acquire();
    try {
      console.log(`Checking pool: ${pool}`);

      const poolChecksum = await this.checkingExistenceContract(pool);
      if (!poolChecksum) return;

      if (await this.isV3Pool(poolChecksum)) {
        await this.poolTypeDefinition(dexId, poolChecksum);
        return;
      }

      if (await this.isV2Pool(poolChecksum)) {
        const v2DexId = `${dexId}_v2`;
        await this.poolTypeDefinitionV2(v2DexId, poolChecksum);
        return;
      }

      console.debug(`Pool ${poolChecksum} is not V3 or V2-compatible — skipping`);
    } finally {
      semaphore.release();
    }
  }

  async isV3Pool(pool) {
    try {
      const contract = new ethers.Contract(pool, this.poolV3Abi, this.provider);
      const result = await Promise.race([
        contract.fee(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]);
      return result !== null;
    } catch {
      return false;
    }
  }

  async isV2Pool(pool) {
    const result = await this.getReservesV2(pool);
    return result !== null;
  }

  async checkingExistenceContract(pool) {
    try {
      const checksumAddress = ethers.getAddress(pool);

      const poolCode = await retryCall(
        () => this.provider.getCode(checksumAddress),
        [],
        { label: `get_code:${pool}` }
      );

      if (poolCode === null) return null;
      if (poolCode === '0x') {
        console.log(`Pool ${pool} does not exist`);
        return null;
      }
      return checksumAddress;
    } catch (error) {
      if (error.message.includes('invalid address')) {
        console.error(`Invalid pool address format: ${pool}`);
      } else {
        console.error(`Unknown error checking contract ${pool}:`, error.message);
      }
      return null;
    }
  }

  async poolTypeDefinition(dexId, pool) {
    try {
      const poolCs = ethers.getAddress(pool);
      const contract = new ethers.Contract(pool, this.poolV3Abi, this.provider);

      const token0Raw = await retryCall(
        () => contract.token0(),
        [],
        { label: `token0:${pool}` }
      );
      const token1Raw = await retryCall(
        () => contract.token1(),
        [],
        { label: `token1:${pool}` }
      );

      if (token0Raw === null || token1Raw === null) return;

      const token0 = token0Raw.toLowerCase();
      const token1 = token1Raw.toLowerCase();
      const token0Cs = ethers.getAddress(token0);
      const token1Cs = ethers.getAddress(token1);

      const [token0Symbol, token0Decimals, token0Balance] = await this.getTokenInfo(token0Cs, poolCs);
      if (token0Symbol === null || token0Decimals === null || token0Balance === null) return;
      if (!this.checkReserve(token0Symbol, token0Decimals, token0Balance)) return;

      const [token1Symbol, token1Decimals, token1Balance] = await this.getTokenInfo(token1Cs, poolCs);
      if (token1Symbol === null || token1Decimals === null || token1Balance === null) return;
      if (!this.checkReserve(token1Symbol, token1Decimals, token1Balance)) return;

      const fee = await retryCall(
        () => contract.fee(),
        [],
        { label: `fee:${pool}` }
      );
      if (fee === null) return;

      const keyPairs = this.keyCreation(token0, token1);
      if (keyPairs === null) return;

      await this.addPool({
        key_pairs: keyPairs,
        dex_id: dexId,
        pool,
        fee,
        token0_address: token0,
        token0_symbol: token0Symbol,
        token0_decimals: token0Decimals,
        token1_address: token1,
        token1_symbol: token1Symbol,
        token1_decimals: token1Decimals,
      });

      console.log(`[V3] Pool added: ${keyPairs}  dex=${dexId}  fee=${fee}`);
    } catch (error) {
      console.error(`Unknown error V3 ${pool}:`, error.message);
    }
  }

  async getReservesV2(poolCs) {
    try {
      const cs = ethers.getAddress(poolCs);
      const abi3 = [
        {
          inputs: [],
          name: 'getReserves',
          outputs: [
            { name: 'reserve0', type: 'uint112' },
            { name: 'reserve1', type: 'uint112' },
            { name: 'blockTimestampLast', type: 'uint32' },
          ],
          stateMutability: 'view',
          type: 'function',
        },
      ];

      try {
        const contract = new ethers.Contract(cs, abi3, this.provider);
        const reserves = await contract.getReserves();
        return [BigInt(reserves[0]), BigInt(reserves[1])];
      } catch {
        // Try Camelot/Algebra format
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

        try {
          const contract2 = new ethers.Contract(cs, abi2, this.provider);
          const reserves = await contract2.getReserves();
          return [BigInt(reserves[0]), BigInt(reserves[1])];
        } catch {
          return null;
        }
      }
    } catch {
      return null;
    }
  }

  async poolTypeDefinitionV2(dexId, pool) {
    try {
      const poolCs = ethers.getAddress(pool);
      const contract = new ethers.Contract(poolCs, this.poolV2Abi, this.provider);

      const token0Raw = await retryCall(
        () => contract.token0(),
        [],
        { label: `v2:token0:${pool}` }
      );
      const token1Raw = await retryCall(
        () => contract.token1(),
        [],
        { label: `v2:token1:${pool}` }
      );

      if (token0Raw === null || token1Raw === null) {
        console.debug(`[V2] Could not read pool tokens ${pool}`);
        return;
      }

      const token0 = token0Raw.toLowerCase();
      const token1 = token1Raw.toLowerCase();
      const token0Cs = ethers.getAddress(token0);
      const token1Cs = ethers.getAddress(token1);

      const reserves = await this.getReservesV2(poolCs);
      if (reserves === null) {
        console.debug(`[V2] getReserves() not supported by pool ${pool}`);
        return;
      }

      const [reserve0, reserve1] = reserves;

      if (reserve0 === 0n || reserve1 === 0n) {
        console.debug(`[V2] Pool ${pool} is empty`);
        return;
      }

      const [token0Symbol, token0Decimals] = await this.getTokenInfoV2(token0Cs);
      if (token0Symbol === null || token0Decimals === null) return;

      const [token1Symbol, token1Decimals] = await this.getTokenInfoV2(token1Cs);
      if (token1Symbol === null || token1Decimals === null) return;

      if (!this.checkReserve(token0Symbol, token0Decimals, reserve0)) {
        console.debug(
          `[V2] ${token0Symbol} reserve too small: ${Number(reserve0) / Math.pow(10, token0Decimals):.4f} < MIN`
        );
        return;
      }

      if (!this.checkReserve(token1Symbol, token1Decimals, reserve1)) {
        console.debug(
          `[V2] ${token1Symbol} reserve too small: ${Number(reserve1) / Math.pow(10, token1Decimals):.4f} < MIN`
        );
        return;
      }

      const keyPairs = this.keyCreation(token0, token1);
      if (keyPairs === null) {
        console.debug(`[V2] Tokens not found in tokens.json: ${token0Symbol}/${token1Symbol}`);
        return;
      }

      await this.addPool({
        key_pairs: keyPairs,
        dex_id: dexId,
        pool,
        fee: 0,
        token0_address: token0,
        token0_symbol: token0Symbol,
        token0_decimals: token0Decimals,
        token1_address: token1,
        token1_symbol: token1Symbol,
        token1_decimals: token1Decimals,
      });

      console.log(
        `[V2] Pool added: ${keyPairs}  dex=${dexId}  r0=${Number(reserve0) / Math.pow(10, token0Decimals):.4f}${token0Symbol}  r1=${Number(reserve1) / Math.pow(10, token1Decimals):.4f}${token1Symbol}`
      );
    } catch (error) {
      console.warn(`[V2] Pool ${pool} skipped: ${error.name}: ${error.message}`);
    }
  }

  async getTokenInfo(tokenAddress, poolAddress) {
    try {
      const tokenCs = ethers.getAddress(tokenAddress);
      const poolCs = ethers.getAddress(poolAddress);
      const contract = new ethers.Contract(tokenCs, this.erc20Abi, this.provider);

      const symbol = await retryCall(
        () => contract.symbol(),
        [],
        { label: `symbol:${tokenAddress}` }
      );
      const decimals = await retryCall(
        () => contract.decimals(),
        [],
        { label: `decimals:${tokenAddress}` }
      );
      const balance = await retryCall(
        () => contract.balanceOf(poolCs),
        [],
        { label: `balanceOf:${tokenAddress}` }
      );

      if (symbol === null || decimals === null || balance === null) {
        return [null, null, null];
      }

      return [symbol, decimals, balance];
    } catch (error) {
      console.error(`Unknown error getTokenInfo ${tokenAddress}:`, error.message);
      return [null, null, null];
    }
  }

  async getTokenInfoV2(tokenAddress) {
    try {
      const tokenCs = ethers.getAddress(tokenAddress);
      const contract = new ethers.Contract(tokenCs, this.erc20Abi, this.provider);

      const symbol = await retryCall(
        () => contract.symbol(),
        [],
        { label: `v2:symbol:${tokenAddress}` }
      );
      const decimals = await retryCall(
        () => contract.decimals(),
        [],
        { label: `v2:decimals:${tokenAddress}` }
      );

      if (symbol === null || decimals === null) {
        return [null, null];
      }

      return [symbol, decimals];
    } catch (error) {
      console.error(`Unknown error getTokenInfoV2 ${tokenAddress}:`, error.message);
      return [null, null];
    }
  }

  checkReserve(symbol, decimals, rawBalance) {
    const humanBalance = Number(rawBalance) / Math.pow(10, decimals);

    if (STABLECOINS.has(symbol)) {
      return humanBalance >= MIN_RESERVES.stablecoins;
    } else if (symbol === 'WETH') {
      return humanBalance >= MIN_RESERVES.WETH;
    } else if (symbol === 'WBTC') {
      return humanBalance >= MIN_RESERVES.WBTC;
    } else {
      return humanBalance >= MIN_RESERVES.default;
    }
  }

  keyCreation(token0, token1) {
    let token0Symbol = '';
    let token1Symbol = '';

    for (const [key, token] of Object.entries(this.tokens)) {
      if (token === token0) token0Symbol = key;
      if (token === token1) token1Symbol = key;
    }

    if (!token0Symbol || !token1Symbol) return null;
    return `${token0Symbol}-${token1Symbol}`;
  }

  saveResults() {
    const outputDir = path.join(this.scriptDir, 'pool_collection', 'pools');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const poolsPath = path.join(outputDir, 'all_pools.json');
    fs.writeFileSync(poolsPath, JSON.stringify(this.allPools, null, 4), 'utf-8');
    console.log('File all_pools.json created successfully');
  }
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

if (require.main === module) {
  const check = new PoolsCheck();
  check.start().catch(error => console.error('Error:', error));
}

module.exports = PoolsCheck;
