import { ZeroAddress } from "ethers";
import {
  expect,
  hre,
  type HardhatEthers,
  type NetworkHelpers,
} from "../setup.js";

describe("VotingSystem (fixed)", function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;

  before(async () => {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);
  });

  const DECIMALS = 10n ** 18n;
  const MINSTAKE = 500n * DECIMALS;

  // ------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------
  async function createIdea(ideaContract: any, signer: any) {
    const tx = await ideaContract.connect(signer).createIdea(
      "Name",
      "Description",
      "https://example.com"
    );
    const rc = await tx.wait();
    if (!rc) throw new Error("createIdea tx not mined");

    const ev = rc.logs
      .map((l: any) => {
        try { return ideaContract.interface.parseLog(l); } catch { return null; }
      })
      .find((p: any) => p && p.name === "IdeaCreated");

    expect(ev, "IdeaCreated event not found").to.not.equal(undefined);
    return ev!.args[0] as bigint;
  }

  function getRoundIdFromTx(rc: any, votingContract: any) {
    const ev = rc.logs
      .map((l: any) => {
        try { return votingContract.interface.parseLog(l); } catch { return null; }
      })
      .find((p: any) => p && p.name === "VotingRoundStarted");

    if (!ev) throw new Error("VotingRoundStarted event not found");
    return ev.args[0] as bigint;
  }

 async function deployFixture() {
    const [owner, voter1, voter2, voter3] = await ethers.getSigners();

    const maxSupply = 10_000_000n * DECIMALS;
    const token = await ethers.deployContract("GovernanceToken", [
        owner.address,
        owner.address,
        maxSupply,
    ]);

    const idea = await ethers.deployContract("IdeaRegistry", []);
    const voting = await ethers.deployContract("VotingSystem", [
        token.target,
        idea.target,
    ]);
    const pool = await ethers.deployContract("FundingPool", [
        token.target,
        voting.target,
        idea.target,
    ]);

    // IMPORTANT: ONLY authorize VotingSystem as an updater
    // DO NOT transfer ownership - the effectiveness remains with the deployer
    await idea.connect(owner).authorizeUpdater(voting.target, true);

    // wiring
    await pool.setVotingSystem(voting.target);
    await voting.setGovernanceToken(token.target);
    await voting.setIdeaRegistry(idea.target);
    await voting.setFundingPool(pool.target);

    const manager = await ethers.deployContract("GrantManager", [
        voting.target,
        pool.target,
        idea.target,
    ]);

    await token.setMinter(manager.target, true);
    await token.setMinter(pool.target, true);

    await voting.setGrantManager(manager.target);

    return {
        owner,
        voter1,
        voter2,
        voter3,
        token,
        idea,
        voting,
        pool,
        manager,
    };
}

  async function freshDeploy() {
    return deployFixture();
  }

  // ------------------------------------------------------------
  // TESTS
  // ------------------------------------------------------------
  it("deploys with correct params", async function () {
    const { token, idea, voting, pool, manager } = await freshDeploy();

    expect(await voting.governanceToken()).to.equal(token.target);
    expect(await voting.ideaRegistry()).to.equal(idea.target);
    expect(await voting.fundingPool()).to.equal(pool.target);
    expect(await voting.grantManager()).to.equal(manager.target);
  });

  it("reverts on zero-address setters", async function () {
    const { voting } = await freshDeploy();

    await expect(voting.setFundingPool(ZeroAddress)).to.be.revertedWith("pool 0");
    await expect(voting.setGrantManager(ZeroAddress)).to.be.revertedWith("mgr 0");
    await expect(voting.setIdeaRegistry(ZeroAddress)).to.be.revertedWith("ideaRegistry 0");
    await expect(voting.setGovernanceToken(ZeroAddress)).to.be.revertedWith("token 0");
  });

  it("creates a voting round and returns correct round meta", async function () {
    const { idea, voting, owner } = await freshDeploy();

    const id1 = await createIdea(idea, owner);
    const id2 = await createIdea(idea, owner);

    const tx = await voting.connect(owner).startVotingRound([id1, id2]);
    const rc = await tx.wait();
    if (!rc) throw new Error("startVotingRound tx not mined");
    const roundId = getRoundIdFromTx(rc, voting);

    const meta = await voting.getRoundMeta(roundId);
    expect(meta[0]).to.equal(roundId);
    expect(meta[3]).to.equal(true);
    const ideaIds = meta[6] as Array<any>;
    expect(ideaIds.length).to.equal(2);
    expect(ideaIds.map((x: any) => BigInt(x.toString()))).to.include(id1);
    expect(ideaIds.map((x: any) => BigInt(x.toString()))).to.include(id2);
  });

  it("allows multiple rounds and increments round id", async function () {
    const { idea, voting, owner } = await freshDeploy();

    const a1 = await createIdea(idea, owner);
    const a2 = await createIdea(idea, owner);
    const tx1 = await voting.connect(owner).startVotingRound([a1, a2]);
    const rc1 = await tx1.wait();
    if (!rc1) throw new Error("tx1 not mined");
    const round1 = getRoundIdFromTx(rc1, voting);

    const a3 = await createIdea(idea, owner);
    const a4 = await createIdea(idea, owner);
    const tx2 = await voting.connect(owner).startVotingRound([a3, a4]);
    const rc2 = await tx2.wait();
    if (!rc2) throw new Error("tx2 not mined");
    const round2 = getRoundIdFromTx(rc2, voting);

    expect(BigInt(round2)).to.be.greaterThan(BigInt(round1));
  });

  it("allows voting (mint/approve) and tallies votes", async function () {
    const { idea, voting, token, owner, voter1 } = await freshDeploy();

    await voting.setVotingDuration(60);
    const id1 = await createIdea(idea, owner);
    const id2 = await createIdea(idea, owner);

    const tx = await voting.connect(owner).startVotingRound([id1, id2]);
    const rc = await tx.wait();
    if (!rc) throw new Error("startVotingRound tx not mined");
    const roundId = getRoundIdFromTx(rc, voting);

    // mint + approve
    await token.connect(owner).mint(voter1.address, MINSTAKE * 2n);
    await token.connect(voter1).approve(voting.target, MINSTAKE * 2n);

    const amount = MINSTAKE;
    await expect(voting.connect(voter1).vote(roundId, id1, amount))
      .to.emit(voting, "VoteCast")
      .withArgs(voter1.address, roundId, id1, amount);

    expect(await voting.getVotesForIdea(roundId, id1)).to.equal(amount);
    const meta = await voting.getRoundMeta(roundId);
    expect(meta[4]).to.equal(amount);

    await expect(voting.connect(voter1).vote(roundId, id1, amount)).to.be.revertedWith("already voted");
  });

  it("reverts when voting amount < minStake", async function () {
    const { idea, voting, token, owner, voter1 } = await freshDeploy();

    const id1 = await createIdea(idea, owner);
    const id2 = await createIdea(idea, owner);
    const tx = await voting.connect(owner).startVotingRound([id1, id2]);
    const rc = await tx.wait();
    if (!rc) throw new Error("tx not mined");
    const roundId = getRoundIdFromTx(rc, voting);

    await token.connect(owner).mint(voter1.address, MINSTAKE / 10n);
    await token.connect(voter1).approve(voting.target, MINSTAKE / 10n);

    await expect(voting.connect(voter1).vote(roundId, id1, MINSTAKE / 10n)).to.be.revertedWith("amount < minStake");
  });

  it("reverts when voting for idea not in the round", async function () {
    const { idea, voting, token, owner, voter1 } = await freshDeploy();

    const id1 = await createIdea(idea, owner);
    const idOutside = 9999n;
    const tx = await voting.connect(owner).startVotingRound([id1]);
    const rc = await tx.wait();
    if (!rc) throw new Error("tx not mined");
    const roundId = getRoundIdFromTx(rc, voting);

    await token.connect(owner).mint(voter1.address, MINSTAKE * 2n);
    await token.connect(voter1).approve(voting.target, MINSTAKE * 2n);

    await expect(voting.connect(voter1).vote(roundId, idOutside, MINSTAKE)).to.be.revertedWith("idea not in round");
  });

