import {
  expect,
  hre,
  type HardhatEthers,
  type NetworkHelpers,
} from "../setup.js";

describe("IdeaRegistry", function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;
  let registry: any;
  let owner: any;
  let user1: any;
  let user2: any;
  let updater: any;
  
  const TITLE = "Great Idea";
  const DESCRIPTION = "Detailed description of the idea";
  const LINK = "https://example.com/idea";

  beforeEach(async function () {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);

    const signers = await ethers.getSigners();
    [owner, user1, user2, updater] = signers;
    
    registry = await ethers.deployContract("IdeaRegistry", []);
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });
  });

  describe("Creating Ideas", function () {
    it("Should create a new idea", async function () {
      await expect(
        registry.connect(user1).createIdea(TITLE, DESCRIPTION, LINK)
      )
        .to.emit(registry, "IdeaCreated")
        .withArgs(1, user1.address, TITLE);
      
      const idea = await registry.getIdea(1);
      
      expect(idea[0]).to.equal(1); // id
      expect(idea[1]).to.equal(user1.address); // author
      expect(idea[2]).to.equal(TITLE); // title
      expect(idea[3]).to.equal(DESCRIPTION); // description
      expect(idea[4]).to.equal(LINK); // link
      expect(idea[7]).to.equal(0); // status = Pending
    });

    it("Should reject empty title", async function () {
      await expect(
        registry.connect(user1).createIdea("", DESCRIPTION, LINK)
      ).to.be.revertedWith("Title required");
    });

    it("Should reject empty description", async function () {
      await expect(
        registry.connect(user1).createIdea(TITLE, "", LINK)
      ).to.be.revertedWith("Description required");
    });

    it("Should track ideas by author", async function () {
      await registry.connect(user1).createIdea("Idea 1", "Desc 1", "");
      await registry.connect(user1).createIdea("Idea 2", "Desc 2", "");
      await registry.connect(user2).createIdea("Idea 3", "Desc 3", "");
      
      const user1Ideas = await registry.getIdeasByAuthor(user1.address);
      const user2Ideas = await registry.getIdeasByAuthor(user2.address);
      
      expect(user1Ideas.length).to.equal(2);
      expect(user2Ideas.length).to.equal(1);
      expect(user1Ideas[0]).to.equal(1);
      expect(user1Ideas[1]).to.equal(2);
      expect(user2Ideas[0]).to.equal(3);
    });

    it("Should increment idea counter", async function () {
      await registry.connect(user1).createIdea("Idea 1", "Desc 1", "");
      await registry.connect(user2).createIdea("Idea 2", "Desc 2", "");
      await registry.connect(user1).createIdea("Idea 3", "Desc 3", "");
      
      expect(await registry.totalIdeas()).to.equal(3);
    });
  });

  describe("Getting Idea Author", function () {
    beforeEach(async function () {
      await registry.connect(user1).createIdea(TITLE, DESCRIPTION, LINK);
    });

    it("Should return correct author", async function () {
      const author = await registry.getIdeaAuthor(1);
      expect(author).to.equal(user1.address);
    });

    it("Should revert for non-existent idea", async function () {
      await expect(
        registry.getIdeaAuthor(999)
      ).to.be.revertedWith("Idea does not exist");
    });
  });

  describe("Updating Status", function () {
    beforeEach(async function () {
      await registry.connect(user1).createIdea(TITLE, DESCRIPTION, LINK);
      await registry.connect(owner).authorizeUpdater(updater.address, true);
    });

    it("Should update status via authorized updater", async function () {
      await expect(
        registry.connect(updater).updateStatus(1, 1) // Status.Voting
      )
        .to.emit(registry, "IdeaStatusUpdated")
        .withArgs(1, 1);
      
      const idea = await registry.getIdea(1);
      expect(idea[7]).to.equal(1); // Status.Voting
    });

    it("Should update status via owner", async function () {
      await expect(
        registry.connect(owner).updateStatus(1, 2) // Status.WonVoting
      )
        .to.emit(registry, "IdeaStatusUpdated")
        .withArgs(1, 2);
      
      const idea = await registry.getIdea(1);
      expect(idea[7]).to.equal(2); // Status.WonVoting
    });

    it("Should reject unauthorized status update", async function () {
      await expect(
        registry.connect(user2).updateStatus(1, 1)
      ).to.be.revertedWith("IdeaRegistry: not authorized");
    });

    it("Should reject invalid status value", async function () {
      await expect(
        registry.connect(updater).updateStatus(1, 10) // Invalid status
      ).to.be.revertedWith("Invalid status");
    });

    it("Should reject update for non-existent idea", async function () {
      await expect(
        registry.connect(updater).updateStatus(999, 1)
      ).to.be.revertedWith("Idea does not exist");
    });

    it("Should handle all status transitions", async function () {
      const statuses = [0, 1, 2, 3, 4, 5]; // All valid statuses
      
      for (let i = 0; i < statuses.length; i++) {
        await registry.connect(updater).updateStatus(1, statuses[i]);
        const idea = await registry.getIdea(1);
        expect(idea[7]).to.equal(statuses[i]);
      }
    });
  });

  describe("Adding Votes", function () {
    beforeEach(async function () {
      await registry.connect(user1).createIdea(TITLE, DESCRIPTION, LINK);
    });

    it("Should add votes via owner", async function () {
      const voteAmount = 100n;
      
      await expect(
        registry.connect(owner).addVote(1, voteAmount)
      )
        .to.emit(registry, "IdeaVoted")
        .withArgs(1, owner.address, voteAmount);
      
      const idea = await registry.getIdea(1);
      expect(idea[6]).to.equal(voteAmount); // totalVotes
    });

    it("Should accumulate votes", async function () {
      await registry.connect(owner).addVote(1, 50n);
      await registry.connect(owner).addVote(1, 30n);
      await registry.connect(owner).addVote(1, 20n);
      
      const idea = await registry.getIdea(1);
      expect(idea[6]).to.equal(100n);
    });

    it("Should reject non-owner from adding votes", async function () {
      await expect(
        registry.connect(user1).addVote(1, 100)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("Should reject adding votes to non-existent idea", async function () {
      await expect(
        registry.connect(owner).addVote(999, 100)
      ).to.be.revertedWith("Idea does not exist");
    });
  });

  describe("Getting Idea Struct", function () {
    beforeEach(async function () {
      await registry.connect(user1).createIdea(TITLE, DESCRIPTION, LINK);
    });

    it("Should return complete idea struct", async function () {
      const ideaStruct = await registry.getIdeaStruct(1);
      
      expect(ideaStruct.id).to.equal(1);
      expect(ideaStruct.author).to.equal(user1.address);
      expect(ideaStruct.title).to.equal(TITLE);
      expect(ideaStruct.description).to.equal(DESCRIPTION);
      expect(ideaStruct.link).to.equal(LINK);
      expect(ideaStruct.status).to.equal(0); // Pending
    });
  });

  describe("Authorizing Updaters", function () {
    it("Should authorize updater", async function () {
      await registry.connect(owner).authorizeUpdater(updater.address, true);
      
      expect(await registry.authorizedUpdaters(updater.address)).to.equal(true);
    });

    it("Should revoke updater", async function () {
      // First authorize
      await registry.connect(owner).authorizeUpdater(updater.address, true);
      
      // Then revoke
      await registry.connect(owner).authorizeUpdater(updater.address, false);
      
      expect(await registry.authorizedUpdaters(updater.address)).to.equal(false);
    });

    it("Should reject zero address updater", async function () {
      await expect(
        registry.connect(owner).authorizeUpdater(ethers.ZeroAddress, true)
      ).to.be.revertedWith("IdeaRegistry: updater 0");
    });

    it("Should reject non-owner from authorizing", async function () {
      await expect(
        registry.connect(user1).authorizeUpdater(updater.address, true)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });
  });
});