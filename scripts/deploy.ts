import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// Wazabi treasury address (fee collection)
const WAZABI_TREASURY = '0x1b4F633B1FC5FC26Fb8b722b2373B3d4D71aCaeB';

// Default fee in basis points (50 = 0.5%)
const DEFAULT_FEE_BPS = 50;

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;
  const treasuryAddress = process.env.TREASURY_ADDRESS || WAZABI_TREASURY;

  console.log(`\nDeploying to ${networkName} with account: ${deployer.address}`);
  console.log(`Treasury: ${treasuryAddress}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // 1. Deploy WazabiSettlement (non-custodial x402 settlement with fee splitting)
  const feeBps = parseInt(process.env.FEE_BPS || String(DEFAULT_FEE_BPS));
  console.log(`1. Deploying WazabiSettlement (treasury=${treasuryAddress}, feeBps=${feeBps})...`);
  const WazabiSettlement = await ethers.getContractFactory('WazabiSettlement');
  const settlement = await WazabiSettlement.deploy(treasuryAddress, feeBps);
  await settlement.waitForDeployment();
  const settlementAddress = await settlement.getAddress();
  console.log(`   WazabiSettlement: ${settlementAddress}`);

  // 2. Save deployment
  const deployment = {
    network: networkName,
    chainId: network.config.chainId,
    deployer: deployer.address,
    treasury: treasuryAddress,
    contracts: {
      WazabiSettlement: settlementAddress,
    },
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
  console.log(`SETTLEMENT_${networkName.toUpperCase()}=${settlementAddress}`);
  console.log(`TREASURY_ADDRESS=${treasuryAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
