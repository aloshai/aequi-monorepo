const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("AequiLensModule", (m) => {
  const lens = m.contract("AequiLens");

  return { lens };
});
