import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("task:mystic-address", "Prints the MysticAPR contract address").setAction(async (_, hre) => {
  const { deployments } = hre;
  const deployment = await deployments.get("MysticAPR");
  console.log(`MysticAPR address: ${deployment.address}`);
});

task("task:claim-airdrop", "Calls claimAirdrop() on MysticAPR").setAction(async (_, hre) => {
  const { ethers, deployments } = hre;
  const deployment = await deployments.get("MysticAPR");
  const contract = await ethers.getContractAt("MysticAPR", deployment.address);
  const [signer] = await ethers.getSigners();

  const tx = await contract.connect(signer).claimAirdrop();
  console.log(`Submitting claimAirdrop tx ${tx.hash}`);
  await tx.wait();
  console.log("Airdrop claimed");
});

task("task:decrypt-balance", "Decrypts the caller mUSDT balance")
  .addOptionalParam("address", "Account address to inspect")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { ethers, deployments, fhevm } = hre;
    await fhevm.initializeCLIApi();

    const deployment = await deployments.get("MysticAPR");
    const contract = await ethers.getContractAt("MysticAPR", deployment.address);
    const [signer] = await ethers.getSigners();
    const target = taskArguments.address ?? signer.address;

    const encryptedBalance = await contract.confidentialBalanceOf(target);
    console.log(`Encrypted balance for ${target}: ${encryptedBalance}`);

    const readable = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedBalance, deployment.address, signer);
    console.log(`Clear balance: ${readable}`);
  });

task("task:decrypt-stake", "Decrypts the caller stake and rewards").setAction(async (_, hre) => {
  const { ethers, deployments, fhevm } = hre;
  await fhevm.initializeCLIApi();

  const deployment = await deployments.get("MysticAPR");
  const contract = await ethers.getContractAt("MysticAPR", deployment.address);
  const [signer] = await ethers.getSigners();

  const encryptedStake = await contract.encryptedStakeOf(signer.address);
  const encryptedRewards = await contract.encryptedRewardsOf(signer.address);

  if (encryptedStake !== ethers.ZeroHash) {
    const stake = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedStake, deployment.address, signer);
    console.log(`Staked balance: ${stake}`);
  } else {
    console.log("No staked balance");
  }

  if (encryptedRewards !== ethers.ZeroHash) {
    const rewards = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedRewards, deployment.address, signer);
    console.log(`Accrued rewards: ${rewards}`);
  } else {
    console.log("No accrued rewards available");
  }
});
