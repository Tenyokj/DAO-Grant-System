import {
  expect,
  hre,
  type HardhatEthers,
  type NetworkHelpers,
} from "../setup.js";

describe("DAO Grant System - Integration Test", function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;
  
  // Contracts
  let token: any;
  let ideaRegistry: any;
  let votingSystem: any;
  let fundingPool: any;
  let grantManager: any;
  
  // Accounts
  let owner: any;
  let ideaAuthor: any;
  let voter1: any;
  let voter2: any;
  let voter3: any;
  
  // Constants
  const GRANT_AMOUNT = BigInt("1000000000000000000000"); // 1000 tokens
  const MIN_STAKE = BigInt("500000000000000000000"); // 500 tokens
  const ONE_DAY = 24 * 60 * 60;
  const VOTING_DURATION = 3 * ONE_DAY;

  async function deployAndSetupContracts() {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);

    const signers = await ethers.getSigners();
    [owner, ideaAuthor, voter1, voter2, voter3] = signers;
    
    // 1. Deploy GovernanceToken
    token = await ethers.deployContract("GovernanceToken", [
      owner.address, // Temporary, will be replaced
      ethers.parseEther("1000000")
    ]);
    
    // 2. Deploy IdeaRegistry
    ideaRegistry = await ethers.deployContract("IdeaRegistry", []);
    
    // 3. Deploy VotingSystem
    votingSystem = await ethers.deployContract("VotingSystem", [
      await token.getAddress()
    ]);
    
    // 4. Deploy FundingPool
    fundingPool = await ethers.deployContract("FundingPool", [
      await token.getAddress(),
      owner.address, // Temporary, will be replaced
      await ideaRegistry.getAddress()
    ]);
    
    // 5. Deploy GrantManager
    grantManager = await ethers.deployContract("GrantManager", [
      await votingSystem.getAddress(),
      await fundingPool.getAddress(),
      await ideaRegistry.getAddress()
    ]);
    
    // 6. Configure relationships
    await ideaRegistry.connect(owner).authorizeUpdater(await grantManager.getAddress(), true);
    await votingSystem.connect(owner).setGrantManager(await grantManager.getAddress());
    await fundingPool.connect(owner).setGrantManager(await grantManager.getAddress());
    await token.connect(owner).setMinter(await grantManager.getAddress(), true);
    
    return { token, ideaRegistry, votingSystem, fundingPool, grantManager };
  }

  describe("Complete Workflow", function () {
    beforeEach(async function () {
      await deployAndSetupContracts();
    });

    it("Should complete full grant lifecycle: Idea → Vote → Fund", async function () {
      console.log("\n=== Starting Complete Workflow Test ===");
      
      // Phase 1: Create Idea
      console.log("1. Creating idea...");
      await ideaRegistry.connect(ideaAuthor).createIdea(
        "DeFi Lending Protocol",
        "A decentralized lending protocol with flash loans",
        "https://github.com/defi-lending"
      );
      
      let idea = await ideaRegistry.getIdea(1);
      expect(idea[1]).to.equal(ideaAuthor.address); // author
      expect(idea[7]).to.equal(0); // Status.Pending
      console.log("✓ Idea created with ID: 1");
      
      // Phase 2: Deposit to FundingPool
      console.log("\n2. Depositing to FundingPool...");
      const depositAmount = ethers.parseEther("5000");
      
      // Mint tokens to voters and owner
      await token.connect(owner).mint(owner.address, depositAmount);
      await token.connect(owner).mint(voter1.address, ethers.parseEther("2000"));
      await token.connect(owner).mint(voter2.address, ethers.parseEther("2000"));
      await token.connect(owner).mint(voter3.address, ethers.parseEther("2000"));
      
      // Approve and deposit
      await token.connect(owner).approve(await fundingPool.getAddress(), depositAmount);
      await fundingPool.connect(owner).deposit(depositAmount);
      
      expect(await fundingPool.totalPoolBalance()).to.equal(depositAmount);
      console.log(`✓ Deposited ${ethers.formatEther(depositAmount)} tokens to pool`);
      
      // Phase 3: Create Grant Round
      console.log("\n3. Creating grant round...");
      const currentTime = await networkHelpers.time.latest();
      const startTime = currentTime + 100;
      const endTime = startTime + 7 * ONE_DAY;
      
      await grantManager.connect(owner).createRound(
        "Q1 2024 Innovation Grants",
        startTime,
        endTime,
        [1] // Include our idea
      );
      
      expect(await grantManager.currentRoundId()).to.equal(1);
      console.log("✓ Grant round created with ID: 1");
      
      // Phase 4: Start Voting
      console.log("\n4. Starting voting...");
      await networkHelpers.time.increaseTo(startTime);
      await grantManager.connect(owner).startVoting(1);
      
      // Check idea status updated
      idea = await ideaRegistry.getIdea(1);
      expect(idea[7]).to.equal(1); // Status.Voting
      console.log("✓ Voting started, idea status: Voting");
      
      // Phase 5: Community Voting
      console.log("\n5. Community voting...");
      
      // Voters approve VotingSystem
      await token.connect(voter1).approve(await votingSystem.getAddress(), ethers.parseEther("2000"));
      await token.connect(voter2).approve(await votingSystem.getAddress(), ethers.parseEther("2000"));
      await token.connect(voter3).approve(await votingSystem.getAddress(), ethers.parseEther("2000"));
      
      // Voters cast votes
      const vote1 = ethers.parseEther("800");
      const vote2 = ethers.parseEther("600");
      const vote3 = ethers.parseEther("500");
      
      await votingSystem.connect(voter1).vote(1, 1, vote1);
      await votingSystem.connect(voter2).vote(1, 1, vote2);
      await votingSystem.connect(voter3).vote(1, 1, vote3);
      
      // Check votes recorded
      const votes = await votingSystem.getVotesForIdea(1, 1);
      expect(votes).to.equal(vote1 + vote2 + vote3);
      console.log(`✓ Votes cast: ${ethers.formatEther(votes)} tokens`);
      
      // Phase 6: End Voting
      console.log("\n6. Ending voting...");
      await networkHelpers.time.increaseTo(endTime + 1);
      await grantManager.connect(owner).endVoting(1);
      
      // Check round state
      const round = await grantManager.getRound(1);
      expect(round[8]).to.equal(true); // votingEnded
      expect(round[5]).to.equal(1); // winningIdeaId
      
      // Check idea status updated
      idea = await ideaRegistry.getIdea(1);
      expect(idea[7]).to.equal(2); // Status.WonVoting
      console.log("✓ Voting ended, idea status: WonVoting");
      
      // Phase 7: Finalize Round
      console.log("\n7. Finalizing round...");
      await grantManager.connect(owner).finalizeRound(1);
      
      const roundAfterFinalize = await grantManager.getRound(1);
      expect(roundAfterFinalize[9]).to.equal(true); // finalized
      console.log("✓ Round finalized");
      
      // Phase 8: Distribute Funds
      console.log("\n8. Distributing funds...");
      const authorBalanceBefore = await token.balanceOf(ideaAuthor.address);
      
      await grantManager.connect(owner).distributeFunds(1);
      
      // Check funds transferred
      const authorBalanceAfter = await token.balanceOf(ideaAuthor.address);
      expect(authorBalanceAfter - authorBalanceBefore).to.equal(GRANT_AMOUNT);
      
      // Check idea status updated
      idea = await ideaRegistry.getIdea(1);
      expect(idea[7]).to.equal(3); // Status.Funded
      
      // Check round marked as funded
      const finalRound = await grantManager.getRound(1);
      expect(finalRound[10]).to.equal(true); // funded
      
      console.log(`✓ Funds distributed: ${ethers.formatEther(GRANT_AMOUNT)} tokens to author`);
      console.log("✓ Idea status: Funded");
      
      // Phase 9: Verify Distribution History
      console.log("\n9. Verifying distribution history...");
      const distributionCount = await fundingPool.getDistributionCount();
      expect(distributionCount).to.equal(1);
      
      const distribution = await fundingPool.getDistribution(0);
      expect(distribution[0]).to.equal(1); // roundId
      expect(distribution[1]).to.equal(1); // ideaId
      expect(distribution[2]).to.equal(GRANT_AMOUNT); // amount
      
      console.log("✓ Distribution recorded in history");
      console.log("\n=== Complete Workflow Test PASSED ===");
    });

    it("Should handle multiple ideas and voting rounds (single vote per voter)", async function () {
    // Create multiple ideas
    await ideaRegistry.connect(ideaAuthor).createIdea(
        "Idea A",
        "Description A",
        ""
    );
    await ideaRegistry.connect(voter1).createIdea(
        "Idea B",
        "Description B",
        ""
    );
    await ideaRegistry.connect(voter2).createIdea(
        "Idea C",
        "Description C",
        ""
    );

    // Fund the pool
    const depositAmount = ethers.parseEther("10000");
    await token.connect(owner).mint(owner.address, depositAmount);
    await token.connect(owner).approve(
        await fundingPool.getAddress(),
        depositAmount
    );
    await fundingPool.connect(owner).deposit(depositAmount);

    // Create round with multiple ideas
    const currentTime = await networkHelpers.time.latest();
    await grantManager.connect(owner).createRound(
        "Multi-Idea Round",
        currentTime + 100,
        currentTime + 100 + 7 * ONE_DAY,
        [1, 2, 3]
    );

    // Start voting
    await networkHelpers.time.increase(101);
    await grantManager.connect(owner).startVoting(1);

    // Setup voting tokens
    const stakeAmount = ethers.parseEther("3000");
    await token.connect(owner).mint(voter1.address, stakeAmount);
    await token.connect(voter1).approve(
        await votingSystem.getAddress(),
        stakeAmount
    );

    // ✅ Single vote: voter1 votes once for Idea B with full stake
    await votingSystem
        .connect(voter1)
        .vote(1, 2, stakeAmount);

    // End voting
    await networkHelpers.time.increase(7 * ONE_DAY);
    await grantManager.connect(owner).endVoting(1);

    // Idea B should win
    const round = await grantManager.getRound(1);
    expect(round[5]).to.equal(2); // winningIdeaId == 2

    // Check idea status
    const ideaB = await ideaRegistry.getIdea(2);
    expect(ideaB[7]).to.equal(2); // Status.WonVoting
    });


    it("Should handle tie-breaking (first idea wins)", async function () {
      // Create two ideas
      await ideaRegistry.connect(ideaAuthor).createIdea("Idea X", "Description X", "");
      await ideaRegistry.connect(voter1).createIdea("Idea Y", "Description Y", "");
      
      // Fund the pool
      const depositAmount = ethers.parseEther("5000");
      await token.connect(owner).mint(owner.address, depositAmount);
      await token.connect(owner).approve(await fundingPool.getAddress(), depositAmount);
      await fundingPool.connect(owner).deposit(depositAmount);
      
      // Create round
      const currentTime = await networkHelpers.time.latest();
      await grantManager.connect(owner).createRound(
        "Tie Round",
        currentTime + 100,
        currentTime + 100 + 7 * ONE_DAY,
        [1, 2]
      );
      
      // Start voting
      await networkHelpers.time.increase(101);
      await grantManager.connect(owner).startVoting(1);
      
      // Setup equal votes
      await token.connect(owner).mint(voter1.address, ethers.parseEther("1000"));
      await token.connect(owner).mint(voter2.address, ethers.parseEther("1000"));
      await token.connect(voter1).approve(await votingSystem.getAddress(), ethers.parseEther("1000"));
      await token.connect(voter2).approve(await votingSystem.getAddress(), ethers.parseEther("1000"));
      
      // Create tie: both ideas get 1000 votes
      await votingSystem.connect(voter1).vote(1, 1, ethers.parseEther("1000")); // Idea X
      await votingSystem.connect(voter2).vote(1, 2, ethers.parseEther("1000")); // Idea Y
      
      // End voting - first idea (X) should win
      await networkHelpers.time.increase(7 * ONE_DAY);
      await grantManager.connect(owner).endVoting(1);
      
      const round = await grantManager.getRound(1);
      expect(round[5]).to.equal(1); // First idea (X) wins in tie
    });

    it("Should reject invalid state transitions", async function () {
      // Create idea and round
      await ideaRegistry.connect(ideaAuthor).createIdea("Test Idea", "Description", "");
      
      const currentTime = await networkHelpers.time.latest();
      await grantManager.connect(owner).createRound(
        "Test Round",
        currentTime + 100,
        currentTime + 100 + 7 * ONE_DAY,
        [1]
      );
      
      // Try to end voting before starting
      await expect(
        grantManager.connect(owner).endVoting(1)
      ).to.be.revertedWith("GrantManager: voting not started");
      
      // Try to finalize before ending voting
      await expect(
        grantManager.connect(owner).finalizeRound(1)
      ).to.be.revertedWith("GrantManager: voting not ended");
      
      // Try to distribute before finalizing
      await expect(
        grantManager.connect(owner).distributeFunds(1)
      ).to.be.revertedWith("GrantManager: not finalized");
    });
  });
});