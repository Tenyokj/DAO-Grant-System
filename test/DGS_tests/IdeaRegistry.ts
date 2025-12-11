import {
  expect,
  hre,
  type HardhatEthers,
  type NetworkHelpers,
} from "../setup.js";

describe("IdeaRegistry test", async function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;

  before(async () => {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);
  });

  const DECIMALS = 10n ** 18n;
  const MINSTAKE = 500n * DECIMALS;

  async function createIdea(ideaContract: any, signer: any) {
    const tx = await ideaContract
      .connect(signer)
      .createIdea("Name", "Description", "https://example.com")

    await tx.wait();

    const total = await ideaContract.totalIdeas();
    const ideaId = total - 1n; // always BigInt

    return ideaId;
  }

  async function deploy() {
    const [owner, alice, bob, stranger] = await ethers.getSigners();

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

    return { idea, owner, alice, bob, stranger, voting, pool, manager, token };
  }

  it("emits IdeaCreated", async function () {
    const {idea, alice} = await deploy();

    await expect(
        idea.connect(alice).createIdea("Name", "Description", "https://example.com")
    )
    .to.emit(idea, "IdeaCreated")
    .withArgs(
        0n,                 // if it's the firts idea
        alice.address,
        "Name",
    );
  });


  it("creates idea successfully", async function () {
    const { idea, alice, owner } = await deploy();

    const ideaId = await createIdea(idea, alice);
    const meta = await idea.getIdea(ideaId);

    expect(meta.id).to.equal(ideaId);
    expect(meta.author).to.equal(alice.address);
    expect(meta.title).to.equal("Name");
    expect(meta.description).to.equal("Description");
    expect(meta.link).to.equal("https://example.com");
    expect(meta.createdAt).to.be.gt(0n);
    expect(meta.totalVotes).to.equal(0n);
    expect(meta.status).to.equal(0); // Pending

    await expect(idea.connect(owner).addVote(ideaId, 1))
      .to.emit(idea, "IdeaVoted")
      .withArgs(ideaId, owner, 1);

    const metaAfter = await idea.getIdea(ideaId);
    expect(metaAfter.totalVotes).to.equal(1n);

    const ideasByAlice = await idea.getIdeasByAuthor(alice.address);
    expect(ideasByAlice).to.contain(ideaId);
  });

  it("reverts when title or description is empty", async function () {
    const { idea, alice } = await deploy();

    await expect(
      idea.connect(alice).createIdea("", "Description", "https://example.com")
    ).to.be.revertedWith("Title required");

    await expect(
      idea.connect(alice).createIdea("Name", "", "https://example.com")
    ).to.be.revertedWith("Description required");
  });

  it("allows owner to update status and emits IdeaStatusUpdated", async function () {
    const { idea, owner } = await deploy();
    const ideaId = await createIdea(idea, owner);

    await expect(idea.connect(owner).updateStatus(ideaId, 2))
      .to.emit(idea, "IdeaStatusUpdated")
      .withArgs(ideaId, 2);

    const meta = await idea.getIdea(ideaId);
    expect(meta.status).to.equal(2); // Funded
  });

  it("reverts for non-owner", async function () {
    const { idea, alice } = await deploy();
    const ideaId = await createIdea(idea, alice);

    await expect(idea.connect(alice).updateStatus(ideaId, 2)).to.be.revertedWith(
      "IdeaRegistry: not authorized"
    );
  });

  it("authorizes updaters correctly", async function () {
    const { idea, owner, alice } = await deploy();
    const ideaId = await createIdea(idea, alice);

    await idea.connect(owner).authorizeUpdater(alice, true);

    await expect(idea.connect(alice).updateStatus(ideaId, 2))
      .to.emit(idea, "IdeaStatusUpdated")
      .withArgs(ideaId, 2);

    const meta = await idea.getIdea(ideaId);
    expect(meta.status).to.equal(2);
  });

  it("reverts for invalid status or non-existent idea", async function () {
    const { idea, owner } = await deploy();
    const ideaId = await createIdea(idea, owner);

    await expect(idea.connect(owner).updateStatus(3, 1)).to.be.revertedWith(
      "Idea does not exist"
    );

    await expect(idea.connect(owner).updateStatus(ideaId, 12)).to.be.revertedWith(
      "Invalid status"
    );
  });

  it("integration: VotingSystem as owner can call updateStatus", async function () {
    const { voting, owner, idea } = await deploy();

    const ideaId = await createIdea(idea, owner);

    await idea.connect(owner).authorizeUpdater(voting.target, true);

    await expect(voting.updateIdeaStatus(ideaId, 2))
      .to.emit(idea, "IdeaStatusUpdated")
      .withArgs(ideaId, 2);

    const meta = await idea.getIdea(ideaId);
    expect(meta.status).to.equal(2); 
  });

  it("allows owner to add votes and emits IdeaVoted", async function () {
    const { idea, owner } = await deploy();
    const ideaId = await createIdea(idea, owner);

    await expect(idea.connect(owner).addVote(ideaId, 5))
      .to.emit(idea, "IdeaVoted")
      .withArgs(ideaId, owner, 5);

    const meta = await idea.getIdea(ideaId);
    expect(meta.totalVotes).to.equal(5n);
  });

  it("reverts for non-owner (addVote)", async function () {
    const { idea, alice } = await deploy();
    const ideaId = await createIdea(idea, alice);

    await expect(idea.connect(alice).addVote(ideaId, 1))
      .to.be.revertedWithCustomError(idea, "OwnableUnauthorizedAccount")
      .withArgs(alice);
  });

  it("getIdeasByAuthor returns author ideas array", async function () {
    const { idea, alice } = await deploy();
    const ideaId1 = await createIdea(idea, alice);
    const ideaId2 = await createIdea(idea, alice);

    const ideasByAlice: bigint[] = await idea.getIdeasByAuthor(alice.address);
    expect(ideasByAlice).to.deep.equal([ideaId1, ideaId2]);
  });

  it("getIdea returns Idea struct and totalIdeas works", async function () {
    const { idea, alice } = await deploy();

    const before = await idea.totalIdeas();
    const ideaId = await createIdea(idea, alice);
    const after = await idea.totalIdeas();

    expect(after).to.equal(before + 1n);

    const meta = await idea.getIdea(ideaId);
    expect(meta.id).to.equal(ideaId);
    expect(meta.author).to.equal(alice.address);
    expect(meta.title).to.equal("Name");
    expect(meta.description).to.equal("Description");
    expect(meta.link).to.equal("https://example.com");
    expect(meta.createdAt).to.be.gt(0n);
    expect(meta.totalVotes).to.equal(0n);
    expect(meta.status).to.equal(0); // Pending
  });
});
