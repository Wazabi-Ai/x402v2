// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@account-abstraction/contracts/core/BasePaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WazabiPaymaster
 * @notice ERC-4337 Verifying Paymaster that sponsors gas in exchange for ERC-20 tokens.
 *         Enables agents to pay gas fees in USDC/USDT instead of native tokens (ETH/BNB).
 *
 * @dev Flow:
 *   1. Agent signs UserOp (e.g., transfer 10 USDC to recipient)
 *   2. Bundler submits UserOp to EntryPoint with this Paymaster address
 *   3. Paymaster validates agent has sufficient token balance
 *   4. EntryPoint executes the operation
 *   5. Paymaster pays gas in native token (BNB/ETH)
 *   6. Paymaster atomically deducts equivalent token amount from agent's wallet
 */
contract WazabiPaymaster is BasePaymaster {
    using SafeERC20 for IERC20;

    // ========================================================================
    // State Variables
    // ========================================================================

    /// @notice Supported ERC-20 tokens that can be used for gas payment
    mapping(address => bool) public supportedTokens;

    /// @notice Token price oracle (simplified: token/native price ratio * 1e18)
    mapping(address => uint256) public tokenPriceRatio;

    /// @notice Wazabi treasury address for fee collection
    address public treasury;

    /// @notice Maximum gas cost in token units the paymaster will sponsor
    uint256 public maxGasCostToken;

    /// @notice Gas overhead for paymaster operations (in gas units)
    uint256 public constant PAYMASTER_GAS_OVERHEAD = 50000;

    // ========================================================================
    // Events
    // ========================================================================

    event TokenAdded(address indexed token, uint256 priceRatio);
    event TokenRemoved(address indexed token);
    event PriceUpdated(address indexed token, uint256 newRatio);
    event GasSponsored(
        address indexed account,
        address indexed token,
        uint256 tokenAmount,
        uint256 gasUsed
    );
    event TreasuryUpdated(address indexed newTreasury);

    // ========================================================================
    // Constructor
    // ========================================================================

    /**
     * @param _entryPoint The ERC-4337 EntryPoint address
     * @param _owner The paymaster owner (Wazabi)
     * @param _treasury The treasury address for fee collection
     */
    constructor(
        IEntryPoint _entryPoint,
        address _owner,
        address _treasury
    ) BasePaymaster(_entryPoint) Ownable(_owner) {
        treasury = _treasury;
        maxGasCostToken = 10 * 1e18; // Max 10 USDC equivalent for gas
    }

    // ========================================================================
    // Paymaster Validation
    // ========================================================================

    /**
     * @notice Validate a UserOperation for gas sponsorship
     * @dev Called by EntryPoint during validation phase
     */
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /* userOpHash */,
        uint256 /* maxCost */
    ) internal view override returns (bytes memory context, uint256 validationData) {
        // Decode paymaster data: (address token, uint256 maxTokenCost)
        (address token, uint256 maxTokenCost) = abi.decode(
            userOp.paymasterAndData[20:],
            (address, uint256)
        );

        // Verify token is supported
        require(supportedTokens[token], "WazabiPaymaster: unsupported token");
        require(maxTokenCost <= maxGasCostToken, "WazabiPaymaster: gas cost too high");

        // Verify sender has sufficient token balance
        uint256 balance = IERC20(token).balanceOf(userOp.sender);
        require(balance >= maxTokenCost, "WazabiPaymaster: insufficient token balance");

        // Verify sender has approved paymaster to spend tokens
        uint256 allowance = IERC20(token).allowance(userOp.sender, address(this));
        require(allowance >= maxTokenCost, "WazabiPaymaster: insufficient allowance");

        // Return context for postOp
        context = abi.encode(userOp.sender, token, maxTokenCost);
        validationData = 0; // Valid
    }

    /**
     * @notice Post-operation: deduct gas cost from user's token balance
     * @dev Called by EntryPoint after execution
     */
    function _postOp(
        PostOpMode /* mode */,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 /* actualUserOpFeePerGas */
    ) internal override {
        (address account, address token, ) = abi.decode(
            context,
            (address, address, uint256)
        );

        // Calculate token cost from gas cost
        uint256 priceRatio = tokenPriceRatio[token];
        require(priceRatio > 0, "WazabiPaymaster: no price set");

        // tokenCost = gasCost * priceRatio / 1e18
        uint256 totalGas = actualGasCost + (PAYMASTER_GAS_OVERHEAD * tx.gasprice);
        uint256 tokenCost = (totalGas * priceRatio) / 1e18;

        // Transfer tokens from account to paymaster
        IERC20(token).safeTransferFrom(account, address(this), tokenCost);

        emit GasSponsored(account, token, tokenCost, actualGasCost);
    }

    // ========================================================================
    // Admin Functions
    // ========================================================================

    /**
     * @notice Add a supported token for gas payment
     * @param token The token contract address
     * @param priceRatio The token/native price ratio (token per native * 1e18)
     */
    function addSupportedToken(
        address token,
        uint256 priceRatio
    ) external onlyOwner {
        require(token != address(0), "WazabiPaymaster: zero address");
        require(priceRatio > 0, "WazabiPaymaster: zero price");

        supportedTokens[token] = true;
        tokenPriceRatio[token] = priceRatio;

        emit TokenAdded(token, priceRatio);
    }

    /**
     * @notice Remove a supported token
     */
    function removeSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = false;
        delete tokenPriceRatio[token];
        emit TokenRemoved(token);
    }

    /**
     * @notice Update token price ratio
     */
    function updatePriceRatio(
        address token,
        uint256 newRatio
    ) external onlyOwner {
        require(supportedTokens[token], "WazabiPaymaster: unsupported token");
        tokenPriceRatio[token] = newRatio;
        emit PriceUpdated(token, newRatio);
    }

    /**
     * @notice Update treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "WazabiPaymaster: zero address");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /**
     * @notice Update maximum gas cost in token units
     */
    function setMaxGasCostToken(uint256 _maxGasCost) external onlyOwner {
        maxGasCostToken = _maxGasCost;
    }

    /**
     * @notice Withdraw tokens collected from gas payments
     */
    function withdrawToken(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Withdraw native tokens (for gas funding)
     */
    function withdrawNative(address payable to, uint256 amount) external onlyOwner {
        (bool success, ) = to.call{value: amount}("");
        require(success, "WazabiPaymaster: withdraw failed");
    }

    // ========================================================================
    // Receive native tokens for gas
    // ========================================================================

    receive() external payable {}
}
