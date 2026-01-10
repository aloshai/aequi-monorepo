const { expect } = require('chai')
const { ethers } = require('hardhat')
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers')

describe('AequiLens', function () {
  async function deployLensFixture() {
    const [owner, user] = await ethers.getSigners()

    const AequiLens = await ethers.getContractFactory('AequiLens')
    const lens = await AequiLens.deploy()

    // Deploy mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    const tokenA = await MockERC20.deploy('Token A', 'TKNA', 18)
    const tokenB = await MockERC20.deploy('Token B', 'TKNB', 6)

    return { lens, tokenA, tokenB, owner, user }
  }

  describe('Token Metadata Batch', function () {
    it('should fetch token metadata for valid tokens', async function () {
      const { lens, tokenA, tokenB } = await loadFixture(deployLensFixture)

      const tokens = [await tokenA.getAddress(), await tokenB.getAddress()]
      const metadata = await lens.batchGetTokenMetadata(tokens)

      expect(metadata.length).to.equal(2)
      
      expect(metadata[0].exists).to.be.true
      expect(metadata[0].name).to.equal('Token A')
      expect(metadata[0].symbol).to.equal('TKNA')
      expect(metadata[0].decimals).to.equal(18)

      expect(metadata[1].exists).to.be.true
      expect(metadata[1].name).to.equal('Token B')
      expect(metadata[1].symbol).to.equal('TKNB')
      expect(metadata[1].decimals).to.equal(6)
    })

    it('should handle non-existent token addresses', async function () {
      const { lens } = await loadFixture(deployLensFixture)

      const tokens = [
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
      ]
      const metadata = await lens.batchGetTokenMetadata(tokens)

      expect(metadata.length).to.equal(2)
      expect(metadata[0].exists).to.be.false
      expect(metadata[1].exists).to.be.false
    })
  })

  describe('Token Balances Batch', function () {
    it('should fetch balances for multiple tokens', async function () {
      const { lens, tokenA, tokenB, user } = await loadFixture(deployLensFixture)

      // Mint some tokens to user
      await tokenA.mint(user.address, ethers.parseEther('100'))
      await tokenB.mint(user.address, ethers.parseUnits('50', 6))

      const tokens = [await tokenA.getAddress(), await tokenB.getAddress()]
      const balances = await lens.batchCheckTokenBalances(tokens, user.address)

      expect(balances.length).to.equal(2)
      expect(balances[0]).to.equal(ethers.parseEther('100'))
      expect(balances[1]).to.equal(ethers.parseUnits('50', 6))
    })

    it('should return zero for non-existent tokens', async function () {
      const { lens, user } = await loadFixture(deployLensFixture)

      const tokens = ['0x0000000000000000000000000000000000000001']
      const balances = await lens.batchCheckTokenBalances(tokens, user.address)

      expect(balances[0]).to.equal(0)
    })
  })

  describe('Token Allowances Batch', function () {
    it('should fetch allowances for multiple tokens', async function () {
      const { lens, tokenA, tokenB, owner, user } = await loadFixture(deployLensFixture)

      const spender = await lens.getAddress()

      // Mint and approve
      await tokenA.mint(owner.address, ethers.parseEther('100'))
      await tokenB.mint(owner.address, ethers.parseUnits('50', 6))
      
      await tokenA.approve(spender, ethers.parseEther('10'))
      await tokenB.approve(spender, ethers.parseUnits('5', 6))

      const tokens = [await tokenA.getAddress(), await tokenB.getAddress()]
      const allowances = await lens.batchCheckAllowances(tokens, owner.address, spender)

      expect(allowances.length).to.equal(2)
      expect(allowances[0]).to.equal(ethers.parseEther('10'))
      expect(allowances[1]).to.equal(ethers.parseUnits('5', 6))
    })
  })

  describe('V2 Pool Data Batch', function () {
    it('should handle non-existent pool addresses', async function () {
      const { lens } = await loadFixture(deployLensFixture)

      const pairs = [
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
      ]
      const poolData = await lens.batchGetV2PoolData(pairs)

      expect(poolData.length).to.equal(2)
      expect(poolData[0].exists).to.be.false
      expect(poolData[1].exists).to.be.false
    })
  })

  describe('V3 Pool Data Batch', function () {
    it('should handle non-existent pool addresses', async function () {
      const { lens } = await loadFixture(deployLensFixture)

      const pools = [
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
      ]
      const poolData = await lens.batchGetV3PoolData(pools)

      expect(poolData.length).to.equal(2)
      expect(poolData[0].exists).to.be.false
      expect(poolData[1].exists).to.be.false
    })
  })

  describe('Gas Efficiency', function () {
    it('should batch process multiple tokens efficiently', async function () {
      const { lens, tokenA, tokenB } = await loadFixture(deployLensFixture)

      const tokens = [await tokenA.getAddress(), await tokenB.getAddress()]
      
      const tx = await lens.batchGetTokenMetadata.staticCall(tokens)
      
      expect(tx.length).to.equal(2)
    })
  })
})
