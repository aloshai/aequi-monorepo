require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "shanghai",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    bsc: {
      url: "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: [process.env.BSC_PRIVATE_KEY].filter(Boolean),
    },
    incentiv: {
      url: "https://rpc.incentiv.io",
      chainId: 24101,
      accounts: [process.env.INCENTIV_PRIVATE_KEY].filter(Boolean),
    },
  },
  etherscan: {
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY,
      incentiv: "no-api-key",
    },
    customChains: [
      {
        network: "bsc",
        chainId: 56,
        urls: {
          apiURL: "https://api.bscscan.com/api",
          browserURL: "https://bscscan.com",
        },
      },
      {
        network: "incentiv",
        chainId: 24101,
        urls: {
          apiURL: "https://explorer.incentiv.io/api",
          browserURL: "https://explorer.incentiv.io",
        },
      },
    ],
  },
  sourcify: {
    // Disabled by default
    // Doesn't need an API key
    enabled: true,
  },
};
