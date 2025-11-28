// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ERC7984} from "confidential-contracts-v91/contracts/token/ERC7984/ERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

/**
 * @title MysticAPR
 * @notice Confidential staking contract that lets users claim an airdrop, stake their mUSDT, and claim rewards.
 * Tokens follow the ERC7984 confidential fungible token interface.
 */
contract MysticAPR is ERC7984, ZamaEthereumConfig {
    uint64 public constant AIRDROP_AMOUNT = 1_000 * 1_000_000;
    uint64 public constant APR_BPS = 100; // 1% APR expressed in basis points
    uint64 public constant BPS_DENOMINATOR = 10_000;
    uint64 private constant SECONDS_IN_YEAR = 365 days;
    uint64 private constant ACCRUAL_DENOMINATOR = SECONDS_IN_YEAR * BPS_DENOMINATOR;

    struct StakeInfo {
        euint64 encryptedBalance;
        euint64 accruedRewards;
        uint64 lastAccrual;
    }

    mapping(address => StakeInfo) private _stakes;
    mapping(address => bool) private _airdropClaimed;
    mapping(address => euint64) private _lastClaimedReward;

    event AirdropClaimed(address indexed user, euint64 amount);
    event Staked(address indexed user, euint64 amount);
    event Unstaked(address indexed user, euint64 amount);
    event InterestClaimed(address indexed user, euint64 amount);

    constructor() ERC7984("mUSDT", "mUSDT", "") {}

    /**
     * @notice Returns whether the address already claimed the initial airdrop.
     */
    function hasClaimed(address user) external view returns (bool) {
        return _airdropClaimed[user];
    }

    /**
     * @notice Returns the encrypted stake balance for the given user.
     */
    function encryptedStakeOf(address user) external view returns (euint64) {
        return _stakes[user].encryptedBalance;
    }

    /**
     * @notice Returns the encrypted rewards that have been accrued and are ready to be claimed.
     */
    function encryptedRewardsOf(address user) external view returns (euint64) {
        return _stakes[user].accruedRewards;
    }

    /**
     * @notice Returns the timestamp when the user's rewards were last updated.
     */
    function lastAccrualOf(address user) external view returns (uint64) {
        return _stakes[user].lastAccrual;
    }

    /**
     * @notice Returns the encrypted amount minted the last time the user claimed rewards.
     */
    function lastClaimedReward(address user) external view returns (euint64) {
        return _lastClaimedReward[user];
    }

    /**
     * @notice Claims the one-time mUSDT airdrop.
     */
    function claimAirdrop() external returns (euint64) {
        require(!_airdropClaimed[msg.sender], "Airdrop already claimed");
        _airdropClaimed[msg.sender] = true;

        euint64 minted = _mint(msg.sender, FHE.asEuint64(AIRDROP_AMOUNT));
        emit AirdropClaimed(msg.sender, minted);
        return minted;
    }

    /**
     * @notice Stakes an encrypted amount of mUSDT into the contract.
     * @param encryptedAmount ciphertext handle representing the stake amount
     * @param inputProof proof returned by the relayer for the encrypted input
     */
    function stake(externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (euint64) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 transferred = _transfer(msg.sender, address(this), amount);

        _accrueInterest(msg.sender);

        StakeInfo storage position = _stakes[msg.sender];
        position.encryptedBalance = FHE.add(position.encryptedBalance, transferred);
        if (position.lastAccrual == 0) {
            position.lastAccrual = uint64(block.timestamp);
        }
        _shareStakeValues(msg.sender, position);

        emit Staked(msg.sender, transferred);
        return transferred;
    }

    /**
     * @notice Withdraws part of a user's staked balance using an encrypted amount.
     * @param encryptedAmount ciphertext handle representing the requested withdrawal amount
     * @param inputProof proof returned by the relayer for the encrypted input
     */
    function withdrawStake(externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (euint64) {
        StakeInfo storage position = _stakes[msg.sender];
        require(FHE.isInitialized(position.encryptedBalance), "Nothing staked");

        _accrueInterest(msg.sender);

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 withdrawable = FHE.min(position.encryptedBalance, requested);
        position.encryptedBalance = FHE.sub(position.encryptedBalance, withdrawable);
        _shareStakeValues(msg.sender, position);

        euint64 sent = _transfer(address(this), msg.sender, withdrawable);
        emit Unstaked(msg.sender, sent);
        return sent;
    }

    /**
     * @notice Withdraws the entire encrypted stake balance for the caller.
     */
    function withdrawAllStake() external returns (euint64) {
        StakeInfo storage position = _stakes[msg.sender];
        require(FHE.isInitialized(position.encryptedBalance), "Nothing staked");

        _accrueInterest(msg.sender);

        euint64 balance = position.encryptedBalance;
        position.encryptedBalance = FHE.asEuint64(0);
        _shareStakeValues(msg.sender, position);

        euint64 sent = _transfer(address(this), msg.sender, balance);
        emit Unstaked(msg.sender, sent);
        return sent;
    }

    /**
     * @notice Claims all available interest accrued on the caller's stake.
     */
    function claimInterest() external returns (euint64) {
        StakeInfo storage position = _stakes[msg.sender];
        _accrueInterest(msg.sender);

        require(FHE.isInitialized(position.accruedRewards), "No rewards");

        euint64 reward = position.accruedRewards;
        position.accruedRewards = FHE.asEuint64(0);
        _shareStakeValues(msg.sender, position);

        euint64 minted = _mint(msg.sender, reward);
        _lastClaimedReward[msg.sender] = minted;
        _shareLastClaimed(msg.sender);

        emit InterestClaimed(msg.sender, minted);
        return minted;
    }

    function _accrueInterest(address user) internal {
        StakeInfo storage position = _stakes[user];
        if (!FHE.isInitialized(position.encryptedBalance)) {
            position.lastAccrual = uint64(block.timestamp);
            return;
        }

        if (position.lastAccrual == 0) {
            position.lastAccrual = uint64(block.timestamp);
            return;
        }

        uint256 elapsed = block.timestamp - position.lastAccrual;
        if (elapsed == 0) {
            return;
        }

        uint256 scaledElapsed = elapsed * APR_BPS;
        if (scaledElapsed > type(uint64).max) {
            scaledElapsed = type(uint64).max;
        }

        euint64 scaledProduct = FHE.mul(position.encryptedBalance, uint64(scaledElapsed));
        euint64 incremental = FHE.div(scaledProduct, ACCRUAL_DENOMINATOR);
        position.accruedRewards = FHE.add(position.accruedRewards, incremental);
        position.lastAccrual = uint64(block.timestamp);

        _shareStakeValues(user, position);
    }

    function _shareStakeValues(address user, StakeInfo storage position) internal {
        if (FHE.isInitialized(position.encryptedBalance)) {
            FHE.allow(position.encryptedBalance, user);
            FHE.allowThis(position.encryptedBalance);
        }
        if (FHE.isInitialized(position.accruedRewards)) {
            FHE.allow(position.accruedRewards, user);
            FHE.allowThis(position.accruedRewards);
        }
    }

    function _shareLastClaimed(address user) internal {
        if (FHE.isInitialized(_lastClaimedReward[user])) {
            FHE.allow(_lastClaimedReward[user], user);
            FHE.allowThis(_lastClaimedReward[user]);
        }
    }
}
