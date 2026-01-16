import {
  expect,
  hre,
  type HardhatEthers,
  type NetworkHelpers,
} from "../setup.js";

describe("VotingSystem", function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;
  let votingSystem: any;
  let token: any;
  let owner: any;
  let user1: any;
  let user2: any;
  let user3: any;
  let grantManager: any;
  
  let MIN_STAKE: bigint; // 500 tokens
  const VOTING_DURATION = 3 * 24 * 60 * 60; // 3 days

  beforeEach(async function () {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);

    MIN_STAKE = ethers.parseEther("500");

    const signers = await ethers.getSigners();
    [owner, user1, user2, user3, grantManager] = signers;
    
    // Deploy token
    token = await ethers.deployContract("GovernanceToken", [
      grantManager.address,
      ethers.parseEther("1000000")
    ]);
    
    // Deploy voting system
    votingSystem = await ethers.deployContract("VotingSystem", [
      await token.getAddress()
    ]);
    
    // Set grant manager
    await votingSystem.connect(owner).setGrantManager(grantManager.address);
    
    // Mint tokens for testing
    const mintAmount = ethers.parseEther("10000");
    await token.connect(grantManager).mint(user1.address, mintAmount);
    await token.connect(grantManager).mint(user2.address, mintAmount);
    await token.connect(grantManager).mint(user3.address, mintAmount);
    
    // Approve voting system
    await token.connect(user1).approve(await votingSystem.getAddress(), mintAmount);
    await token.connect(user2).approve(await votingSystem.getAddress(), mintAmount);
    await token.connect(user3).approve(await votingSystem.getAddress(), mintAmount);
  });

  describe("Deployment", function () {
    it("Should set correct parameters", async function () {
      expect(await votingSystem.minStake()).to.equal(MIN_STAKE);
      expect(await votingSystem.votingDuration()).to.equal(VOTING_DURATION);
      expect(await votingSystem.grantManager()).to.equal(grantManager.address);
    });

    it("Should set correct governance token", async function () {
      expect(await votingSystem.governanceToken()).to.equal(await token.getAddress());
    });
  });

  describe("Starting Voting Round", function () {
    it("Should start voting round via grant manager", async function () {
      const ideaIds = [1, 2, 3];
      
      await expect(
        votingSystem.connect(grantManager).startVotingRound(1, ideaIds)
      )
        .to.emit(votingSystem, "VotingRoundStarted");
      
      const roundInfo = await votingSystem.getRoundInfo(1);
      
      expect(roundInfo[0]).to.equal(1); // roundId
      expect(roundInfo[1]).to.deep.equal(ideaIds); // ideaIds
      expect(roundInfo[4]).to.equal(true); // active
      expect(roundInfo[5]).to.equal(false); // ended
    });

    it("Should reject starting round without ideas", async function () {
      await expect(
        votingSystem.connect(grantManager).startVotingRound(1, [])
      ).to.be.revertedWith("no ideaIds");
    });

    it("Should reject duplicate idea in round", async function () {
      const ideaIds = [1, 1, 2]; // Duplicate idea 1
      
      await expect(
        votingSystem.connect(grantManager).startVotingRound(1, ideaIds)
      ).to.be.revertedWith("duplicate idea");
    });

    it("Should reject zero ideaId", async function () {
      const ideaIds = [1, 0, 2]; // Zero ideaId
      
      await expect(
        votingSystem.connect(grantManager).startVotingRound(1, ideaIds)
      ).to.be.revertedWith("ideaId 0");
    });

    it("Should reject duplicate round ID", async function () {
      const ideaIds = [1, 2];
      
      await votingSystem.connect(grantManager).startVotingRound(1, ideaIds);
      
      await expect(
        votingSystem.connect(grantManager).startVotingRound(1, ideaIds)
      ).to.be.revertedWith("round already exists");
    });

    it("Should reject non-grant-manager from starting round", async function () {
      await expect(
        votingSystem.connect(owner).startVotingRound(1, [1, 2])
      ).to.be.revertedWith("VotingSystem: caller is not GrantManager");
    });
  });

  describe("Voting", function () {
    beforeEach(async function () {
      const ideaIds = [1, 2];
      await votingSystem.connect(grantManager).startVotingRound(1, ideaIds);
    });

    it("Should allow voting for idea in round", async function () {
      const voteAmount = ethers.parseEther("1000");
      
      await expect(
        votingSystem.connect(user1).vote(1, 1, voteAmount)
      )
        .to.emit(votingSystem, "VoteCast")
        .withArgs(user1.address, 1, 1, voteAmount);
      
      const votes = await votingSystem.getVotesForIdea(1, 1);
      expect(votes).to.equal(voteAmount);
      
      const roundInfo = await votingSystem.getRoundInfo(1);
      expect(roundInfo[6]).to.equal(voteAmount); // totalVotes
    });

    it("Should accumulate votes for same idea", async function () {
      const vote1 = ethers.parseEther("600");
      const vote2 = ethers.parseEther("500");
      
      await votingSystem.connect(user1).vote(1, 1, vote1);
      await votingSystem.connect(user2).vote(1, 1, vote2);
      
      const votes = await votingSystem.getVotesForIdea(1, 1);
      expect(votes).to.equal(vote1 + vote2);
      
      const roundInfo = await votingSystem.getRoundInfo(1);
      expect(roundInfo[6]).to.equal(vote1 + vote2); // totalVotes
    });

    it("Should reject voting below minimum stake", async function () {
      const smallAmount = ethers.parseEther("100");
      
      await expect(
        votingSystem.connect(user1).vote(1, 1, smallAmount)
      ).to.be.revertedWith("amount < minStake");
    });

    it("Should reject double voting by same user", async function () {
      const voteAmount = ethers.parseEther("600");
      
      await votingSystem.connect(user1).vote(1, 1, voteAmount);
      
      await expect(
        votingSystem.connect(user1).vote(1, 1, voteAmount)
      ).to.be.revertedWith("already voted");
    });

    it("Should reject voting for non-existent idea in round", async function () {
      const voteAmount = ethers.parseEther("600");
      
      await expect(
        votingSystem.connect(user1).vote(1, 3, voteAmount) // Idea 3 not in round
      ).to.be.revertedWith("idea not in round");
    });

    it("Should reject voting after round ends", async function () {
      const voteAmount = ethers.parseEther("600");
      
      // Fast forward past voting duration
      await networkHelpers.time.increase(VOTING_DURATION + 1);
      
      await expect(
        votingSystem.connect(user1).vote(1, 1, voteAmount)
      ).to.be.revertedWith("not in window");
    });

    it("Should handle multiple ideas voting", async function () {
      const vote1 = ethers.parseEther("600");
      const vote2 = ethers.parseEther("500");
      
      await votingSystem.connect(user1).vote(1, 1, vote1);
      await votingSystem.connect(user2).vote(1, 2, vote2);
      
      const votes1 = await votingSystem.getVotesForIdea(1, 1);
      const votes2 = await votingSystem.getVotesForIdea(1, 2);
      
      expect(votes1).to.equal(vote1);
      expect(votes2).to.equal(vote2);
      
      const roundInfo = await votingSystem.getRoundInfo(1);
      expect(roundInfo[6]).to.equal(vote1 + vote2); // totalVotes
    });
  });

  describe("Ending Voting Round", function () {
    beforeEach(async function () {
      const ideaIds = [1, 2];
      await votingSystem.connect(grantManager).startVotingRound(1, ideaIds);
      
      // Users vote
      await votingSystem.connect(user1).vote(1, 1, ethers.parseEther("700"));
      await votingSystem.connect(user2).vote(1, 2, ethers.parseEther("500"));
    });

    it("Should end voting round via grant manager", async function () {
      await networkHelpers.time.increase(VOTING_DURATION + 1);
      
      await expect(
        votingSystem.connect(grantManager).endVotingRound(1)
      )
        .to.emit(votingSystem, "VotingRoundEnded")
        .withArgs(1, 1, ethers.parseEther("700"));
      
      const roundInfo = await votingSystem.getRoundInfo(1);
      
      expect(roundInfo[4]).to.equal(false); // active = false
      expect(roundInfo[5]).to.equal(true); // ended = true
      expect(roundInfo[7]).to.equal(1); // winningIdeaId = 1
      expect(roundInfo[8]).to.equal(ethers.parseEther("700")); // winningVotes
    });

    it("Should return winning idea ID", async function () {
      await networkHelpers.time.increase(VOTING_DURATION + 1);
      
      await expect(
        votingSystem.connect(grantManager).endVotingRound(1)
      ).to.emit(votingSystem, "VotingRoundEnded")
      .withArgs(1, 1, ethers.parseEther("700"));
    });

    it("Should handle tie (first idea wins)", async function () {
      // Create new round with tie
      await votingSystem.connect(grantManager).startVotingRound(2, [3, 4]);
      
      await votingSystem.connect(user1).vote(2, 3, ethers.parseEther("500"));
      await votingSystem.connect(user2).vote(2, 4, ethers.parseEther("500"));
      
      await networkHelpers.time.increase(VOTING_DURATION + 1);
      
      await expect(
        votingSystem.connect(grantManager).endVotingRound(2)
      ).to.emit(votingSystem, "VotingRoundEnded")
        .withArgs(2, 3, ethers.parseEther("500"));  // First idea wins in tie
    });

    it("Should handle no votes (winner = 0)", async function () {
      // Create new round with no votes
      await votingSystem.connect(grantManager).startVotingRound(3, [5]);
      
      await networkHelpers.time.increase(VOTING_DURATION + 1);
      
      await expect(
        votingSystem.connect(grantManager).endVotingRound(3)
      ).to.emit(votingSystem, "VotingRoundEnded")
       .withArgs(3, 0, 0);  // No winner
    });

    it("Should reject ending before voting period", async function () {
      await expect(
        votingSystem.connect(grantManager).endVotingRound(1)
      ).to.be.revertedWith("round not finished");
    });

    it("Should reject ending inactive round", async function () {
      await networkHelpers.time.increase(VOTING_DURATION + 1);
      await votingSystem.connect(grantManager).endVotingRound(1);
      
      await expect(
        votingSystem.connect(grantManager).endVotingRound(1)
      ).to.be.revertedWith("round already ended");
    });

    it("Should reject non-grant-manager from ending round", async function () {
      await networkHelpers.time.increase(VOTING_DURATION + 1);
      
      await expect(
        votingSystem.connect(owner).endVotingRound(1)
      ).to.be.revertedWith("VotingSystem: caller is not GrantManager");
    });

    it("Should reject ending non-existent round", async function () {
      await expect(
        votingSystem.connect(grantManager).endVotingRound(999)
      ).to.be.revertedWith("round not exist");
    });
  });

  describe("Getting Results", function () {
    beforeEach(async function () {
      const ideaIds = [1, 2];
      await votingSystem.connect(grantManager).startVotingRound(1, ideaIds);
      
      await votingSystem.connect(user1).vote(1, 1, ethers.parseEther("800"));
      await votingSystem.connect(user2).vote(1, 2, ethers.parseEther("500"));
      
      await networkHelpers.time.increase(VOTING_DURATION + 1);
      await votingSystem.connect(grantManager).endVotingRound(1);
    });

    it("Should get round results", async function () {
      const [winningId, totalVotes] = await votingSystem.getRoundResults(1);
      
      expect(winningId).to.equal(1);
      expect(totalVotes).to.equal(ethers.parseEther("1300"));
    });

    it("Should reject getting results before round ends", async function () {
      // Create new round
      await votingSystem.connect(grantManager).startVotingRound(2, [3]);
      
      await expect(
        votingSystem.getRoundResults(2)
      ).to.be.revertedWith("voting not ended");
    });
  });

  describe("Admin Functions", function () {
    it("Should set voting duration", async function () {
      const newDuration = 7 * 24 * 60 * 60; // 7 days
      await votingSystem.connect(owner).setVotingDuration(newDuration);
      
      expect(await votingSystem.votingDuration()).to.equal(newDuration);
    });

    it("Should set minimum stake", async function () {
      const newMinStake = ethers.parseEther("1000");
      await votingSystem.connect(owner).setMinStake(newMinStake);
      
      expect(await votingSystem.minStake()).to.equal(newMinStake);
    });

    it("Should set governance token", async function () {
      const newToken = user1.address; // Mock address
      await votingSystem.connect(owner).setGovernanceToken(newToken);
      
      expect(await votingSystem.governanceToken()).to.equal(newToken);
    });

    it("Should set grant manager", async function () {
      const newManager = user1.address;
      await votingSystem.connect(owner).setGrantManager(newManager);
      
      expect(await votingSystem.grantManager()).to.equal(newManager);
    });

    it("Should withdraw tokens (owner only)", async function () {
      // Create round and vote to have tokens in contract
      const ideaIds = [1];
      await votingSystem.connect(grantManager).startVotingRound(1, ideaIds);
      
      const voteAmount = ethers.parseEther("1000");
      await votingSystem.connect(user1).vote(1, 1, voteAmount);
      
      // Check contract balance
      const contractBalance = await token.balanceOf(await votingSystem.getAddress());
      expect(contractBalance).to.equal(voteAmount);
      
      // Owner withdraws
      const withdrawAmount = ethers.parseEther("500");
      await votingSystem.connect(owner).withdrawTokens(
        await token.getAddress(),
        owner.address,
        withdrawAmount
      );
      
      // Check new balance
      const newContractBalance = await token.balanceOf(await votingSystem.getAddress());
      expect(newContractBalance).to.equal(voteAmount - withdrawAmount);
    });

    it("Should reject non-owner from admin functions", async function () {
      await expect(
        votingSystem.connect(user1).setVotingDuration(1000)
      ).to.be.revertedWithCustomError(votingSystem, "OwnableUnauthorizedAccount");
      
      await expect(
        votingSystem.connect(user1).setGrantManager(user2.address)
      ).to.be.revertedWithCustomError(votingSystem, "OwnableUnauthorizedAccount");
    });
  });
});