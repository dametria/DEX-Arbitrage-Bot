const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

class DexscreenerParser {
  constructor() {
    this.BASE_URL = 'https://api.dexscreener.com/token-pairs/v1/arbitrum/';
    this.MAX_CONCURRENT = 7;
    this.MAX_RETRIES = 5;
    this.BATCH_SIZE = 100;
    this.BATCH_PAUSE = 60000; // in milliseconds
    this.scriptDir = __dirname;
    this.tokens = {};
    this.pools = {};
  }

  loadTokens() {
    try {
      const tokensPath = path.join(this.scriptDir, 'pools', 'tokens.json');
      const data = fs.readFileSync(tokensPath, 'utf-8');
      this.tokens = JSON.parse(data);
      console.log('[DEBUG] File tokens.json loaded');
    } catch (error) {
      console.error('[ERROR] tokens.json file not found');
    }
  }

  async fetch(semaphore, tokenName, tokenAddress) {
    const url = this.BASE_URL + tokenAddress;
    
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        // Wait for semaphore
        await semaphore.acquire();
        
        try {
          const response = await axios.get(url, {
            timeout: 15000,
            validateStatus: () => true // Don't throw on any status
          });

          if (response.status === 429) {
            const wait = Math.pow(2, attempt) * 1000;
            if (attempt < this.MAX_RETRIES) {
              console.warn(
                `[${tokenName}] 429 Too Many Requests (attempt ${attempt}/${this.MAX_RETRIES}) — retrying in ${wait / 1000}s`
              );
              await this.sleep(wait);
              continue;
            } else {
              console.error(`[${tokenName}] all ${this.MAX_RETRIES} attempts exhausted — skipping`);
              return null;
            }
          }

          if (response.status >= 400) {
            console.warn(`[${tokenName}] HTTP ${response.status} — skipping`);
            return null;
          }

          const data = response.data;
          console.log(`[DEBUG] [${tokenName}] received ${data.length} pools`);
          return { tokenName, data };
        } finally {
          semaphore.release();
        }
      } catch (error) {
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
          const wait = Math.pow(2, attempt - 1) * 1000;
          if (attempt < this.MAX_RETRIES) {
            console.warn(
              `[${tokenName}] timeout (attempt ${attempt}/${this.MAX_RETRIES}) — retrying in ${wait / 1000}s`
            );
            await this.sleep(wait);
          } else {
            console.error(`[${tokenName}] all ${this.MAX_RETRIES} attempts exhausted — skipping`);
          }
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          const wait = Math.pow(2, attempt - 1) * 1000;
          if (attempt < this.MAX_RETRIES) {
            console.warn(
              `[${tokenName}] ${error.code} (attempt ${attempt}/${this.MAX_RETRIES}) — retrying in ${wait / 1000}s`
            );
            await this.sleep(wait);
          } else {
            console.error(`[${tokenName}] all ${this.MAX_RETRIES} attempts exhausted — skipping`);
          }
        } else {
          console.warn(`[${tokenName}] ${error.message} — skipping`);
          return null;
        }
      }
    }

    return null;
  }

  async run() {
    this.loadTokens();
    if (Object.keys(this.tokens).length === 0) {
      return;
    }

    const allTokens = Object.entries(this.tokens);
    const total = allTokens.length;

    // Split into batches
    const batches = [];
    for (let i = 0; i < total; i += this.BATCH_SIZE) {
      batches.push(allTokens.slice(i, i + this.BATCH_SIZE));
    }

    console.log(`Total tokens: ${total}, batches: ${batches.length} (${this.BATCH_SIZE} each)`);

    const semaphore = new Semaphore(this.MAX_CONCURRENT);
    const allResults = [];

    for (let batchNum = 0; batchNum < batches.length; batchNum++) {
      const batch = batches[batchNum];
      console.log(
        `Batch ${batchNum + 1}/${batches.length}: processing tokens ${batchNum * this.BATCH_SIZE + 1}–${Math.min((batchNum + 1) * this.BATCH_SIZE, total)}`
      );

      const tasks = batch.map(([name, address]) =>
        this.fetch(semaphore, name, address)
      );

      const results = await Promise.all(tasks);
      allResults.push(...results);

      // Pause after each batch except the last
      if (batchNum < batches.length - 1) {
        console.log(`Pause ${this.BATCH_PAUSE / 1000}s before next batch...`);
        await this.sleep(this.BATCH_PAUSE);
      }
    }

    for (const result of allResults) {
      if (result === null) continue;
      const { data: poolsData } = result;
      
      for (const pool of poolsData) {
        const dexId = pool.dexId || '';
        const pairAddress = (pool.pairAddress || '').toLowerCase();
        
        if (dexId && pairAddress) {
          if (!this.pools[dexId]) {
            this.pools[dexId] = [];
          }
          if (!this.pools[dexId].includes(pairAddress)) {
            this.pools[dexId].push(pairAddress);
          }
        }
      }
    }

    this.saveFile();
  }

  saveFile() {
    const poolsPath = path.join(this.scriptDir, 'pools', 'pools_dexscreener.json');
    const poolCount = Object.values(this.pools).reduce((sum, arr) => sum + arr.length, 0);
    
    fs.writeFileSync(poolsPath, JSON.stringify(this.pools, null, 4), 'utf-8');
    console.log(`Saved ${poolCount} pools → ${poolsPath}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  start() {
    this.run().catch(error => console.error('Error:', error));
  }
}

// Simple semaphore implementation
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
    if (resolve) {
      resolve();
    }
  }
}

if (require.main === module) {
  const parser = new DexscreenerParser();
  parser.start();
}

module.exports = DexscreenerParser;
