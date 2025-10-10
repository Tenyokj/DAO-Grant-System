const hre = require("hardhat");
const { ethers } = hre;
const { parseUnits } = require("ethers");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Running with account:", deployer.address);

    const FundingPool = await ethers.getContractFactory("FundingPool");
    const pool = await FundingPool.attach("0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9");

    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const token = await GovernanceToken.attach("0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9");

    const amount = parseUnits("100", 18);

    // 🪙 Mint токены (если функция mint доступна)
    const txMint = await token.mint(deployer.address, parseUnits("1000", 18));
    await txMint.wait();
    console.log("✅ Minted 1000 TTK to deployer");

    // ✅ Approve и Deposit
    const txApprove = await token.approve(pool.target, amount);
    await txApprove.wait();
    console.log("✅ Approved 100 TTK");

    const txDeposit = await pool.deposit(amount);
    await txDeposit.wait();
    console.log("✅ Deposited 100 TTK to FundingPool");
}

main().catch((err) => {
    console.error("❌ Error:", err);
    process.exitCode = 1;
});
