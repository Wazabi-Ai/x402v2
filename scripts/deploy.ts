import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// Token addresses per network
const TOKENS: Record<string, Record<string, string>> = {
  mainnet: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  bsc: {
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  },
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    WETH: '0x4200000000000000000000000000000000000006',
  },
};

// Wazabi treasury address (fee collection + paymaster gas deposits)
const WAZABI_TREASURY = '0x1b4F633B1FC5FC26Fb8b722b2373B3d4D71aCaeB';

// ERC-4337 EntryPoint v0.7 (same address on all EVM chains)
const ENTRYPOINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

// Default fee in basis points (50 = 0.5%)
const DEFAULT_FEE_BPS = 50;

// Minimum native token deposit for the paymaster at the EntryPoint.
// The paymaster must have a deposit so it can sponsor UserOperations.
// This amount is in native token (ETH/BNB) and should cover initial gas costs.
const PAYMASTER_DEPOSIT_AMOUNT = '0.1'; // 0.1 ETH/BNB

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;
  const treasuryAddress = process.env.TREASURY_ADDRESS || WAZABI_TREASURY;

  console.log(`\nDeploying to ${networkName} with account: ${deployer.address}`);
  console.log(`Treasury: ${treasuryAddress}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // 1. Deploy WazabiAccountFactory
  //    The factory constructor takes only the EntryPoint address and
  //    internally deploys its own WazabiAccount implementation contract.
  console.log('1. Deploying WazabiAccountFactory...');
  const WazabiAccountFactory = await ethers.getContractFactory('WazabiAccountFactory');
  const factory = await WazabiAccountFactory.deploy(ENTRYPOINT);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`   WazabiAccountFactory: ${factoryAddress}`);

  // Read the implementation address that the factory deployed internally
  const accountImplAddress = await factory.accountImplementation();
  console.log(`   WazabiAccount implementation (created by factory): ${accountImplAddress}`);

  // 2. Deploy WazabiPaymaster
  console.log('2. Deploying WazabiPaymaster...');
  const WazabiPaymaster = await ethers.getContractFactory('WazabiPaymaster');
  const paymaster = await WazabiPaymaster.deploy(ENTRYPOINT, deployer.address, treasuryAddress);
  await paymaster.waitForDeployment();
  const paymasterAddress = await paymaster.getAddress();
  console.log(`   WazabiPaymaster: ${paymasterAddress}`);

  // 3. Deploy WazabiSettlement (non-custodial x402 settlement with fee splitting)
  const feeBps = parseInt(process.env.FEE_BPS || String(DEFAULT_FEE_BPS));
  console.log(`3. Deploying WazabiSettlement (treasury=${treasuryAddress}, feeBps=${feeBps})...`);
  const WazabiSettlement = await ethers.getContractFactory('WazabiSettlement');
  const settlement = await WazabiSettlement.deploy(treasuryAddress, feeBps);
  await settlement.waitForDeployment();
  const settlementAddress = await settlement.getAddress();
  console.log(`   WazabiSettlement: ${settlementAddress}`);

  // 4. Configure paymaster with supported tokens
  const networkTokens = TOKENS[networkName] || {};
  let step = 4;
  for (const [symbol, address] of Object.entries(networkTokens)) {
    console.log(`${step}. Adding ${symbol} (${address}) to paymaster...`);
    const tx = await paymaster.addSupportedToken(address, ethers.parseUnits('1', 18)); // 1:1 initial ratio
    await tx.wait();
    console.log(`   ${symbol} added`);
    step++;
  }

  // 4. Deposit native tokens into EntryPoint for the paymaster
  //    The paymaster needs a deposit at the EntryPoint to sponsor UserOperations.
  console.log(`${step}. Depositing ${PAYMASTER_DEPOSIT_AMOUNT} native tokens to EntryPoint for paymaster...`);
  const depositAmount = ethers.parseEther(PAYMASTER_DEPOSIT_AMOUNT);
  const entryPointContract = await ethers.getContractAt(
    ['function depositTo(address account) external payable'],
    ENTRYPOINT
  );
  const depositTx = await entryPointContract.depositTo(paymasterAddress, { value: depositAmount });
  await depositTx.wait();
  console.log(`   Deposited ${PAYMASTER_DEPOSIT_AMOUNT} to EntryPoint for paymaster`);
  step++;

  // 5. Save deployment
  const deployment = {
    network: networkName,
    chainId: network.config.chainId,
    deployer: deployer.address,
    treasury: treasuryAddress,
    contracts: {
      WazabiAccount: accountImplAddress,
      WazabiAccountFactory: factoryAddress,
      WazabiPaymaster: paymasterAddress,
      WazabiSettlement: settlementAddress,
    },
    tokens: networkTokens,
    entryPoint: ENTRYPOINT,
    paymasterDeposit: PAYMASTER_DEPOSIT_AMOUNT,
    timestamp: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(deploymentsDir, `${networkName}.json`),
    JSON.stringify(deployment, null, 2)
  );

  console.log(`\nDeployment saved to deployments/${networkName}.json`);
  console.log('\n=== DEPLOYMENT COMPLETE ===\n');
  console.log('Add these to your .env:');
  console.log(`ACCOUNT_FACTORY_${networkName.toUpperCase()}=${factoryAddress}`);
  console.log(`PAYMASTER_${networkName.toUpperCase()}=${paymasterAddress}`);
  console.log(`SETTLEMENT_${networkName.toUpperCase()}=${settlementAddress}`);
  console.log(`TREASURY_ADDRESS=${treasuryAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
