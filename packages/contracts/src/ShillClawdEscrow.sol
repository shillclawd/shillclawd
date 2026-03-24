// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

contract ShillClawdEscrow {
    enum Status { Empty, Funded, Delivered, Completed, Refunded, Disputed, Expired }

    uint256 public constant DISPUTE_TIMEOUT = 7 days;

    struct Gig {
        address advertiser;
        address kol;
        uint256 amount;
        uint256 workDeadline;
        uint256 reviewDeadline;
        uint256 disputedAt;
        Status status;
    }

    address public admin;
    IERC20 public usdc;
    IERC20Permit public usdcPermit;
    mapping(uint256 => Gig) public gigs;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    constructor(address _usdc, address _admin) {
        usdc = IERC20(_usdc);
        usdcPermit = IERC20Permit(_usdc);
        admin = _admin;
    }

    // --- Admin management ---

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Zero address");
        admin = newAdmin;
    }

    // --- Core lifecycle ---

    function depositWithPermit(
        uint256 gigId,
        address advertiser,
        address kolAddress,
        uint256 amount,
        uint256 workDeadline,
        uint256 reviewDeadline,
        uint256 permitDeadline,
        uint8 v, bytes32 r, bytes32 s
    ) external onlyAdmin {
        require(gigs[gigId].status == Status.Empty, "Gig exists");

        // Permit frontrunning defense: if permit fails (already executed by
        // frontrunner), fall through to transferFrom using existing allowance.
        try usdcPermit.permit(advertiser, address(this), amount, permitDeadline, v, r, s) {} catch {}

        usdc.transferFrom(advertiser, address(this), amount);
        gigs[gigId] = Gig(advertiser, kolAddress, amount, workDeadline, reviewDeadline, 0, Status.Funded);
    }

    function markDelivered(uint256 gigId) external onlyAdmin {
        require(gigs[gigId].status == Status.Funded, "Not funded");
        gigs[gigId].status = Status.Delivered;
    }

    function release(uint256 gigId) external onlyAdmin {
        require(gigs[gigId].status == Status.Delivered, "Not delivered");
        Gig storage g = gigs[gigId];
        usdc.transfer(g.kol, g.amount);
        g.status = Status.Completed;
    }

    // Anyone can call after review_deadline (cron backup)
    function autoRelease(uint256 gigId) external {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Delivered, "Not delivered");
        require(block.timestamp > g.reviewDeadline, "Review period active");
        usdc.transfer(g.kol, g.amount);
        g.status = Status.Completed;
    }

    function refund(uint256 gigId) external onlyAdmin {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Funded, "Not funded");
        require(block.timestamp > g.workDeadline, "Work period active");
        usdc.transfer(g.advertiser, g.amount);
        g.status = Status.Expired;
    }

    // Anyone can call after work_deadline (cron backup)
    function autoRefund(uint256 gigId) external {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Funded, "Not funded");
        require(block.timestamp > g.workDeadline, "Work period active");
        usdc.transfer(g.advertiser, g.amount);
        g.status = Status.Expired;
    }

    // --- Dispute ---

    function markDisputed(uint256 gigId) external onlyAdmin {
        require(gigs[gigId].status == Status.Delivered, "Not delivered");
        gigs[gigId].status = Status.Disputed;
        gigs[gigId].disputedAt = block.timestamp;
    }

    function resolveDispute(uint256 gigId, bool kolWins) external onlyAdmin {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Disputed, "Not disputed");
        if (kolWins) {
            usdc.transfer(g.kol, g.amount);
            g.status = Status.Completed;
        } else {
            usdc.transfer(g.advertiser, g.amount);
            g.status = Status.Refunded;
        }
    }

    // Anyone can call after 7 days — auto-resolve in KOL's favor
    function autoResolveDispute(uint256 gigId) external {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Disputed, "Not disputed");
        require(block.timestamp > g.disputedAt + DISPUTE_TIMEOUT, "Dispute period active");
        usdc.transfer(g.kol, g.amount);
        g.status = Status.Completed;
    }
}
