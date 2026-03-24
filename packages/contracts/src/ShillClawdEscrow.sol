// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ShillClawdEscrow {
    using SafeERC20 for IERC20;

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

    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event GigFunded(uint256 indexed gigId, address indexed advertiser, address indexed kol, uint256 amount);
    event GigDelivered(uint256 indexed gigId);
    event GigReleased(uint256 indexed gigId, address indexed kol, uint256 amount);
    event GigRefunded(uint256 indexed gigId, address indexed advertiser, uint256 amount);
    event GigDisputed(uint256 indexed gigId);
    event DisputeResolved(uint256 indexed gigId, bool kolWins);

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
        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminTransferred(oldAdmin, newAdmin);
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

        gigs[gigId] = Gig(advertiser, kolAddress, amount, workDeadline, reviewDeadline, 0, Status.Funded);

        // Permit frontrunning defense: if permit fails (already executed by
        // frontrunner), fall through to transferFrom using existing allowance.
        try usdcPermit.permit(advertiser, address(this), amount, permitDeadline, v, r, s) {} catch {}

        usdc.safeTransferFrom(advertiser, address(this), amount);
        emit GigFunded(gigId, advertiser, kolAddress, amount);
    }

    function markDelivered(uint256 gigId) external onlyAdmin {
        require(gigs[gigId].status == Status.Funded, "Not funded");
        gigs[gigId].status = Status.Delivered;
        emit GigDelivered(gigId);
    }

    function release(uint256 gigId) external onlyAdmin {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Delivered, "Not delivered");
        g.status = Status.Completed;
        usdc.safeTransfer(g.kol, g.amount);
        emit GigReleased(gigId, g.kol, g.amount);
    }

    // Anyone can call after review_deadline (cron backup)
    function autoRelease(uint256 gigId) external {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Delivered, "Not delivered");
        require(block.timestamp > g.reviewDeadline, "Review period active");
        g.status = Status.Completed;
        usdc.safeTransfer(g.kol, g.amount);
        emit GigReleased(gigId, g.kol, g.amount);
    }

    function refund(uint256 gigId) external onlyAdmin {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Funded, "Not funded");
        require(block.timestamp > g.workDeadline, "Work period active");
        g.status = Status.Expired;
        usdc.safeTransfer(g.advertiser, g.amount);
        emit GigRefunded(gigId, g.advertiser, g.amount);
    }

    // Anyone can call after work_deadline (cron backup)
    function autoRefund(uint256 gigId) external {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Funded, "Not funded");
        require(block.timestamp > g.workDeadline, "Work period active");
        g.status = Status.Expired;
        usdc.safeTransfer(g.advertiser, g.amount);
        emit GigRefunded(gigId, g.advertiser, g.amount);
    }

    // --- Dispute ---

    function markDisputed(uint256 gigId) external onlyAdmin {
        require(gigs[gigId].status == Status.Delivered, "Not delivered");
        gigs[gigId].status = Status.Disputed;
        gigs[gigId].disputedAt = block.timestamp;
        emit GigDisputed(gigId);
    }

    function resolveDispute(uint256 gigId, bool kolWins) external onlyAdmin {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Disputed, "Not disputed");
        if (kolWins) {
            g.status = Status.Completed;
            usdc.safeTransfer(g.kol, g.amount);
        } else {
            g.status = Status.Refunded;
            usdc.safeTransfer(g.advertiser, g.amount);
        }
        emit DisputeResolved(gigId, kolWins);
    }

    // Anyone can call after 7 days — auto-resolve in KOL's favor
    function autoResolveDispute(uint256 gigId) external {
        Gig storage g = gigs[gigId];
        require(g.status == Status.Disputed, "Not disputed");
        require(block.timestamp > g.disputedAt + DISPUTE_TIMEOUT, "Dispute period active");
        g.status = Status.Completed;
        usdc.safeTransfer(g.kol, g.amount);
        emit DisputeResolved(gigId, true);
    }
}
