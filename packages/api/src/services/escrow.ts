import { ethers } from "ethers";

const ESCROW_ABI = [
  "function depositWithPermit(uint256 gigId, address advertiser, address kolAddress, uint256 amount, uint256 workDeadline, uint256 reviewDeadline, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s) external",
  "function markDelivered(uint256 gigId) external",
  "function release(uint256 gigId) external",
  "function refund(uint256 gigId) external",
  "function markDisputed(uint256 gigId) external",
  "function resolveDispute(uint256 gigId, bool kolWins) external",
  "function autoRelease(uint256 gigId) external",
  "function autoRefund(uint256 gigId) external",
  "function autoResolveDispute(uint256 gigId) external",
];

function getEscrowContract(): ethers.Contract {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new ethers.Wallet(process.env.SETTLE_WALLET_PRIVATE_KEY!, provider);
  return new ethers.Contract(process.env.ESCROW_CONTRACT_ADDRESS!, ESCROW_ABI, wallet);
}

// USDC has 6 decimals
function toUsdcUnits(amount: number): bigint {
  return ethers.parseUnits(amount.toString(), 6);
}

export interface DepositParams {
  gigId: number;
  advertiserAddress: string;
  kolAddress: string;
  amount: number;
  workDeadline: Date;
  reviewDeadline: Date;
  permitV: number;
  permitR: string;
  permitS: string;
  permitDeadline: number;
}

export async function depositEscrow(params: DepositParams): Promise<string> {
  const contract = getEscrowContract();

  const tx = await contract.depositWithPermit(
    params.gigId,
    params.advertiserAddress,
    params.kolAddress,
    toUsdcUnits(params.amount),
    Math.floor(params.workDeadline.getTime() / 1000),
    Math.floor(params.reviewDeadline.getTime() / 1000),
    params.permitDeadline,
    params.permitV,
    params.permitR,
    params.permitS
  );

  const receipt = await tx.wait();
  return receipt.hash;
}

export async function markDeliveredOnChain(onchainGigId: number): Promise<string> {
  const contract = getEscrowContract();
  const tx = await contract.markDelivered(onchainGigId);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function releaseEscrow(onchainGigId: number): Promise<string> {
  const contract = getEscrowContract();
  const tx = await contract.release(onchainGigId);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function refundEscrow(onchainGigId: number): Promise<string> {
  const contract = getEscrowContract();
  const tx = await contract.refund(onchainGigId);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function markDisputedOnChain(onchainGigId: number): Promise<string> {
  const contract = getEscrowContract();
  const tx = await contract.markDisputed(onchainGigId);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function resolveDisputeOnChain(onchainGigId: number, kolWins: boolean): Promise<string> {
  const contract = getEscrowContract();
  const tx = await contract.resolveDispute(onchainGigId, kolWins);
  const receipt = await tx.wait();
  return receipt.hash;
}
