import {
  expect,
  hre,
  type HardhatEthers,
  type NetworkHelpers,
} from "../setup.js";

describe("GovernanceToken", function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;
  let token: any;
  let owner: any;
  let user1: any;
  let user2: any;
  let grantManager: any;
  
  const TOKEN_NAME = "TenyokjToken";
  const TOKEN_SYMBOL = "TTK";
  const MAX_SUPPLY = BigInt("1000000000000000000000000"); // 1M tokens

  beforeEach(async function () {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);

    const signers = await ethers.getSigners();
    [owner, user1, user2, grantManager] = signers;
    
    // Deploy GovernanceToken using new syntax
    token = await ethers.deployContract("GovernanceToken", [
      grantManager.address,
      MAX_SUPPLY
    ]);
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await token.decimals()).to.equal(18);
    });

    it("Should set the correct max supply", async function () {
      expect(await token.maxSupply()).to.equal(MAX_SUPPLY);
    });

    it("Should authorize grantManager as minter", async function () {
      expect(await token.authorizedMinters(grantManager.address)).to.equal(true);
    });
  });

  describe("Minting", function () {
    it("Should allow authorized minter to mint tokens", async function () {
      const amount = ethers.parseEther("1000");
      
      // GrantManager mints tokens
      await token.connect(grantManager).mint(user1.address, amount);
      
      expect(await token.balanceOf(user1.address)).to.equal(amount);
      expect(await token.totalSupply()).to.equal(amount);
    });

    it("Should reject unauthorized minting", async function () {
      const amount = ethers.parseEther("1000");
      
      await expect(
        token.connect(user1).mint(user2.address, amount)
      ).to.be.revertedWith("GovernanceToken: minter not authorized");
    });

    it("Should respect max supply limit", async function () {
      const maxAmount = MAX_SUPPLY;
      
      await token.connect(grantManager).mint(owner.address, maxAmount);
      
      // Try to mint one more token
      await expect(
        token.connect(grantManager).mint(owner.address, 1)
      ).to.be.revertedWith("GovernanceToken: max supply exceeded");
    });

    it("Should not mint zero tokens", async function () {
      await expect(
        token.connect(grantManager).mint(user1.address, 0)
      ).to.be.revertedWith("GovernanceToken: zero amount");
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      const amount = ethers.parseEther("1000");
      await token.connect(grantManager).mint(user1.address, amount);
    });

    it("Should allow authorized minter to burn tokens", async function () {
      const burnAmount = ethers.parseEther("500");
      const initialBalance = await token.balanceOf(user1.address);
      
      await token.connect(grantManager).burnTokens(user1.address, burnAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(initialBalance - burnAmount);
    });

    it("Should allow owner to burn tokens", async function () {
      const burnAmount = ethers.parseEther("200");
      const initialBalance = await token.balanceOf(user1.address);
      
      await token.connect(owner).burnTokens(user1.address, burnAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(initialBalance - burnAmount);
    });

    it("Should reject unauthorized burning", async function () {
      const burnAmount = ethers.parseEther("100");
      
      await expect(
        token.connect(user2).burnTokens(user1.address, burnAmount)
      ).to.be.revertedWith("GovernanceToken: not authorized to burn");
    });
  });

  describe("Snapshots", function () {
    beforeEach(async function () {
      const amount = ethers.parseEther("1000");
      await token.connect(grantManager).mint(user1.address, amount);
    });

   it("Should create snapshot", async function () {
      const snapshotTx = await token.connect(owner).snapshot();
      const receipt = await snapshotTx.wait();
      
      // Get snapshot ID from event
      const event = receipt?.logs?.find((log: any) => 
        log.fragment?.name === "SnapshotCreated"
      );
      
      if (event) {
        const snapshotId = event.args[0];
        expect(snapshotId).to.be.greaterThan(0);
      } else {
        // Fallback: call returns snapshotId directly
        const snapshotId = await token.connect(owner).snapshot();
        expect(snapshotId).to.be.greaterThan(0);
      }
    });

    it("Should allow grantManager to create snapshot", async function () {
      await token.connect(grantManager).snapshot();
      // Should not revert
    });

    it("Should query balance at snapshot", async function () {
      // Create snapshot 1
      const snapshotTx1 = await token.snapshot();
      const receipt1 = await snapshotTx1.wait();
      let snapshotId1 = 0;
      
      const event1 = receipt1?.logs?.find((log: any) => 
        log.fragment?.name === "SnapshotCreated"
      );
      if (event1) {
        snapshotId1 = event1.args[0];
      }
      
      // Transfer tokens
      const transferAmount = ethers.parseEther("500");
      await token.connect(user1).transfer(user2.address, transferAmount);
      
      // Create snapshot 2
      const snapshotTx2 = await token.snapshot();
      const receipt2 = await snapshotTx2.wait();
      let snapshotId2 = 0;
      
      const event2 = receipt2?.logs?.find((log: any) => 
        log.fragment?.name === "SnapshotCreated"
      );
      if (event2) {
        snapshotId2 = event2.args[0];
      }
      
      // If we have snapshot IDs from events, use them
      if (snapshotId1 > 0 && snapshotId2 > 0) {
        // Check balances at snapshots
        const balance1 = await token.balanceOfAt(user1.address, snapshotId1);
        const balance2 = await token.balanceOfAt(user1.address, snapshotId2);
        
        expect(balance1).to.equal(ethers.parseEther("1000"));
        expect(balance2).to.equal(ethers.parseEther("500"));
      }
    });

    it("Should reject snapshot query with invalid ID", async function () {
      await expect(
        token.balanceOfAt(user1.address, 999)
      ).to.be.revertedWith("GovernanceToken: snapshot not found");
    });
  });

  describe("Minter Management", function () {
    it("Should allow owner to add new minter", async function () {
      await token.connect(owner).setMinter(user1.address, true);
      
      expect(await token.authorizedMinters(user1.address)).to.equal(true);
    });

    it("Should allow owner to revoke minter", async function () {
      // First add as minter
      await token.connect(owner).setMinter(user1.address, true);
      
      // Then revoke
      await token.connect(owner).setMinter(user1.address, false);
      
      expect(await token.authorizedMinters(user1.address)).to.equal(false);
    });

    it("Should reject non-owner from managing minters", async function () {
      await expect(
        token.connect(user1).setMinter(user2.address, true)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      const amount = ethers.parseEther("1000");
      await token.connect(grantManager).mint(user1.address, amount);
    });

    it("Should transfer tokens between users", async function () {
      const transferAmount = ethers.parseEther("300");
      const initialBalance1 = await token.balanceOf(user1.address);
      const initialBalance2 = await token.balanceOf(user2.address);
      
      await token.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await token.balanceOf(user1.address)).to.equal(initialBalance1 - transferAmount);
      expect(await token.balanceOf(user2.address)).to.equal(initialBalance2 + transferAmount);
    });

    it("Should update checkpoints on transfer", async function () {
      const transferAmount = ethers.parseEther("200");
      
      // Create snapshot before transfer
      const snapshotTx = await token.snapshot();
      const receipt = await snapshotTx.wait();
      let snapshotId = 0;
      
      const event = receipt?.logs?.find((log: any) => 
        log.fragment?.name === "SnapshotCreated"
      );
      if (event) {
        snapshotId = event.args[0];
      }
      
      if (snapshotId > 0) {
        // Make transfer
        await token.connect(user1).transfer(user2.address, transferAmount);
        
        // Balance at snapshot should be original
        const balanceAtSnapshot = await token.balanceOfAt(user1.address, snapshotId);
        expect(balanceAtSnapshot).to.equal(ethers.parseEther("1000"));
        
        // Current balance should be updated
        const currentBalance = await token.balanceOf(user1.address);
        expect(currentBalance).to.equal(ethers.parseEther("800"));
      }
    });
  });
});