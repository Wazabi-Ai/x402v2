import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

const DEPLOYER_KEY = process.env.TREASURY_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    bsc: {
      url: process.env.RPC_BSC || 'https://bsc-dataseed.binance.org',
      chainId: 56,
      accounts: [DEPLOYER_KEY],
    },
    base: {
      url: process.env.RPC_BASE || 'https://mainnet.base.org',
      chainId: 8453,
      accounts: [DEPLOYER_KEY],
    },
    hardhat: {
      chainId: 31337,
    },
  },
  paths: {
    sources: './contracts',
    artifacts: './artifacts',
    cache: './cache',
  },
};

export default config;
