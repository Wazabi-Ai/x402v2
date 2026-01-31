import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// Token addresses per network
const TOKENS: Record<string, Record<string, string>> = {
  bsc: {
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  },
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
};

const ENTRYPOINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  console.log(`\nDeploying to ${networkName} with account: ${deployer.address}`);
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
  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  console.log('2. Deploying WazabiPaymaster...');
  const WazabiPaymaster = await ethers.getContractFactory('WazabiPaymaster');
  const paymaster = await WazabiPaymaster.deploy(ENTRYPOINT, deployer.address, treasuryAddress);
  await paymaster.waitForDeployment();
  const paymasterAddress = await paymaster.getAddress();
  console.log(`   WazabiPaymaster: ${paymasterAddress}`);

  // 3. Configure paymaster with supported tokens
  const networkTokens = TOKENS[networkName] || {};
  for (const [symbol, address] of Object.entries(networkTokens)) {
    console.log(`3. Adding ${symbol} (${address}) to paymaster...`);
    const tx = await paymaster.addSupportedToken(address, ethers.parseUnits('1', 18)); // 1:1 initial ratio
    await tx.wait();
    console.log(`   ${symbol} added`);
  }

  // 4. Save deployment
  const deployment = {
    network: networkName,
    chainId: network.config.chainId,
    deployer: deployer.address,
    treasury: treasuryAddress,
    contracts: {
      WazabiAccount: accountImplAddress,
      WazabiAccountFactory: factoryAddress,
      WazabiPaymaster: paymasterAddress,
    },
    tokens: networkTokens,
    entryPoint: ENTRYPOINT,
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
