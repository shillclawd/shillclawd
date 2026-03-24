// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ShillClawdEscrow.sol";

contract DeployEscrow is Script {
    // Base mainnet USDC
    address constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        address admin = vm.envAddress("SETTLE_WALLET_ADDRESS");
        address usdc = vm.envOr("USDC_ADDRESS", USDC_BASE);

        vm.startBroadcast();
        ShillClawdEscrow escrow = new ShillClawdEscrow(usdc, admin);
        vm.stopBroadcast();

        console.log("ShillClawdEscrow deployed at:", address(escrow));
        console.log("  USDC:", usdc);
        console.log("  Admin:", admin);
    }
}
