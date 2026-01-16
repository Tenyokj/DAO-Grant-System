import { existsSync } from "fs";
import { loadEnvFile } from "process";

if (existsSync(".env")) {
  loadEnvFile();
}

import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatTypechain from "@nomicfoundation/hardhat-typechain";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

import type { HardhatUserConfig } from "hardhat/config";
import { localhost } from "viem/chains";

const config: HardhatUserConfig = {

  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "prague",
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },

  networks: {
    hardhat: {
      type: "edr-simulated", // <-- for the built-in Hardhat network
      chainId: 1337,
      initialBaseFeePerGas: 0,
    },
    localhost: {
      type: "http",          // for a local node via RPC
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    }
  },

 
  plugins: [
    hardhatEthers,
    hardhatTypechain,
    hardhatMocha,
    hardhatEthersChaiMatchers,
    hardhatNetworkHelpers,
    hardhatToolboxMochaEthers,
    hardhatVerify,
  ],
};

export default config;