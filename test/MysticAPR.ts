import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MysticAPR, MysticAPR__factory } from "../types";

type Fixture = {
  mysticAPR: MysticAPR;
  address: string;
};

const DECIMALS = 1_000_000n;
const AIRDROP = 1_000n * DECIMALS;
const RATE_BPS = 100n;
const BPS_DENOMINATOR = 10_000n;
const SECONDS_IN_YEAR = 365n * 24n * 60n * 60n;

async function deployFixture(): Promise<Fixture> {
  const factory = (await ethers.getContractFactory("MysticAPR")) as MysticAPR__factory;
  const mysticAPR = (await factory.deploy()) as MysticAPR;
  const address = await mysticAPR.getAddress();

  return { mysticAPR, address };
}

async function encryptAmount(
  contractAddress: string,
  owner: HardhatEthersSigner,
  value: bigint
): Promise<{ handles: string[]; inputProof: string }> {
  const input = fhevm.createEncryptedInput(contractAddress, owner.address);
  input.add64(value);
  return input.encrypt();
}

describe("MysticAPR", function () {
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let mysticAPR: MysticAPR;
  let mysticAPRAddress: string;

  before(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite must run against the fhevm mock");
      this.skip();
    }

    const signers = await ethers.getSigners();
    [deployer, alice] = [signers[0], signers[1]];
  });

  beforeEach(async function () {
    ({ mysticAPR, address: mysticAPRAddress } = await deployFixture());
  });

  it("lets a user claim the airdrop only once", async function () {
    await expect(mysticAPR.connect(alice).claimAirdrop()).to.not.be.reverted;
    await expect(mysticAPR.connect(alice).claimAirdrop()).to.be.revertedWith("Airdrop already claimed");

    const encryptedBalance = await mysticAPR.confidentialBalanceOf(alice.address);
    const balance = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedBalance, mysticAPRAddress, alice);

    expect(balance).to.eq(AIRDROP);
  });

  it("stakes and withdraws encrypted balances", async function () {
    await mysticAPR.connect(alice).claimAirdrop();

    const stakeAmount = 400n * DECIMALS;
    const encryptedStakeInput = await encryptAmount(mysticAPRAddress, alice, stakeAmount);
    await mysticAPR.connect(alice).stake(encryptedStakeInput.handles[0], encryptedStakeInput.inputProof);

    const encryptedStake = await mysticAPR.encryptedStakeOf(alice.address);
    const clearStake = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedStake, mysticAPRAddress, alice);
    expect(clearStake).to.eq(stakeAmount);

    const withdrawAmount = 150n * DECIMALS;
    const encryptedWithdraw = await encryptAmount(mysticAPRAddress, alice, withdrawAmount);
    await mysticAPR.connect(alice).withdrawStake(encryptedWithdraw.handles[0], encryptedWithdraw.inputProof);

    const encryptedStakeAfter = await mysticAPR.encryptedStakeOf(alice.address);
    const clearStakeAfter = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedStakeAfter,
      mysticAPRAddress,
      alice
    );
    expect(clearStakeAfter).to.eq(stakeAmount - withdrawAmount);

    await mysticAPR.connect(alice).withdrawAllStake();
    const emptiedStake = await mysticAPR.encryptedStakeOf(alice.address);
    const clearAfterFullWithdraw = emptiedStake === ethers.ZeroHash
      ? 0n
      : await fhevm.userDecryptEuint(FhevmType.euint64, emptiedStake, mysticAPRAddress, alice);
    expect(clearAfterFullWithdraw).to.eq(0n);
  });

  it("accrues and mints rewards", async function () {
    await mysticAPR.connect(alice).claimAirdrop();

    const stakeAmount = 500n * DECIMALS;
    const stakeInput = await encryptAmount(mysticAPRAddress, alice, stakeAmount);
    await mysticAPR.connect(alice).stake(stakeInput.handles[0], stakeInput.inputProof);

    const thirtyDays = 30n * 24n * 60n * 60n;
    await ethers.provider.send("evm_increaseTime", [Number(thirtyDays)]);
    await ethers.provider.send("evm_mine", []);

    await mysticAPR.connect(alice).claimInterest();
    const encryptedClaim = await mysticAPR.lastClaimedReward(alice.address);
    const claimed = await fhevm.userDecryptEuint(FhevmType.euint64, encryptedClaim, mysticAPRAddress, alice);

    const expected = (stakeAmount * RATE_BPS * thirtyDays) / (SECONDS_IN_YEAR * BPS_DENOMINATOR);
    const delta = claimed > expected ? claimed - expected : expected - claimed;
    expect(delta).to.lte(1n);
  });
});
