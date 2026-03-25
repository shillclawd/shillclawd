import { createPublicClient, createWalletClient, http, parseUnits, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const ESCROW_ABI = [
  {
    name: "depositWithPermit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gigId", type: "uint256" },
      { name: "advertiser", type: "address" },
      { name: "kolAddress", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "workDeadline", type: "uint256" },
      { name: "reviewDeadline", type: "uint256" },
      { name: "permitDeadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "markDelivered",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gigId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "release",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gigId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "refund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gigId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "markDisputed",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "gigId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "resolveDispute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "gigId", type: "uint256" },
      { name: "kolWins", type: "bool" },
    ],
    outputs: [],
  },
] as const;

function getClients() {
  const account = privateKeyToAccount(process.env.SETTLE_WALLET_PRIVATE_KEY! as `0x${string}`);
  const transport = http(process.env.BASE_RPC_URL);

  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ account, chain: base, transport });

  return { publicClient, walletClient, account };
}

function getEscrowAddress(): `0x${string}` {
  return process.env.ESCROW_CONTRACT_ADDRESS! as `0x${string}`;
}

function toUsdcUnits(amount: number): bigint {
  return parseUnits(amount.toString(), 6);
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
  const { publicClient, walletClient, account } = getClients();

  const hash = await walletClient.writeContract({
    address: getEscrowAddress(),
    abi: ESCROW_ABI,
    functionName: "depositWithPermit",
    args: [
      BigInt(params.gigId),
      params.advertiserAddress as `0x${string}`,
      params.kolAddress as `0x${string}`,
      toUsdcUnits(params.amount),
      BigInt(Math.floor(params.workDeadline.getTime() / 1000)),
      BigInt(Math.floor(params.reviewDeadline.getTime() / 1000)),
      BigInt(params.permitDeadline),
      params.permitV,
      params.permitR as `0x${string}`,
      params.permitS as `0x${string}`,
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}

export async function markDeliveredOnChain(onchainGigId: number): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const hash = await walletClient.writeContract({
    address: getEscrowAddress(),
    abi: ESCROW_ABI,
    functionName: "markDelivered",
    args: [BigInt(onchainGigId)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}

export async function releaseEscrow(onchainGigId: number): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const hash = await walletClient.writeContract({
    address: getEscrowAddress(),
    abi: ESCROW_ABI,
    functionName: "release",
    args: [BigInt(onchainGigId)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}

export async function refundEscrow(onchainGigId: number): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const hash = await walletClient.writeContract({
    address: getEscrowAddress(),
    abi: ESCROW_ABI,
    functionName: "refund",
    args: [BigInt(onchainGigId)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}

export async function markDisputedOnChain(onchainGigId: number): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const hash = await walletClient.writeContract({
    address: getEscrowAddress(),
    abi: ESCROW_ABI,
    functionName: "markDisputed",
    args: [BigInt(onchainGigId)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}

export async function resolveDisputeOnChain(onchainGigId: number, kolWins: boolean): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const hash = await walletClient.writeContract({
    address: getEscrowAddress(),
    abi: ESCROW_ABI,
    functionName: "resolveDispute",
    args: [BigInt(onchainGigId), kolWins],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}
