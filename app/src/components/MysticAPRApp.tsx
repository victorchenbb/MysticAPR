import { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Contract, ContractTransactionResponse, ethers } from 'ethers';

import { Header } from './Header';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import {
  CONTRACT_ABI,
  CONTRACT_ADDRESS,
  TOKEN_DECIMALS,
  AIRDROP_AMOUNT,
} from '../config/contracts';

import '../styles/Dashboard.css';

type DecryptField = 'balance' | 'stake' | 'rewards';

const DECIMALS = BigInt(TOKEN_DECIMALS);

const formatTokenAmount = (value: bigint) => {
  const whole = value / DECIMALS;
  const fraction = value % DECIMALS;
  const fractionStr = fraction.toString().padStart(6, '0').replace(/0+$/, '');
  return fractionStr ? `${whole.toString()}.${fractionStr}` : whole.toString();
};

const parseInputAmount = (value: string): bigint | null => {
  if (!value) return null;
  if (!/^\d+(\.\d{0,6})?$/.test(value)) {
    return null;
  }

  const [whole, fraction = ''] = value.split('.');
  const paddedFraction = (fraction + '000000').slice(0, 6);
  return BigInt(whole) * DECIMALS + BigInt(paddedFraction);
};

const truncateCiphertext = (value?: string) => {
  if (!value || value === ethers.ZeroHash) return '0x0';
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
};

