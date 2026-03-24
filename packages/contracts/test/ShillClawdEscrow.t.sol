// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ShillClawdEscrow.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock USDC with permit support
contract MockUSDC is ERC20 {
    mapping(address => uint256) private _nonces;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // Simplified permit for testing (skips signature verification)
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 /*deadline*/,
        uint8 /*v*/,
        bytes32 /*r*/,
        bytes32 /*s*/
    ) external {
        _approve(owner, spender, value);
        _nonces[owner]++;
    }

    function nonces(address owner) external view returns (uint256) {
        return _nonces[owner];
    }

    function DOMAIN_SEPARATOR() external pure returns (bytes32) {
        return bytes32(0);
    }
}

contract ShillClawdEscrowTest is Test {
    ShillClawdEscrow public escrow;
    MockUSDC public usdc;

    address admin = makeAddr("admin");
    address advertiser = makeAddr("advertiser");
    address kol = makeAddr("kol");
    address anyone = makeAddr("anyone");

    uint256 constant GIG_ID = 1;
    uint256 constant AMOUNT = 3_000_000; // 3 USDC
    uint256 constant WORK_DEADLINE_OFFSET = 7 days;
    uint256 constant REVIEW_DEADLINE_OFFSET = 10 days; // work + 3 days

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new ShillClawdEscrow(address(usdc), admin);

        // Fund advertiser
        usdc.mint(advertiser, 100_000_000); // 100 USDC
    }

    // --- Helpers ---

    function _deposit(uint256 gigId) internal {
        uint256 workDeadline = block.timestamp + WORK_DEADLINE_OFFSET;
        uint256 reviewDeadline = block.timestamp + REVIEW_DEADLINE_OFFSET;

        vm.prank(admin);
        escrow.depositWithPermit(
            gigId, advertiser, kol, AMOUNT,
            workDeadline, reviewDeadline,
            block.timestamp + 1 hours,
            28, bytes32(0), bytes32(0)
        );
    }

    function _depositAndDeliver(uint256 gigId) internal {
        _deposit(gigId);
        vm.prank(admin);
        escrow.markDelivered(gigId);
    }

    function _depositDeliverAndDispute(uint256 gigId) internal {
        _depositAndDeliver(gigId);
        vm.prank(admin);
        escrow.markDisputed(gigId);
    }

    // --- Constructor ---

    function test_constructor() public view {
        assertEq(escrow.admin(), admin);
        assertEq(address(escrow.usdc()), address(usdc));
    }

    // --- transferAdmin ---

    function test_transferAdmin() public {
        address newAdmin = makeAddr("newAdmin");
        vm.prank(admin);
        escrow.transferAdmin(newAdmin);
        assertEq(escrow.admin(), newAdmin);
    }

    function test_transferAdmin_revert_notAdmin() public {
        vm.prank(anyone);
        vm.expectRevert("Not admin");
        escrow.transferAdmin(anyone);
    }

    function test_transferAdmin_revert_zeroAddress() public {
        vm.prank(admin);
        vm.expectRevert("Zero address");
        escrow.transferAdmin(address(0));
    }

    // --- depositWithPermit ---

    function test_deposit() public {
        _deposit(GIG_ID);

        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        assertEq(usdc.balanceOf(advertiser), 100_000_000 - AMOUNT);

        (address adv, address k, uint256 amt,,,,) = escrow.gigs(GIG_ID);
        assertEq(adv, advertiser);
        assertEq(k, kol);
        assertEq(amt, AMOUNT);
    }

    function test_deposit_revert_notAdmin() public {
        vm.prank(anyone);
        vm.expectRevert("Not admin");
        escrow.depositWithPermit(
            GIG_ID, advertiser, kol, AMOUNT,
            block.timestamp + WORK_DEADLINE_OFFSET,
            block.timestamp + REVIEW_DEADLINE_OFFSET,
            block.timestamp + 1 hours,
            28, bytes32(0), bytes32(0)
        );
    }

    function test_deposit_revert_duplicate() public {
        _deposit(GIG_ID);

        vm.prank(admin);
        vm.expectRevert("Gig exists");
        escrow.depositWithPermit(
            GIG_ID, advertiser, kol, AMOUNT,
            block.timestamp + WORK_DEADLINE_OFFSET,
            block.timestamp + REVIEW_DEADLINE_OFFSET,
            block.timestamp + 1 hours,
            28, bytes32(0), bytes32(0)
        );
    }

    function test_deposit_permitFrontrunning() public {
        // Simulate: someone already called permit, so our permit call would fail.
        // Pre-approve from advertiser to escrow directly.
        vm.prank(advertiser);
        usdc.approve(address(escrow), AMOUNT);

        // depositWithPermit should still succeed via existing allowance
        // (permit try-catch catches the revert from double-permit)
        vm.prank(admin);
        escrow.depositWithPermit(
            GIG_ID, advertiser, kol, AMOUNT,
            block.timestamp + WORK_DEADLINE_OFFSET,
            block.timestamp + REVIEW_DEADLINE_OFFSET,
            block.timestamp + 1 hours,
            28, bytes32(0), bytes32(0)
        );

        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    // --- markDelivered ---

    function test_markDelivered() public {
        _deposit(GIG_ID);

        vm.prank(admin);
        escrow.markDelivered(GIG_ID);

        (,,,,,, ShillClawdEscrow.Status status) = escrow.gigs(GIG_ID);
        assertEq(uint8(status), uint8(ShillClawdEscrow.Status.Delivered));
    }

    function test_markDelivered_revert_notFunded() public {
        vm.prank(admin);
        vm.expectRevert("Not funded");
        escrow.markDelivered(GIG_ID);
    }

    // --- release (admin) ---

    function test_release() public {
        _depositAndDeliver(GIG_ID);

        uint256 kolBalBefore = usdc.balanceOf(kol);

        vm.prank(admin);
        escrow.release(GIG_ID);

        assertEq(usdc.balanceOf(kol), kolBalBefore + AMOUNT);
        (,,,,,, ShillClawdEscrow.Status status) = escrow.gigs(GIG_ID);
        assertEq(uint8(status), uint8(ShillClawdEscrow.Status.Completed));
    }

    function test_release_revert_notDelivered() public {
        _deposit(GIG_ID);

        vm.prank(admin);
        vm.expectRevert("Not delivered");
        escrow.release(GIG_ID);
    }

    // --- autoRelease ---

    function test_autoRelease() public {
        _depositAndDeliver(GIG_ID);

        // Warp past review deadline
        vm.warp(block.timestamp + REVIEW_DEADLINE_OFFSET + 1);

        uint256 kolBalBefore = usdc.balanceOf(kol);

        vm.prank(anyone); // anyone can call
        escrow.autoRelease(GIG_ID);

        assertEq(usdc.balanceOf(kol), kolBalBefore + AMOUNT);
        (,,,,,, ShillClawdEscrow.Status status) = escrow.gigs(GIG_ID);
        assertEq(uint8(status), uint8(ShillClawdEscrow.Status.Completed));
    }

    function test_autoRelease_revert_reviewPeriodActive() public {
        _depositAndDeliver(GIG_ID);

        vm.prank(anyone);
        vm.expectRevert("Review period active");
        escrow.autoRelease(GIG_ID);
    }

    // --- refund (admin) ---

    function test_refund() public {
        _deposit(GIG_ID);

        // Warp past work deadline
        vm.warp(block.timestamp + WORK_DEADLINE_OFFSET + 1);

        uint256 advBalBefore = usdc.balanceOf(advertiser);

        vm.prank(admin);
        escrow.refund(GIG_ID);

        assertEq(usdc.balanceOf(advertiser), advBalBefore + AMOUNT);
        (,,,,,, ShillClawdEscrow.Status status) = escrow.gigs(GIG_ID);
        assertEq(uint8(status), uint8(ShillClawdEscrow.Status.Expired));
    }

    function test_refund_revert_workPeriodActive() public {
        _deposit(GIG_ID);

        vm.prank(admin);
        vm.expectRevert("Work period active");
        escrow.refund(GIG_ID);
    }

    // --- autoRefund ---

    function test_autoRefund() public {
        _deposit(GIG_ID);

        vm.warp(block.timestamp + WORK_DEADLINE_OFFSET + 1);

        uint256 advBalBefore = usdc.balanceOf(advertiser);

        vm.prank(anyone);
        escrow.autoRefund(GIG_ID);

        assertEq(usdc.balanceOf(advertiser), advBalBefore + AMOUNT);
        (,,,,,, ShillClawdEscrow.Status status) = escrow.gigs(GIG_ID);
        assertEq(uint8(status), uint8(ShillClawdEscrow.Status.Expired));
    }

    function test_autoRefund_revert_workPeriodActive() public {
        _deposit(GIG_ID);

        vm.prank(anyone);
        vm.expectRevert("Work period active");
        escrow.autoRefund(GIG_ID);
    }

    // --- markDisputed ---

    function test_markDisputed() public {
        _depositAndDeliver(GIG_ID);

        vm.prank(admin);
        escrow.markDisputed(GIG_ID);

        (,,,,, uint256 disputedAt, ShillClawdEscrow.Status status) = escrow.gigs(GIG_ID);
        assertEq(uint8(status), uint8(ShillClawdEscrow.Status.Disputed));
        assertEq(disputedAt, block.timestamp);
    }

    function test_markDisputed_revert_notDelivered() public {
        _deposit(GIG_ID);

        vm.prank(admin);
        vm.expectRevert("Not delivered");
        escrow.markDisputed(GIG_ID);
    }

    // --- resolveDispute ---

    function test_resolveDispute_kolWins() public {
        _depositDeliverAndDispute(GIG_ID);

        uint256 kolBalBefore = usdc.balanceOf(kol);

        vm.prank(admin);
        escrow.resolveDispute(GIG_ID, true);

        assertEq(usdc.balanceOf(kol), kolBalBefore + AMOUNT);
        (,,,,,, ShillClawdEscrow.Status status) = escrow.gigs(GIG_ID);
        assertEq(uint8(status), uint8(ShillClawdEscrow.Status.Completed));
    }

    function test_resolveDispute_advertiserWins() public {
        _depositDeliverAndDispute(GIG_ID);

        uint256 advBalBefore = usdc.balanceOf(advertiser);

        vm.prank(admin);
        escrow.resolveDispute(GIG_ID, false);

        assertEq(usdc.balanceOf(advertiser), advBalBefore + AMOUNT);
        (,,,,,, ShillClawdEscrow.Status status) = escrow.gigs(GIG_ID);
        assertEq(uint8(status), uint8(ShillClawdEscrow.Status.Refunded));
    }

    function test_resolveDispute_revert_notDisputed() public {
        _depositAndDeliver(GIG_ID);

        vm.prank(admin);
        vm.expectRevert("Not disputed");
        escrow.resolveDispute(GIG_ID, true);
    }

    // --- autoResolveDispute ---

    function test_autoResolveDispute() public {
        _depositDeliverAndDispute(GIG_ID);

        // Warp past 7-day dispute timeout
        vm.warp(block.timestamp + 7 days + 1);

        uint256 kolBalBefore = usdc.balanceOf(kol);

        vm.prank(anyone); // anyone can call
        escrow.autoResolveDispute(GIG_ID);

        assertEq(usdc.balanceOf(kol), kolBalBefore + AMOUNT);
        (,,,,,, ShillClawdEscrow.Status status) = escrow.gigs(GIG_ID);
        assertEq(uint8(status), uint8(ShillClawdEscrow.Status.Completed));
    }

    function test_autoResolveDispute_revert_disputePeriodActive() public {
        _depositDeliverAndDispute(GIG_ID);

        vm.prank(anyone);
        vm.expectRevert("Dispute period active");
        escrow.autoResolveDispute(GIG_ID);
    }

    function test_autoResolveDispute_revert_notDisputed() public {
        _depositAndDeliver(GIG_ID);

        vm.prank(anyone);
        vm.expectRevert("Not disputed");
        escrow.autoResolveDispute(GIG_ID);
    }

    // --- Full lifecycle: happy path ---

    function test_fullLifecycle_happyPath() public {
        // Deposit
        _deposit(GIG_ID);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);

        // Deliver
        vm.prank(admin);
        escrow.markDelivered(GIG_ID);

        // Approve (release)
        vm.prank(admin);
        escrow.release(GIG_ID);

        assertEq(usdc.balanceOf(kol), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // --- Full lifecycle: expired (no delivery) ---

    function test_fullLifecycle_expired() public {
        _deposit(GIG_ID);

        uint256 advBalBefore = usdc.balanceOf(advertiser);

        vm.warp(block.timestamp + WORK_DEADLINE_OFFSET + 1);
        vm.prank(admin);
        escrow.refund(GIG_ID);

        assertEq(usdc.balanceOf(advertiser), advBalBefore + AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // --- Full lifecycle: dispute → KOL wins ---

    function test_fullLifecycle_disputeKolWins() public {
        _depositDeliverAndDispute(GIG_ID);

        vm.prank(admin);
        escrow.resolveDispute(GIG_ID, true);

        assertEq(usdc.balanceOf(kol), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // --- Full lifecycle: dispute → auto-resolve after 7 days ---

    function test_fullLifecycle_disputeAutoResolve() public {
        _depositDeliverAndDispute(GIG_ID);

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(anyone);
        escrow.autoResolveDispute(GIG_ID);

        assertEq(usdc.balanceOf(kol), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // --- Multiple gigs ---

    function test_multipleGigs() public {
        address kol2 = makeAddr("kol2");

        _deposit(1);

        vm.prank(admin);
        escrow.depositWithPermit(
            2, advertiser, kol2, 5_000_000,
            block.timestamp + WORK_DEADLINE_OFFSET,
            block.timestamp + REVIEW_DEADLINE_OFFSET,
            block.timestamp + 1 hours,
            28, bytes32(0), bytes32(0)
        );

        assertEq(usdc.balanceOf(address(escrow)), AMOUNT + 5_000_000);

        // Release gig 1
        vm.startPrank(admin);
        escrow.markDelivered(1);
        escrow.release(1);
        vm.stopPrank();

        assertEq(usdc.balanceOf(kol), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 5_000_000);

        // Refund gig 2
        vm.warp(block.timestamp + WORK_DEADLINE_OFFSET + 1);
        vm.prank(admin);
        escrow.refund(2);

        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // --- Status cannot go backwards ---

    function test_cannotReleaseAfterCompleted() public {
        _depositAndDeliver(GIG_ID);
        vm.prank(admin);
        escrow.release(GIG_ID);

        vm.prank(admin);
        vm.expectRevert("Not delivered");
        escrow.release(GIG_ID);
    }

    function test_cannotRefundAfterExpired() public {
        _deposit(GIG_ID);
        vm.warp(block.timestamp + WORK_DEADLINE_OFFSET + 1);
        vm.prank(admin);
        escrow.refund(GIG_ID);

        vm.prank(admin);
        vm.expectRevert("Not funded");
        escrow.refund(GIG_ID);
    }
}
