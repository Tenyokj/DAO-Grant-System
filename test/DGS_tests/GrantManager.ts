import { expect, hre, type HardhatEthers, type NetworkHelpers } from "../setup.js";

describe("GrantManager test", async function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;

  before(async () => {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);
  });

  // -------------------- FIXTURE --------------------
  async function deployFixture() {
    const [owner, addr1, addr2] = await ethers.getSigners();

    const mockVoting = await ethers.deployContract("MockVotingSystem", []);
    const mockPool = await ethers.deployContract("MockFundingPool", []);

    const ideaRegistry = await ethers.deployContract("IdeaRegistry", []);

    const gm = await ethers.deployContract("GrantManager", [
      await mockVoting.getAddress(),
      await mockPool.getAddress(),
      await ideaRegistry.getAddress(),
    ]);

    return {
      owner,
      addr1,
      addr2,
      gm,
      mockVoting,
      mockPool,
      ideaRegistry,
    };
  }

 // -------------------- ROUND CREATION --------------------
describe("Round creation", function () {
  it("should allow owner to create a round and emit event", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm, owner } = await deployFixture();

    await expect(gm.createRound("Round 1", now, now + 3600))
      .to.emit(gm, "RoundCreated")
      .withArgs(1, "Round 1");

    const round = await gm.rounds(1);
    expect(round.name).to.equal("Round 1");
    expect(round.finalized).to.equal(false);
  });

  it("should revert for invalid time range", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm } = await deployFixture();

    await expect(gm.createRound("Bad Round", now, now - 10))
      .to.be.revertedWith("GrantManager: invalid time range");
  });

  it("should revert for non-owner", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm, addr1 } = await deployFixture();

    await expect(gm.connect(addr1).createRound("Round 1", now, now + 3600))
      .to.be.revertedWithCustomError(gm, "OwnableUnauthorizedAccount")
      .withArgs(addr1);
  });
});

// -------------------- ROUND FINALIZATION --------------------
describe("Round finalization", function () {
  it("should finalize a round, trigger funding, and emit event", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm, mockVoting, mockPool } = await deployFixture();

    await gm.createRound("Round 1", now - 7200, now - 3600);
    await mockVoting.setWinningIdea(1, 42);

    await expect(gm.finalizeRound(1))
      .to.emit(gm, "RoundFinalized")
      .withArgs(1, 42);

    const round = await gm.rounds(1);
    expect(round.finalized).to.equal(true);
    expect(round.distributedAt).to.be.gt(0);

    expect(await mockPool.lastRoundId()).to.equal(1);
  });

  it("should revert if round does not exist", async function () {
    const { gm } = await deployFixture();

    await expect(gm.finalizeRound(0)).to.be.revertedWith("GrantManager: round does not exist");
    await expect(gm.finalizeRound(999)).to.be.revertedWith("GrantManager: round does not exist");
  });

  it("should revert if round already finalized", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm, mockVoting } = await deployFixture();

    await gm.createRound("Round 1", now - 7200, now - 3600);
    await mockVoting.setWinningIdea(1, 42);
    await gm.finalizeRound(1);

    await expect(gm.finalizeRound(1)).to.be.revertedWith("GrantManager: already finalized");
  });

  it("should revert if voting not ended", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm } = await deployFixture();

    await gm.createRound("Round 1", now, now + 3600);
    await expect(gm.finalizeRound(1)).to.be.revertedWith("GrantManager: voting not ended");
  });

  it("should revert if no winner", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm, mockVoting } = await deployFixture();

    await gm.createRound("Round 1", now - 7200, now - 3600);
    await mockVoting.setWinningIdea(1, 0);

    await expect(gm.finalizeRound(1)).to.be.revertedWith("GrantManager: no winner");
  });

  it("should revert for non-owner", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm, addr1 } = await deployFixture();

    await gm.createRound("Round 1", now - 7200, now - 3600);
    await expect(gm.connect(addr1).finalizeRound(1))
      .to.be.revertedWithCustomError(gm, "OwnableUnauthorizedAccount")
      .withArgs(addr1);

  });
});

// -------------------- UPDATE CONTRACTS --------------------
describe("Update contract addresses", function () {
  it("owner can update all contracts and emit events", async function () {
    const { gm, owner, addr1, addr2 } = await deployFixture();

    await expect(gm.updateContractAddresses(addr1.address, addr2.address, owner.address))
      .to.emit(gm, "VotingSystemUpdated").withArgs(addr1.address)
      .to.emit(gm, "FundingPoolUpdated").withArgs(addr2.address)
      .to.emit(gm, "IdeaRegistryUpdated").withArgs(owner.address);
  });

  it("should revert if any address is zero", async function () {
    const { gm, addr1, addr2, owner } = await deployFixture();
    const zero = ethers.ZeroAddress;

    await expect(gm.updateContractAddresses(zero, addr2.address, owner.address))
      .to.be.revertedWith("GrantManager: voting 0");

    await expect(gm.updateContractAddresses(addr1.address, zero, owner.address))
      .to.be.revertedWith("GrantManager: funding 0");

    await expect(gm.updateContractAddresses(addr1.address, addr2.address, zero))
      .to.be.revertedWith("GrantManager: ideaRegistry 0");
  });

  it("should revert for non-owner", async function () {
    const { gm, addr1, addr2, owner } = await deployFixture();

    await expect(gm.connect(addr1).updateContractAddresses(addr1.address, addr2.address, owner.address))
      .to.be.revertedWithCustomError(gm, "OwnableUnauthorizedAccount")
      .withArgs(addr1);
  });
});

// -------------------- VIEW FUNCTIONS --------------------
describe("View functions", function () {
  it("should return correct round by id", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm } = await deployFixture();

    await gm.createRound("Round 1", now, now + 3600);
    const round = await gm.getRound(1);

    expect(round.name).to.equal("Round 1");
    expect(round.finalized).to.equal(false);
  });

  it("should revert if round does not exist in getRound", async function () {
    const { gm } = await deployFixture();

    await expect(gm.getRound(0)).to.be.revertedWith("GrantManager: round does not exist");
    await expect(gm.getRound(999)).to.be.revertedWith("GrantManager: round does not exist");
  });

  it("should return active rounds only", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm, mockVoting } = await deployFixture();

    await gm.createRound("Round 1", now - 7200, now - 3600);
    await gm.createRound("Round 2", now - 7200, now - 3600);
    await mockVoting.setWinningIdea(1, 42);

    await gm.finalizeRound(1);

    const active = await gm.getActiveRounds();
    expect(active.length).to.equal(1);
    expect(active[0].id).to.equal(2);
  });
});

// -------------------- INTEGRATION --------------------
describe("Integration tests", function () {
  it("full flow: create round -> finalize -> fundingPool.distributeFunds called", async function () {
    const now = Math.floor(Date.now() / 1000);
    const { gm, mockVoting, mockPool } = await deployFixture();

    await gm.createRound("Round 1", now - 7200, now - 3600);
    await mockVoting.setWinningIdea(1, 42);

    await gm.finalizeRound(1);
    expect(await mockPool.lastRoundId()).to.equal(1);
  });
});

});
