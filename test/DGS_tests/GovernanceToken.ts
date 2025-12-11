import {
  expect,
  hre,
  type HardhatEthers,
  type NetworkHelpers,
} from "../setup.js";

describe("GovernanceToken (full tests, ethers v6) - fixed", function () {
  let ethers: HardhatEthers;
  let networkHelpers: NetworkHelpers;

  before(async () => {
    const connection = await hre.network.connect();
    ({ ethers, networkHelpers } = connection);
  });

  // helper to attempt both possible Ownable revert shapes
  async function expectOwnableRevert(promiseFactory: () => Promise<any>, token: any) {
    // Try old OZ message first, if it fails try custom error
    try {
      await expect(promiseFactory()).to.be.revertedWith("Ownable: caller is not the owner");
    } catch {
      // fallback to custom error name used by some OZ versions
      await expect(promiseFactory()).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    }
  }

  // deploy fixture used by tests
  const deploy = async () => {
    const [owner, addr1, addr2, minter] = await ethers.getSigners();

    // Deploy GovernanceToken with placeholder addresses for manager and pool (must be non-zero)
    // constructor(address _grantManager, address _fundingPool, uint256 _maxSupply)
    const maxSupply = 1_000_000n;
    const token = await ethers.deployContract("GovernanceToken", [
      owner.address,
      owner.address,
      maxSupply,
    ]);

    // deploy minimal other contracts to satisfy wiring used by token tests
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

    // minimal wiring used in token tests
    await idea.authorizeUpdater(voting.target, true);
    await pool.setVotingSystem(voting.target);
    await voting.setGovernanceToken(token.target);
    await voting.setIdeaRegistry(idea.target);
    await voting.setFundingPool(pool.target);

    // deploy GrantManager at end
    const manager = await ethers.deployContract("GrantManager", [
      voting.target,
      pool.target,
      idea.target,
    ]);

    // grant manager and pool minter rights in token
    await token.setMinter(manager.target, true);
    await token.setMinter(pool.target, true);

    // let voting know manager if needed
    await voting.setGrantManager(manager.target);

    return { token, owner, addr1, addr2, minter, idea, voting, pool, manager };
  };

  // small helper to keep literals simple (we use raw token units as integers)
  const U = (n: number | bigint) => BigInt(n);

  // -------------------------
  // MINT TESTS
  // -------------------------
  it("should mint tokens for authorized minter", async function () {
    const { token, owner, minter } = await deploy();

    // owner authorizes minter
    await expect(token.connect(owner).setMinter(minter.address, true))
      .to.emit(token, "MinterUpdated")
      .withArgs(minter.address, true);

    // minter mints tokens to themself (use bigint)
    await expect(token.connect(minter).mint(minter.address, U(200_000)))
      .to.emit(token, "TokensMinted")
      .withArgs(minter.address, U(200_000));

    // balance check
    const bal = await token.balanceOf(minter.address);
    expect(bal).to.equal(U(200_000));
  });

  it("should revert when non-minter tries to mint", async function () {
    const { token, addr1 } = await deploy();

    await expect(token.connect(addr1).mint(addr1.address, U(200_000))).to.be.revertedWith(
      "GovernanceToken: minter not authorized"
    );
  });

  it("should revert if maxSupply exceeded", async function () {
    const { token, owner, minter } = await deploy();

    // authorize minter
    await token.connect(owner).setMinter(minter.address, true);

    // attempt to mint more than maxSupply (exceed)
    await expect(token.connect(minter).mint(minter.address, U(1_000_001))).to.be.revertedWith(
      "GovernanceToken: max supply exceeded"
    );
  });

  it("should revert if amount to mint is zero", async function () {
    const { token, owner, minter } = await deploy();

    // authorize minter
    await token.connect(owner).setMinter(minter.address, true);

    await expect(token.connect(minter).mint(minter.address, U(0))).to.be.revertedWith(
      "GovernanceToken: zero amount"
    );
  });

  // -------------------------
  // BURN TESTS
  // -------------------------
  it("should burn tokens by the owner", async function () {
    const { token, owner } = await deploy();

    // ensure owner is authorized minter so they can mint first
    await token.connect(owner).setMinter(owner.address, true);

    // mint then burn
    await expect(token.connect(owner).mint(owner.address, U(200_000)))
      .to.emit(token, "TokensMinted")
      .withArgs(owner.address, U(200_000));

    // call explicit overload burn(address,uint256)
    const tokenOwner = token.connect(owner) as any;
    await expect(tokenOwner["burn(address,uint256)"](owner.address, U(50_000)))
      .to.emit(token, "TokensBurned")
      .withArgs(owner.address, U(50_000));

    expect(await token.balanceOf(owner.address)).to.equal(U(150_000));
  });

  it("should burn tokens by authorized minter", async function () {
    const { token, owner, minter } = await deploy();

    // authorize minter
    await token.connect(owner).setMinter(minter.address, true);

    // minter mints then burns
    await expect(token.connect(minter).mint(minter.address, U(200_000)))
      .to.emit(token, "TokensMinted")
      .withArgs(minter.address, U(200_000));

    const tokenMinter = token.connect(minter) as any;
    await expect(tokenMinter["burn(address,uint256)"](minter.address, U(50_000)))
      .to.emit(token, "TokensBurned")
      .withArgs(minter.address, U(50_000));

    expect(await token.balanceOf(minter.address)).to.equal(U(150_000));
  });

  it("should revert burn for non-owner/non-minter", async function () {
    const { token, addr1 } = await deploy();

    const tokenAddr1 = token.connect(addr1) as any;
    await expect(tokenAddr1["burn(address,uint256)"](addr1.address, U(50_000))).to.be.revertedWith(
      "GovernanceToken: not authorized to burn"
    );
  });

  it("should revert if amount to burn is zero", async function () {
    const { token, owner } = await deploy();

    // authorize owner to be safe
    await token.connect(owner).setMinter(owner.address, true);

    const tokenOwner = token.connect(owner) as any;
    await expect(tokenOwner["burn(address,uint256)"](owner.address, U(0))).to.be.revertedWith(
      "GovernanceToken: zero amount"
    );
  });

  // -------------------------
  // SNAPSHOT TESTS
  // -------------------------
  it("should create snapshot and read balanceAt / totalSupplyAt", async function () {
    const { token, owner, addr1, minter } = await deploy();

    // Ensure totalSupply is zero initially
    expect(await token.totalSupply()).to.equal(U(0));

    // owner creates snapshot
    const tx = await token.connect(owner).snapshot();
    const rc = await tx.wait();
    if (!rc) throw new Error("snapshot tx not mined");

    // parse logs from rc.logs
    const parsed = rc.logs
      .map((log: any) => {
        try { return token.interface.parseLog(log); } catch { return null; }
      })
      .find((l: any) => l && l.name === "SnapshotCreated");

    expect(parsed).to.not.equal(undefined);
    const snapshotId = parsed!.args[0] as bigint;

    // authorize minter and mint after snapshot
    await token.connect(owner).setMinter(minter.address, true);
    await token.connect(minter).mint(minter.address, U(200_000));

    // transfer some to addr1
    await token.connect(minter).transfer(addr1.address, U(100_000));

    // current balances
    expect(await token.balanceOf(minter.address)).to.equal(U(100_000));
    expect(await token.balanceOf(addr1.address)).to.equal(U(100_000));

    // balances at snapshot should be zero (no supply before snapshot)
    expect(await token.balanceOfAt(minter.address, snapshotId)).to.equal(U(0));
    expect(await token.balanceOfAt(addr1.address, snapshotId)).to.equal(U(0));

    // totalSupply at snapshot should be 0
    expect(await token.totalSupplyAt(snapshotId)).to.equal(U(0));
  });

  it("should revert snapshot from non-owner", async function () {
    const { token, addr1 } = await deploy();

    await expectOwnableRevert(() => token.connect(addr1).snapshot(), token);
  });

  // -------------------------
  // setMinter tests
  // -------------------------
  it("should set minter correctly and emit event", async function () {
    const { token, owner, minter } = await deploy();

    await expect(token.connect(owner).setMinter(minter.address, true))
      .to.emit(token, "MinterUpdated")
      .withArgs(minter.address, true);

    // confirm mapping updated (public mapping returns bool)
    expect(await token.authorizedMinters(minter.address)).to.equal(true);
  });

  it("should revoke minter correctly", async function () {
    const { token, owner, minter } = await deploy();

    await token.connect(owner).setMinter(minter.address, true);
    await expect(token.connect(owner).setMinter(minter.address, false))
      .to.emit(token, "MinterUpdated")
      .withArgs(minter.address, false);

    expect(await token.authorizedMinters(minter.address)).to.equal(false);
  });

  it("should revert for zero address", async function () {
    const { token, owner } = await deploy();

    await expect(token.connect(owner).setMinter("0x0000000000000000000000000000000000000000", true)).to.be.revertedWith(
      "GovernanceToken: minter 0"
    );
  });

  it("should revert when non-owner tries to set minter", async function () {
    const { token, addr1, minter } = await deploy();

    await expectOwnableRevert(() => token.connect(addr1).setMinter(minter?.address ?? minter.address, true), token);
  });
});
