// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// =============================================================================
// Permit2 Interface (Uniswap canonical contract)
// Deployed at 0x000000000022D473030F116dDEE9F6B43aC78BA3 on all EVM chains
// =============================================================================

interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitBatchTransferFrom {
        TokenPermissions[] permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitWitnessTransferFrom(
        PermitBatchTransferFrom memory permit,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external;
}

// =============================================================================
// ERC-3009 Interface (USDC transferWithAuthorization)
// =============================================================================

interface IERC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

// =============================================================================
// WazabiSettlement — Non-custodial x402 settlement with fee splitting
// =============================================================================

/// @title WazabiSettlement
/// @notice Settles x402 payments non-custodially with protocol fee splitting.
///
/// Two settlement paths:
///
///   1. Permit2 (any ERC-20): Payer signs a Permit2 batch witness authorization.
///      Funds move directly from payer to recipient (net) and treasury (fee)
///      in a single atomic transaction. The contract never holds funds.
///
///   2. ERC-3009 (USDC): Payer signs a transferWithAuthorization to this contract.
///      Contract receives the gross amount and immediately splits it to recipient
///      and treasury in the same transaction.
///
/// In both paths, the facilitator pays gas but cannot redirect funds.
/// The payer's signature cryptographically commits to the recipient and fee rate.
contract WazabiSettlement is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @notice Canonical Permit2 contract (same address on all EVM chains)
    IPermit2 public constant PERMIT2 =
        IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    /// @notice EIP-712 witness type string for Permit2 signing.
    ///         Format: "<WitnessType> witness)<WitnessTypeDefinition>"
    string public constant WITNESS_TYPE_STRING =
        "SettlementWitness witness)SettlementWitness(address recipient,uint256 feeBps)";

    /// @notice EIP-712 witness type hash
    bytes32 public constant WITNESS_TYPEHASH =
        keccak256("SettlementWitness(address recipient,uint256 feeBps)");

    /// @notice Maximum fee: 10% (1000 bps)
    uint256 public constant MAX_FEE_BPS = 1000;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Treasury address that receives protocol fees
    address public treasury;

    /// @notice Protocol fee in basis points (50 = 0.5%)
    uint256 public feeBps;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Settlement(
        address indexed payer,
        address indexed recipient,
        address indexed token,
        uint256 grossAmount,
        uint256 netAmount,
        uint256 fee,
        bytes32 settlementId
    );

    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event FeeBpsUpdated(uint256 oldFeeBps, uint256 newFeeBps);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error FeeTooHigh(uint256 feeBps);
    error FeeMismatch(uint256 contractFee, uint256 signedFee);
    error InvalidPermitLength();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        address _treasury,
        uint256 _feeBps
    ) Ownable(msg.sender) {
        if (_treasury == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh(_feeBps);
        treasury = _treasury;
        feeBps = _feeBps;
    }

    // =========================================================================
    // Path 1: Permit2 Settlement (any ERC-20)
    // =========================================================================

    /// @notice Settle a payment using Permit2 batch with witness.
    ///
    /// The payer signs a PermitBatchWitnessTransferFrom with:
    ///   - permitted[0] = { token, netAmount }   → goes to recipient
    ///   - permitted[1] = { token, feeAmount }   → goes to treasury
    ///   - witness = { recipient, feeBps }        → commits destination + fee rate
    ///
    /// The facilitator calls this function and pays gas. Funds move directly
    /// from payer's wallet to recipient and treasury via Permit2 — the contract
    /// never holds the tokens.
    ///
    /// @param permit   The Permit2 batch transfer authorization (signed by payer)
    /// @param payer    The address that signed the permit (token owner)
    /// @param witness  The settlement witness (recipient + feeBps, committed in signature)
    /// @param signature The payer's EIP-712 signature over the permit + witness
    function settle(
        IPermit2.PermitBatchTransferFrom memory permit,
        address payer,
        SettlementWitness calldata witness,
        bytes calldata signature
    ) external nonReentrant {
        if (witness.recipient == address(0)) revert ZeroAddress();
        if (witness.feeBps != feeBps) revert FeeMismatch(feeBps, witness.feeBps);
        if (permit.permitted.length != 2) revert InvalidPermitLength();

        uint256 netAmount = permit.permitted[0].amount;
        uint256 feeAmount = permit.permitted[1].amount;
        uint256 grossAmount = netAmount + feeAmount;
        address token = permit.permitted[0].token;

        // Build transfer destinations — enforcing witness.recipient
        IPermit2.SignatureTransferDetails[] memory transfers =
            new IPermit2.SignatureTransferDetails[](2);
        transfers[0] = IPermit2.SignatureTransferDetails({
            to: witness.recipient,
            requestedAmount: netAmount
        });
        transfers[1] = IPermit2.SignatureTransferDetails({
            to: treasury,
            requestedAmount: feeAmount
        });

        // Compute witness hash (must match what payer signed)
        bytes32 witnessHash = keccak256(
            abi.encode(WITNESS_TYPEHASH, witness.recipient, witness.feeBps)
        );

        // Execute via Permit2 — tokens move directly from payer
        PERMIT2.permitWitnessTransferFrom(
            permit,
            transfers,
            payer,
            witnessHash,
            WITNESS_TYPE_STRING,
            signature
        );

        emit Settlement(
            payer,
            witness.recipient,
            token,
            grossAmount,
            netAmount,
            feeAmount,
            keccak256(abi.encodePacked(payer, witness.recipient, token, grossAmount, block.number))
        );
    }

    // =========================================================================
    // Path 2: ERC-3009 Settlement (USDC)
    // =========================================================================

    /// @notice Settle a USDC payment using ERC-3009 transferWithAuthorization.
    ///
    /// The payer signs a transferWithAuthorization to this contract for the
    /// gross amount. The contract receives the tokens and immediately splits
    /// them: net to recipient, fee to treasury — all in one atomic transaction.
    ///
    /// This path requires no Permit2 approval (USDC natively supports ERC-3009).
    ///
    /// @param token        The ERC-3009 compatible token (e.g., USDC)
    /// @param payer        The address transferring tokens
    /// @param recipient    The intended payment recipient
    /// @param grossAmount  Total amount (net + fee will be calculated)
    /// @param validAfter   ERC-3009 validity start time
    /// @param validBefore  ERC-3009 validity end time
    /// @param nonce        ERC-3009 nonce (bytes32, randomly generated)
    /// @param v            Signature v
    /// @param r            Signature r
    /// @param s            Signature s
    function settleWithAuthorization(
        address token,
        address payer,
        address recipient,
        uint256 grossAmount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();

        uint256 feeAmount = (grossAmount * feeBps) / 10000;
        uint256 netAmount = grossAmount - feeAmount;

        // Pull gross amount from payer to this contract via ERC-3009
        IERC3009(token).transferWithAuthorization(
            payer,
            address(this),
            grossAmount,
            validAfter,
            validBefore,
            nonce,
            v, r, s
        );

        // Immediately split — never hold funds beyond this tx
        IERC20(token).safeTransfer(recipient, netAmount);
        IERC20(token).safeTransfer(treasury, feeAmount);

        emit Settlement(
            payer,
            recipient,
            token,
            grossAmount,
            netAmount,
            feeAmount,
            keccak256(abi.encodePacked(payer, recipient, token, grossAmount, block.number))
        );
    }

    // =========================================================================
    // Witness struct (used in Permit2 EIP-712 signing)
    // =========================================================================

    /// @notice Settlement witness data included in the payer's Permit2 signature.
    ///         Cryptographically commits the payer to a specific recipient and fee rate.
    struct SettlementWitness {
        address recipient;
        uint256 feeBps;
    }

    // =========================================================================
    // Admin
    // =========================================================================

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh(_feeBps);
        emit FeeBpsUpdated(feeBps, _feeBps);
        feeBps = _feeBps;
    }
}
