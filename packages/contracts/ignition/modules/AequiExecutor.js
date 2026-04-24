const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("AequiExecutorModule", (m) => {
  const deployer = m.getAccount(0);
  const feeRecipient = m.getParameter("feeRecipient", deployer);
  const feeBps = m.getParameter("feeBps", 30);
  const aequiExecutor = m.contract("AequiExecutor", [deployer, feeRecipient, feeBps]);

  return { aequiExecutor };
});
