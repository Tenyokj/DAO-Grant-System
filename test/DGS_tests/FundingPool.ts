import { expect, hre, type HardhatEthers, type NetworkHelpers } from "../setup.js";

describe("FundingPool test", async function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;
  const DECIMALS = 10n ** 18n;

  before(async () => {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);
  });

  async function createIdea(ideaContract: any, signer: any) {
    const tx = await ideaContract.connect(signer).createIdea(
      "Name",
      "Description",
      "https://example.com"
    );
    await tx.wait();
    const total = await ideaContract.totalIdeas();
    return total - 1n;
  }

  async function deployFixture() {
    const [owner, addr1, addr2, addrM] = await ethers.getSigners();

    const maxSupply = 10_000_000n * DECIMALS;
    const ownerAddress = await owner.getAddress();
    
    const token = await ethers.deployContract("GovernanceToken", [
      ownerAddress,
      ownerAddress,
      maxSupply,
    ]);

    const idea = await ethers.deployContract("IdeaRegistry", []);
    const mockVoting = await ethers.deployContract("MockVotingSystem", []);
    
    const tokenAddress = await token.getAddress();
    const ideaAddress = await idea.getAddress();
    const mockVotingAddress = await mockVoting.getAddress();
    
    const pool = await ethers.deployContract("FundingPool", [
      tokenAddress,
      mockVotingAddress,
      ideaAddress,
    ]);

    // Set up contract relationships
    await mockVoting.setFundingPool(await pool.getAddress());
    await token.connect(owner).setMinter(await pool.getAddress(), true);
    await idea.connect(owner).authorizeUpdater(mockVotingAddress, true);
    await pool.connect(owner).setVotingSystem(mockVotingAddress);

    return {
      owner,
      addr1,
      addr2,
      addrM,
      token,
      idea,
      mockVoting,
      pool,
    };
  }

  // -------------------- DEPOSITS --------------------
    it("should allow deposit and emit FundsDeposited", async function () {
      const { pool, addr1, token } = await deployFixture();
      const amount = 1000n * DECIMALS;
      
      const addr1Address = await addr1.getAddress();
      const poolAddress = await pool.getAddress();

      await token.mint(addr1Address, amount);
      await token.connect(addr1).approve(poolAddress, amount);

      await expect(pool.connect(addr1).deposit(amount))
        .to.emit(pool, "FundsDeposited")
        .withArgs(addr1Address, amount);

      expect(await pool.totalPoolBalance()).to.equal(amount);
      expect(await pool.donorBalances(addr1Address)).to.equal(amount);
    });

    it("should revert when amount = 0", async function () {
      const { pool, addr1 } = await deployFixture();
      await expect(pool.connect(addr1).deposit(0n))
        .to.be.revertedWith("FundingPool: amount must be > 0");
    });

    it("should revert if user did not approve tokens", async function () {
      const { pool, token, addr1 } = await deployFixture();
      const amount = 1000n * DECIMALS;

      const addr1Address = await addr1.getAddress();
      await token.mint(addr1Address, amount);

      await expect(pool.connect(addr1).deposit(amount))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

  // -------------------- CONTRIBUTIONS --------------------
    it("records contribution correctly", async function () {
      const { pool, addr1, token } = await deployFixture();
      const amount = 1000n * DECIMALS;

      const addr1Address = await addr1.getAddress();
      const poolAddress = await pool.getAddress();

      await token.mint(addr1Address, amount * 3n);
      await token.connect(addr1).approve(poolAddress, amount * 3n);

      await pool.connect(addr1).deposit(amount);
      await pool.connect(addr1).deposit(amount);
      await pool.connect(addr1).deposit(amount);

      expect(await pool.donorBalances(addr1Address)).to.equal(amount * 3n);
  });

  // -------------------- DISTRIBUTE --------------------
    it("allows VotingSystem to distribute funds and emits FundsDistributed", async function () {
      const { pool, addr1, token, idea, mockVoting, owner } = await deployFixture();
      const depositAmount = 1000n * DECIMALS;
      const roundId = 1n;

      // Create an idea
      let ideaId = await createIdea(idea, addr1);
      if (ideaId === 0n) {
        await createIdea(idea, addr1);
        const total = await idea.totalIdeas();
        ideaId = total - 1n;
      }

      const addr1Address = await addr1.getAddress();
      const poolAddress = await pool.getAddress();

      // Mint tokens
      await token.connect(owner).mint(addr1Address, depositAmount);
      
      // Approve and deposit
      await token.connect(addr1).approve(poolAddress, depositAmount);
      await pool.connect(addr1).deposit(depositAmount);

      // Set winning idea
      await mockVoting.setWinningIdea(roundId, ideaId);
      
      // Try to distribute and check event
      await expect(mockVoting.distributeFunds(roundId))
        .to.emit(pool, "FundsDistributed")
        .withArgs(roundId, ideaId, depositAmount / 10n);

      // Check balances
      expect(await pool.totalPoolBalance()).to.equal(depositAmount - depositAmount / 10n);
      expect(await token.balanceOf(addr1Address)).to.equal(depositAmount / 10n);
    });

    it("reverts for non-votingSystem", async function () {
      const { pool, addr1 } = await deployFixture();
      await expect(pool.connect(addr1).distributeFunds(1n))
        .to.be.revertedWith("FundingPool: caller is not VotingSystem");
    });

  // -------------------- SETTERS --------------------
    it("owner can setVotingSystem", async function () {
      const { pool, owner, mockVoting } = await deployFixture();

      const mockVotingAddress = await mockVoting.getAddress();

      await expect(pool.connect(owner).setVotingSystem(mockVotingAddress))
        .to.emit(pool, "VotingSystemUpdated")
        .withArgs(mockVotingAddress);

      expect(await pool.votingSystem()).to.equal(mockVotingAddress);
    });

    it("rejects zero address for setVotingSystem", async function () {
      const { pool, owner } = await deployFixture();
      await expect(pool.connect(owner).setVotingSystem(ethers.ZeroAddress))
        .to.be.revertedWith("FundingPool: voting 0");
    });
});