export function MysticAPRApp() {
  const { address } = useAccount();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const signerPromise = useEthersSigner();

  const [stakeAmount, setStakeAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState<DecryptField | null>(null);
  const [clearValues, setClearValues] = useState<Record<DecryptField, string | undefined>>({
    balance: undefined,
    stake: undefined,
    rewards: undefined,
  });

  const { data: hasClaimedData, refetch: refetchClaimed } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'hasClaimed',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const { data: encryptedBalance, refetch: refetchBalance } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'confidentialBalanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const { data: encryptedStake, refetch: refetchStake } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'encryptedStakeOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const { data: encryptedRewards, refetch: refetchRewards } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'encryptedRewardsOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const hasClaimed = Boolean(hasClaimedData);

  const refreshReads = () => {
    refetchBalance();
    refetchStake();
    refetchRewards();
    refetchClaimed();
  };

  const setError = (message: string) => {
    setStatusMessage(message);
    console.error(message);
  };

  const encryptValue = async (value: bigint) => {
    if (!instance || !address) {
      throw new Error('Encryption service is not ready yet');
    }
    const buffer = instance.createEncryptedInput(CONTRACT_ADDRESS, address);
    buffer.add64(value);
    return buffer.encrypt();
  };

  const executeWrite = async (
    label: string,
    handler: (contract: Contract) => Promise<ContractTransactionResponse>
  ) => {
    if (!address) {
      setError('Please connect your wallet to interact with the contract.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setError('Unable to access wallet signer.');
      return;
    }
    const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
    setPendingAction(label);
    setStatusMessage(null);
    try {
      const tx = await handler(contract);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error('Transaction failed');
      }
      refreshReads();
      setStatusMessage(`${label} completed.`);
    } catch (error) {
      console.error(error);
      setStatusMessage(
        error instanceof Error ? error.message : 'Transaction failed. Please try again.'
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleClaimAirdrop = async () => {
    await executeWrite('Claiming airdrop', (contract) => contract.claimAirdrop());
  };

  const handleStake = async () => {
    const amount = parseInputAmount(stakeAmount);
    if (amount === null || amount <= 0n) {
      setError('Enter a valid stake amount with up to 6 decimals.');
      return;
    }
    try {
      const encryptedInput = await encryptValue(amount);
      await executeWrite('Staking', (contract) =>
        contract.stake(encryptedInput.handles[0], encryptedInput.inputProof)
      );
      setStakeAmount('');
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to encrypt stake amount.'
      );
    }
  };

  const handleWithdraw = async () => {
    const amount = parseInputAmount(withdrawAmount);
    if (amount === null || amount <= 0n) {
      setError('Enter a valid withdrawal amount.');
      return;
    }
    try {
      const encryptedInput = await encryptValue(amount);
      await executeWrite('Withdrawing stake', (contract) =>
        contract.withdrawStake(encryptedInput.handles[0], encryptedInput.inputProof)
      );
      setWithdrawAmount('');
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to encrypt withdrawal amount.'
      );
    }
  };

  const handleWithdrawAll = async () => {
    await executeWrite('Withdrawing all stake', (contract) => contract.withdrawAllStake());
  };

  const handleClaimInterest = async () => {
    await executeWrite('Claiming rewards', (contract) => contract.claimInterest());
  };

  const decryptField = async (field: DecryptField, handle?: string) => {
    if (!handle || handle === ethers.ZeroHash) {
      setClearValues((prev) => ({ ...prev, [field]: '0' }));
      return;
    }
    if (!instance || !address) {
      setError('Encryption service is not available yet.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setError('Connect your wallet to decrypt values.');
      return;
    }

    setDecrypting(field);
    try {
      const keypair = instance.generateKeypair();
      const contractAddresses = [CONTRACT_ADDRESS];
      const startTimestamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const eip712 = instance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimestamp,
        durationDays
      );

      const signature = await signer.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
        },
        eip712.message
      );

      const result = await instance.userDecrypt(
        [{ handle, contractAddress: CONTRACT_ADDRESS }],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimestamp,
        durationDays
      );

      const decryptedValue = result[handle] || '0';
      const formatted = formatTokenAmount(BigInt(decryptedValue));
      setClearValues((prev) => ({ ...prev, [field]: formatted }));
    } catch (error) {
      console.error('Failed to decrypt field', error);
      setStatusMessage('Failed to decrypt value. Please try again.');
    } finally {
      setDecrypting(null);
    }
  };

  return (
    <div className="app-container">
      <Header />
      <main className="dashboard">
        {!address && (
          <div className="notice-card">
            <h2>Connect your wallet</h2>
            <p>Sign in with RainbowKit to claim the airdrop, stake, and decrypt your balances.</p>
          </div>
        )}

        <section className="grid">
          <div className="card">
            <h3>Starter airdrop</h3>
            <p>Claim {AIRDROP_AMOUNT} mUSDT to try the protocol.</p>
            <button
              className="primary-button"
              onClick={handleClaimAirdrop}
              disabled={!address || pendingAction !== null || hasClaimed}
            >
              {pendingAction === 'Claiming airdrop'
                ? 'Claiming...'
                : hasClaimed
                  ? 'Airdrop claimed'
                  : 'Claim mUSDT'}
            </button>
          </div>

          <div className="card">
            <h3>Encryption status</h3>
            <p>
              {zamaLoading
                ? 'Connecting to the Zama relayer...'
                : zamaError
                  ? 'Encryption service unavailable.'
                  : 'Ready to encrypt and decrypt balances.'}
            </p>
          </div>
        </section>

        <section className="grid">
          <div className="card">
            <div className="card-header">
              <div>
                <p className="card-label">Wallet balance</p>
                <h4>{clearValues.balance ?? 'Encrypted'}</h4>
                <p className="ciphertext">{truncateCiphertext(encryptedBalance as string)}</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => decryptField('balance', encryptedBalance as string | undefined)}
                disabled={!address || decrypting === 'balance' || !instance}
              >
                {decrypting === 'balance' ? 'Decrypting...' : 'Decrypt'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <p className="card-label">Staked balance</p>
                <h4>{clearValues.stake ?? 'Encrypted'}</h4>
                <p className="ciphertext">{truncateCiphertext(encryptedStake as string)}</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => decryptField('stake', encryptedStake as string | undefined)}
                disabled={!address || decrypting === 'stake' || !instance}
              >
                {decrypting === 'stake' ? 'Decrypting...' : 'Decrypt'}
              </button>
            </div>
          </div>
        </section>

        <section className="grid">
          <div className="card">
            <h3>Stake mUSDT</h3>
            <p>Encrypted staking uses the Zama relayer to protect your position.</p>
            <div className="form-control">
              <label>Amount</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="10.5"
                value={stakeAmount}
                onChange={(event) => setStakeAmount(event.target.value)}
              />
            </div>
            <button
              className="primary-button"
              onClick={handleStake}
              disabled={!address || pendingAction !== null || zamaLoading}
            >
              {pendingAction === 'Staking' ? 'Staking...' : 'Stake'}
            </button>
          </div>

          <div className="card">
            <h3>Withdraw stake</h3>
            <div className="form-control">
              <label>Partial amount</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="5"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
              />
            </div>
            <div className="button-row">
              <button
                className="secondary-button"
                onClick={handleWithdraw}
                disabled={!address || pendingAction !== null || zamaLoading}
              >
                {pendingAction === 'Withdrawing stake' ? 'Withdrawing...' : 'Withdraw amount'}
              </button>
              <button
                className="text-button"
                onClick={handleWithdrawAll}
                disabled={!address || pendingAction !== null}
              >
                {pendingAction === 'Withdrawing all stake' ? 'Withdrawing...' : 'Withdraw all'}
              </button>
            </div>
          </div>
        </section>

        <section className="grid">
          <div className="card">
            <div className="card-header">
              <div>
                <p className="card-label">Accrued rewards</p>
                <h4>{clearValues.rewards ?? 'Encrypted'}</h4>
                <p className="ciphertext">{truncateCiphertext(encryptedRewards as string)}</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => decryptField('rewards', encryptedRewards as string | undefined)}
                disabled={!address || decrypting === 'rewards' || !instance}
              >
                {decrypting === 'rewards' ? 'Decrypting...' : 'Decrypt'}
              </button>
            </div>
            <button
              className="primary-button"
              onClick={handleClaimInterest}
              disabled={!address || pendingAction !== null}
            >
              {pendingAction === 'Claiming rewards' ? 'Claiming...' : 'Claim rewards'}
            </button>
          </div>
        </section>

        {statusMessage && <div className="status-banner">{statusMessage}</div>}
      </main>
    </div>
  );
}
