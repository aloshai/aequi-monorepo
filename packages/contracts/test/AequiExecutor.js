const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AequiExecutor", function () {
  let executor;
  let tokenA;
  let tokenB;
  let owner;
  let user;
  let other;

  beforeEach(async function () {
    [owner, user, , other] = await ethers.getSigners();

    const AequiExecutor = await ethers.getContractFactory("AequiExecutor");
    executor = await AequiExecutor.deploy(owner.address);
    await executor.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKA", ethers.parseEther("10000"));
    await tokenA.waitForDeployment();
    tokenB = await MockERC20.deploy("Token B", "TKB", ethers.parseEther("10000"));
    await tokenB.waitForDeployment();

    await tokenA.transfer(user.address, ethers.parseEther("1000"));
    await tokenB.transfer(user.address, ethers.parseEther("1000"));
  });

  describe("Execution", function () {
    it("Should pull tokens and flush delta to msg.sender", async function () {
      const amount = ethers.parseEther("100");
      await tokenA.connect(user).approve(executor.target, amount);

      const pulls = [{ token: tokenA.target, amount }];

      await executor.connect(user).execute(
        pulls,
        [],
        [],
        [tokenA.target]
      );

      expect(await tokenA.balanceOf(user.address)).to.equal(ethers.parseEther("1000"));
      expect(await tokenA.balanceOf(executor.target)).to.equal(0);
    });

    it("Should set and revoke approvals", async function () {
      const amount = ethers.parseEther("100");
      await tokenA.connect(user).approve(executor.target, amount);

      const pulls = [{ token: tokenA.target, amount }];
      const approvals = [{
        token: tokenA.target,
        spender: other.address,
        amount,
        revokeAfter: true,
      }];

      await executor.connect(user).execute(
        pulls,
        approvals,
        [],
        [tokenA.target]
      );

      expect(await tokenA.allowance(executor.target, other.address)).to.equal(0);
    });

    it("Should not revoke approvals if revokeAfter is false", async function () {
      const amount = ethers.parseEther("100");
      await tokenA.connect(user).approve(executor.target, amount);

      const pulls = [{ token: tokenA.target, amount }];
      const approvals = [{
        token: tokenA.target,
        spender: other.address,
        amount,
        revokeAfter: false,
      }];

      await executor.connect(user).execute(
        pulls,
        approvals,
        [],
        [tokenA.target]
      );

      expect(await tokenA.allowance(executor.target, other.address)).to.equal(amount);
    });

    it("Should perform arbitrary calls", async function () {
      const mintAmount = ethers.parseEther("50");
      const callData = tokenB.interface.encodeFunctionData("mint", [user.address, mintAmount]);

      const calls = [{
        target: tokenB.target,
        value: 0,
        data: callData,
        injectToken: ethers.ZeroAddress,
        injectOffset: 0,
      }];

      await executor.connect(user).execute([], [], calls, []);

      expect(await tokenB.balanceOf(user.address)).to.equal(ethers.parseEther("1000") + mintAmount);
    });

    it("Should flush native ETH delta to msg.sender", async function () {
      const ethAmount = ethers.parseEther("1");
      const balanceBefore = await ethers.provider.getBalance(user.address);

      const tx = await executor.connect(user).execute(
        [], [], [], [],
        { value: ethAmount }
      );
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(user.address);
      expect(balanceBefore - balanceAfter).to.equal(gasCost);
    });

    it("Should revert if pull fails (no approval)", async function () {
      const amount = ethers.parseEther("100");
      const pulls = [{ token: tokenA.target, amount }];

      await expect(
        executor.connect(user).execute(pulls, [], [], [])
      ).to.be.reverted;
    });

    it("Should revert if external call fails", async function () {
      const calls = [{
        target: tokenA.target,
        value: 0,
        data: "0xdeadbeef",
        injectToken: ethers.ZeroAddress,
        injectOffset: 0,
      }];

      await expect(
        executor.connect(user).execute([], [], calls, [])
      ).to.be.reverted;
    });

    it("Should revert on injection with offset < 4 (selector overwrite)", async function () {
      const amount = ethers.parseEther("100");
      await tokenA.connect(user).approve(executor.target, amount);
      await tokenA.transfer(executor.target, amount);

      const dummyData = "0xdeadbeef" + "00".repeat(32);
      const calls = [{
        target: tokenB.target,
        value: 0,
        data: dummyData,
        injectToken: tokenA.target,
        injectOffset: 0,
      }];

      await expect(
        executor.connect(user).execute([], [], calls, [])
      ).to.be.revertedWithCustomError(executor, "InvalidInjectionOffset");
    });

    it("Should revert on injection with offset + 32 > data.length", async function () {
      const amount = ethers.parseEther("100");
      await tokenA.transfer(executor.target, amount);

      const shortData = "0xdeadbeef" + "00".repeat(8);
      const calls = [{
        target: tokenB.target,
        value: 0,
        data: shortData,
        injectToken: tokenA.target,
        injectOffset: 4,
      }];

      await expect(
        executor.connect(user).execute([], [], calls, [])
      ).to.be.revertedWithCustomError(executor, "InvalidInjectionOffset");
    });
  });

  describe("Admin", function () {
    it("Should pause and unpause", async function () {
      await executor.connect(owner).pause();
      await expect(
        executor.connect(user).execute([], [], [], [])
      ).to.be.reverted;

      await executor.connect(owner).unpause();
      await executor.connect(user).execute([], [], [], []);
    });

    it("Should rescue tokens", async function () {
      const amount = ethers.parseEther("50");
      await tokenA.transfer(executor.target, amount);

      await executor.connect(owner).rescueFunds(tokenA.target, owner.address, amount);
      expect(await tokenA.balanceOf(owner.address)).to.equal(ethers.parseEther("9000"));
    });

    it("Should rescue ETH", async function () {
      const ethAmount = ethers.parseEther("1");
      await owner.sendTransaction({ to: executor.target, value: ethAmount });

      const balanceBefore = await ethers.provider.getBalance(owner.address);
      const tx = await executor.connect(owner).rescueETH(owner.address, ethAmount);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(owner.address);
      expect(balanceAfter - balanceBefore + gasCost).to.equal(ethAmount);
    });

    it("Should reject non-owner admin calls", async function () {
      await expect(executor.connect(user).pause()).to.be.reverted;
      await expect(executor.connect(user).rescueFunds(tokenA.target, user.address, 1)).to.be.reverted;
      await expect(executor.connect(user).rescueETH(user.address, 1)).to.be.reverted;
    });
  });
});