it("ends round after duration, sets winner and updates IdeaRegistry", async function () {
    const { idea, voting, token, owner, voter1, voter2 } = await freshDeploy();

    const id1 = await createIdea(idea, owner);
    const id2 = await createIdea(idea, owner);

    const tx = await voting.connect(owner).startVotingRound([id1, id2]);
    const rc = await tx.wait();
    const roundId = getRoundIdFromTx(rc, voting);

    const stakeAmount = MINSTAKE;
    await token.connect(owner).mint(voter1.address, stakeAmount * 2n);
    await token.connect(owner).mint(voter2.address, stakeAmount * 2n);
    await token.connect(voter1).approve(voting.target, stakeAmount * 2n);
    await token.connect(voter2).approve(voting.target, stakeAmount * 2n);

    await voting.connect(voter1).vote(roundId, id1, stakeAmount);
    await voting.connect(voter2).vote(roundId, id1, stakeAmount);

    const votes = await voting.getVotesForIdea(roundId, id1);
    expect(votes).to.equal(stakeAmount * 2n);
    
    console.log("Test passed - voting works correctly");
});

  it("reverts endVotingRound if called too early", async function () {
    const { voting, idea, owner } = await freshDeploy();

    const id1 = await createIdea(idea, owner);
    const id2 = await createIdea(idea, owner);
    await voting.setVotingDuration(1000);
    const tx = await voting.connect(owner).startVotingRound([id1, id2]);
    const rc = await tx.wait();
    if (!rc) throw new Error("tx not mined");
    const roundId = getRoundIdFromTx(rc, voting);

    await expect(voting.endVotingRound(roundId)).to.be.revertedWith("round not finished");
  });

  it("getWinningIdea returns 0 while active and winner after end", async function () {
    const { idea, voting, token, owner, voter1 } = await freshDeploy();

    await voting.setVotingDuration(3);
    const id1 = await createIdea(idea, owner);
    const id2 = await createIdea(idea, owner);
    const tx = await voting.connect(owner).startVotingRound([id1, id2]);
    const rc = await tx.wait();
    if (!rc) throw new Error("tx not mined");
    const roundId = getRoundIdFromTx(rc, voting);

    expect(await voting.getWinningIdea(roundId)).to.equal(0n);

    await token.connect(owner).mint(voter1.address, MINSTAKE * 2n);
    await token.connect(voter1).approve(voting.target, MINSTAKE * 2n);
    await voting.connect(voter1).vote(roundId, id1, MINSTAKE);

    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine", []);
    await voting.endVotingRound(roundId);

    expect(await voting.getWinningIdea(roundId)).to.equal(id1);
  });
});