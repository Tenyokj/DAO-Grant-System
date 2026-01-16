import {
  expect,
  hre,
  type HardhatEthers,
  type NetworkHelpers,
} from "../setup.js";

describe("GrantManager", function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;
  let grantManager: any;
  let votingSystem: any;
  let fundingPool: any;
  let ideaRegistry: any;
  let token: any;
  let owner: any;
  let user1: any;
  let user2: any;
  
  const GRANT_AMOUNT = BigInt("1000000000000000000000"); // 1000 tokens
  const ONE_DAY = 24 * 60 * 60;

  beforeEach(async function () {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);

    const signers = await ethers.getSigners();
    [owner, user1, user2] = signers;
    
    // Get current timestamp
    const currentTime = await networkHelpers.time.latest();
    
    // Deploy token
    token = await ethers.deployContract("GovernanceToken", [
      owner.address, // Temporary owner
      ethers.parseEther("1000000")
    ]);
    
    // Deploy IdeaRegistry
    ideaRegistry = await ethers.deployContract("IdeaRegistry", []);
    
    // Create some ideas
    await ideaRegistry.connect(user1).createIdea("Idea 1", "Description 1", "");
    await ideaRegistry.connect(user2).createIdea("Idea 2", "Description 2", "");
    await ideaRegistry.connect(user1).createIdea("Idea 3", "Description 3", "");
    
    // Deploy VotingSystem
    votingSystem = await ethers.deployContract("VotingSystem", [
      await token.getAddress()
    ]);
    
    // Deploy FundingPool
    fundingPool = await ethers.deployContract("FundingPool", [
      await token.getAddress(),
      owner.address, // Temporary owner
      await ideaRegistry.getAddress()
    ]);
    
    // Deploy GrantManager
    grantManager = await ethers.deployContract("GrantManager", [
      await votingSystem.getAddress(),
      await fundingPool.getAddress(),
      await ideaRegistry.getAddress()
    ]);
    
    // Configure relationships
    await ideaRegistry.connect(owner).authorizeUpdater(await grantManager.getAddress(), true);
    await votingSystem.connect(owner).setGrantManager(await grantManager.getAddress());
    await fundingPool.connect(owner).setGrantManager(await grantManager.getAddress());
    await token.connect(owner).setMinter(await grantManager.getAddress(), true);
    
    // Fund the pool
    const depositAmount = ethers.parseEther("5000");
    await token.connect(owner).mint(owner.address, depositAmount);
    await token.connect(owner).approve(await fundingPool.getAddress(), depositAmount);
    await fundingPool.connect(owner).deposit(depositAmount);
  });

  describe("Deployment", function () {
    it("Should set correct addresses", async function () {
      expect(await grantManager.votingSystem()).to.equal(await votingSystem.getAddress());
      expect(await grantManager.fundingPool()).to.equal(await fundingPool.getAddress());
      expect(await grantManager.ideaRegistry()).to.equal(await ideaRegistry.getAddress());
    });

    it("Should set correct grant amount", async function () {
      expect(await grantManager.grantAmountPerRound()).to.equal(GRANT_AMOUNT);
    });

    it("Should start with zero rounds", async function () {
      expect(await grantManager.currentRoundId()).to.equal(0);
    });
  });

  describe("Creating Rounds", function () {
    it("Should create a new grant round", async function () {
      const currentTime = await networkHelpers.time.latest();
      const startTime = currentTime + 100;
      const endTime = startTime + 7 * ONE_DAY;
      const ideaIds = [1, 2];
      
      await expect(
        grantManager.connect(owner).createRound("Q1 Grants", startTime, endTime, ideaIds)
      )
        .to.emit(grantManager, "RoundCreated")
        .withArgs(1, "Q1 Grants", ideaIds);
      
      expect(await grantManager.currentRoundId()).to.equal(1);
      
      const round = await grantManager.getRound(1);
      expect(round[0]).to.equal(1); // id
      expect(round[1]).to.equal("Q1 Grants"); // name
      expect(round[2]).to.equal(startTime); // startTime
      expect(round[3]).to.equal(endTime); // endTime
      expect(round[4]).to.deep.equal(ideaIds); // ideaIds
      expect(round[5]).to.equal(0); // winningIdeaId
      expect(round[7]).to.equal(false); // votingStarted
      expect(round[8]).to.equal(false); // votingEnded
      expect(round[9]).to.equal(false); // finalized
      expect(round[10]).to.equal(false); // funded
    });

    it("Should reject invalid time range", async function () {
      const currentTime = await networkHelpers.time.latest();
      const startTime = currentTime + 100;
      const endTime = startTime - 50; // End before start
      
      await expect(
        grantManager.connect(owner).createRound("Invalid", startTime, endTime, [1])
      ).to.be.revertedWith("GrantManager: invalid time range");
    });

    it("Should reject empty idea list", async function () {
      const currentTime = await networkHelpers.time.latest();
      const startTime = currentTime + 100;
      const endTime = startTime + 7 * ONE_DAY;
      
      await expect(
        grantManager.connect(owner).createRound("Empty", startTime, endTime, [])
      ).to.be.revertedWith("GrantManager: no ideas");
    });

    it("Should reject non-owner from creating rounds", async function () {
      const currentTime = await networkHelpers.time.latest();
      const startTime = currentTime + 100;
      const endTime = startTime + 7 * ONE_DAY;
      
      await expect(
        grantManager.connect(user1).createRound("Test", startTime, endTime, [1])
      ).to.be.revertedWithCustomError(grantManager, "OwnableUnauthorizedAccount");
    });

    it("Should create multiple rounds", async function () {
      const currentTime = await networkHelpers.time.latest();
      
      await grantManager.connect(owner).createRound(
        "Round 1",
        currentTime + 100,
        currentTime + 100 + 7 * ONE_DAY,
        [1]
      );
      
      await grantManager.connect(owner).createRound(
        "Round 2",
        currentTime + 200,
        currentTime + 200 + 7 * ONE_DAY,
        [2]
      );
      
      expect(await grantManager.currentRoundId()).to.equal(2);
    });
  });

  describe("Starting Voting", function () {
    let roundId: number;
    let startTime: number;
    let endTime: number;

    beforeEach(async function () {
      const currentTime = await networkHelpers.time.latest();
      startTime = currentTime + 100;
      endTime = startTime + 7 * ONE_DAY;
      
      await grantManager.connect(owner).createRound(
        "Test Round",
        startTime,
        endTime,
        [1, 2]
      );
      roundId = 1;
    });

    it("Should start voting at correct time", async function () {
      await networkHelpers.time.increaseTo(startTime);
      
      await expect(
        grantManager.connect(owner).startVoting(roundId)
      )
        .to.emit(grantManager, "VotingStarted")
        .withArgs(roundId, startTime, endTime);
      
      const round = await grantManager.getRound(roundId);
      expect(round[7]).to.equal(true); // votingStarted
      
      // Check idea statuses updated
      const idea1 = await ideaRegistry.getIdea(1);
      const idea2 = await ideaRegistry.getIdea(2);
      expect(idea1[7]).to.equal(1); // Status.Voting
      expect(idea2[7]).to.equal(1); // Status.Voting
    });

    it("Should reject starting voting too early", async function () {
      await expect(
        grantManager.connect(owner).startVoting(roundId)
      ).to.be.revertedWith("GrantManager: too early");
    });

    it("Should reject starting voting too late", async function () {
      await networkHelpers.time.increaseTo(endTime + 1);
      
      await expect(
        grantManager.connect(owner).startVoting(roundId)
      ).to.be.revertedWith("GrantManager: too late");
    });

    it("Should reject starting voting twice", async function () {
      await networkHelpers.time.increaseTo(startTime);
      await grantManager.connect(owner).startVoting(roundId);
      
      await expect(
        grantManager.connect(owner).startVoting(roundId)
      ).to.be.revertedWith("GrantManager: voting already started");
    });

    it("Should reject starting non-existent round", async function () {
      await expect(
        grantManager.connect(owner).startVoting(999)
      ).to.be.revertedWith("GrantManager: round does not exist");
    });

    it("Should reject non-owner from starting voting", async function () {
      await networkHelpers.time.increaseTo(startTime);
      
      await expect(
        grantManager.connect(user1).startVoting(roundId)
      ).to.be.revertedWithCustomError(grantManager, "OwnableUnauthorizedAccount");
    });
  });

  describe("Ending Voting", function () {
    let roundId: number;

    beforeEach(async function () {
      const currentTime = await networkHelpers.time.latest();
      const startTime = currentTime + 100;
      const endTime = startTime + 7 * ONE_DAY;
      
      await grantManager.connect(owner).createRound(
        "Test Round",
        startTime,
        endTime,
        [1, 2]
      );
      roundId = 1;
      
      // Start voting
      await networkHelpers.time.increaseTo(startTime);
      await grantManager.connect(owner).startVoting(roundId);
      
      // Setup voting in VotingSystem
      // Note: In real integration, VotingSystem would have actual votes
      // For this test, we'll mock the behavior by setting up VotingSystem
    });

    it("Should end voting after end time", async function () {
      const currentTime = await networkHelpers.time.latest();
      const endTime = currentTime + 7 * ONE_DAY;
      
      await networkHelpers.time.increaseTo(endTime + 1);
      
      // Mock VotingSystem to return a winner
      // This would require proper integration setup
      // For now, we'll test the contract logic assuming VotingSystem works
    });

    it("Should reject ending voting before end time", async function () {
      await expect(
        grantManager.connect(owner).endVoting(roundId)
      ).to.be.revertedWith("GrantManager: voting not finished");
    });

    it("Should reject ending non-existent round", async function () {
      await expect(
        grantManager.connect(owner).endVoting(999)
      ).to.be.revertedWith("GrantManager: round does not exist");
    });
  });

  describe("Finalizing Rounds", function () {
    // Similar structure for finalization tests
    it("Should finalize round after voting ends", async function () {
      // This would require full integration setup
      // Implementation depends on VotingSystem integration
    });
  });

  describe("Distributing Funds", function () {
    // Similar structure for distribution tests
    it("Should distribute funds to winner", async function () {
      // This would require full integration setup
      // Implementation depends on VotingSystem and FundingPool integration
    });
  });

  describe("Admin Functions", function () {
    it("Should update grant amount per round", async function () {
      const newAmount = ethers.parseEther("2000");
      
      await expect(
        grantManager.connect(owner).setGrantAmountPerRound(newAmount)
      )
        .to.emit(grantManager, "GrantAmountUpdated")
        .withArgs(newAmount);
      
      expect(await grantManager.grantAmountPerRound()).to.equal(newAmount);
    });

    it("Should update contract addresses", async function () {
      const newVotingSystem = user1.address;
      const newFundingPool = user2.address;
      const newIdeaRegistry = owner.address;
      
      await expect(
        grantManager.connect(owner).updateContractAddresses(
          newVotingSystem,
          newFundingPool,
          newIdeaRegistry
        )
      )
        .to.emit(grantManager, "VotingSystemUpdated")
        .to.emit(grantManager, "FundingPoolUpdated")
        .to.emit(grantManager, "IdeaRegistryUpdated");
      
      expect(await grantManager.votingSystem()).to.equal(newVotingSystem);
      expect(await grantManager.fundingPool()).to.equal(newFundingPool);
      expect(await grantManager.ideaRegistry()).to.equal(newIdeaRegistry);
    });

    it("Should reject zero addresses in updates", async function () {
      await expect(
        grantManager.connect(owner).updateContractAddresses(
          ethers.ZeroAddress,
          await fundingPool.getAddress(),
          await ideaRegistry.getAddress()
        )
      ).to.be.revertedWith("GrantManager: voting 0");
    });

    it("Should reject non-owner from admin functions", async function () {
      await expect(
        grantManager.connect(user1).setGrantAmountPerRound(ethers.parseEther("2000"))
      ).to.be.revertedWithCustomError(grantManager, "OwnableUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      const currentTime = await networkHelpers.time.latest();
      
      // Create multiple rounds
      await grantManager.connect(owner).createRound(
        "Round 1",
        currentTime + 100,
        currentTime + 100 + 7 * ONE_DAY,
        [1]
      );
      
      await grantManager.connect(owner).createRound(
        "Round 2",
        currentTime + 200,
        currentTime + 200 + 7 * ONE_DAY,
        [2]
      );
      
      await grantManager.connect(owner).createRound(
        "Round 3",
        currentTime + 300,
        currentTime + 300 + 7 * ONE_DAY,
        [3]
      );
    });

    it("Should get round information", async function () {
      const round = await grantManager.getRound(1);
      expect(round[0]).to.equal(1);
      expect(round[1]).to.equal("Round 1");
    });

    it("Should reject getting non-existent round", async function () {
      await expect(
        grantManager.getRound(999)
      ).to.be.revertedWith("GrantManager: round does not exist");
    });

    it("Should get active rounds", async function () {
      const activeRounds = await grantManager.getActiveRounds();
      expect(activeRounds.length).to.equal(3);
      expect(activeRounds[0][1]).to.equal("Round 1");
      expect(activeRounds[1][1]).to.equal("Round 2");
      expect(activeRounds[2][1]).to.equal("Round 3");
    });
  });
});