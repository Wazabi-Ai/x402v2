// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title WazabiAccount
 * @notice ERC-4337 smart contract wallet for Wazabi x402 agent identities.
 *         Supports session keys with spending limits for autonomous agent operation.
 * @dev Extends SimpleAccount pattern with session key management.
 *      Deployed via WazabiAccountFactory using CREATE2 for deterministic addresses.
 */
contract WazabiAccount is BaseAccount, Initializable, UUPSUpgradeable {
    using ECDSA for bytes32;

    // ========================================================================
    // State Variables
    // ========================================================================

    /// @notice The ERC-4337 EntryPoint contract
    IEntryPoint private immutable _entryPoint;

    /// @notice The owner address (recovery key)
    address public owner;

    /// @notice The agent handle (e.g., "molty.wazabi-x402")
    string public handle;

    /// @notice Session key configuration
    struct SessionKey {
        uint256 maxPerTx;      // Max token amount per transaction
        uint256 dailyLimit;    // Daily spending limit
        uint256 dailySpent;    // Amount spent today
        uint256 lastResetDay;  // Day counter for daily reset
        uint256 validUntil;    // Expiration timestamp
        bool active;           // Whether the key is active
    }

    /// @notice Mapping of session key address to configuration
    mapping(address => SessionKey) public sessionKeys;

    /// @notice List of active session key addresses
    address[] public sessionKeyList;

    // ========================================================================
    // Events
    // ========================================================================

    event WazabiAccountInitialized(
        address indexed owner,
        string handle,
        address indexed entryPoint
    );
    event SessionKeyAdded(
        address indexed key,
        uint256 maxPerTx,
        uint256 dailyLimit,
        uint256 validUntil
    );
    event SessionKeyRevoked(address indexed key);
    event TransactionExecuted(
        address indexed dest,
        uint256 value,
        bytes data,
        address indexed executor
    );

    // ========================================================================
    // Modifiers
    // ========================================================================

    modifier onlyOwner() {
        require(
            msg.sender == owner || msg.sender == address(this),
            "WazabiAccount: not owner"
        );
        _;
    }

    modifier onlyEntryPointOrOwner() {
        require(
            msg.sender == address(entryPoint()) || msg.sender == owner || msg.sender == address(this),
            "WazabiAccount: not authorized"
        );
        _;
    }

    // ========================================================================
    // Constructor & Initialization
    // ========================================================================

    constructor(IEntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
        _disableInitializers();
    }

    /**
     * @notice Initialize the account with owner and handle
     * @param _owner The owner address (recovery key)
     * @param _sessionKey Initial session key address
     * @param _handle The agent handle (e.g., "molty.wazabi-x402")
     */
    function initialize(
        address _owner,
        address _sessionKey,
        string calldata _handle
    ) public initializer {
        owner = _owner;
        handle = _handle;

        // Set up initial session key with default limits
        if (_sessionKey != address(0)) {
            sessionKeys[_sessionKey] = SessionKey({
                maxPerTx: 1000 * 1e18,     // 1000 USDC max per tx
                dailyLimit: 10000 * 1e18,   // 10,000 USDC daily limit
                dailySpent: 0,
                lastResetDay: block.timestamp / 1 days,
                validUntil: block.timestamp + 365 days,
                active: true
            });
            sessionKeyList.push(_sessionKey);

            emit SessionKeyAdded(
                _sessionKey,
                1000 * 1e18,
                10000 * 1e18,
                block.timestamp + 365 days
            );
        }

        emit WazabiAccountInitialized(_owner, _handle, address(_entryPoint));
    }

    // ========================================================================
    // ERC-4337 BaseAccount Implementation
    // ========================================================================

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    /**
     * @notice Validate a UserOperation signature
     * @dev Supports both owner signatures and session key signatures
     */
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view override returns (uint256 validationData) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        address recovered = hash.recover(userOp.signature);

        // Check if signer is owner
        if (recovered == owner) {
            return 0; // Valid, no time range
        }

        // Check if signer is an active session key
        SessionKey storage sk = sessionKeys[recovered];
        if (sk.active && block.timestamp <= sk.validUntil) {
            return 0; // Valid session key
        }

        return SIG_VALIDATION_FAILED;
    }

    // ========================================================================
    // Execution Functions
    // ========================================================================

    /**
     * @notice Execute a call from this account
     * @param dest Target address
     * @param value ETH/BNB value to send
     * @param data Calldata for the call
     */
    function execute(
        address dest,
        uint256 value,
        bytes calldata data
    ) external onlyEntryPointOrOwner returns (bytes memory) {
        emit TransactionExecuted(dest, value, data, msg.sender);
        return _call(dest, value, data);
    }

    /**
     * @notice Execute a batch of calls
     * @param dests Target addresses
     * @param values ETH/BNB values to send
     * @param datas Calldata arrays
     */
    function executeBatch(
        address[] calldata dests,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external onlyEntryPointOrOwner {
        require(
            dests.length == values.length && dests.length == datas.length,
            "WazabiAccount: array length mismatch"
        );
        for (uint256 i = 0; i < dests.length; i++) {
            _call(dests[i], values[i], datas[i]);
        }
    }

    // ========================================================================
    // Session Key Management
    // ========================================================================

    /**
     * @notice Add a new session key
     * @param key The session key address
     * @param maxPerTx Maximum amount per transaction
     * @param dailyLimit Daily spending limit
     * @param validUntil Expiration timestamp
     */
    function addSessionKey(
        address key,
        uint256 maxPerTx,
        uint256 dailyLimit,
        uint256 validUntil
    ) external onlyOwner {
        require(key != address(0), "WazabiAccount: zero address");
        require(!sessionKeys[key].active, "WazabiAccount: key already active");
        require(validUntil > block.timestamp, "WazabiAccount: invalid expiry");

        sessionKeys[key] = SessionKey({
            maxPerTx: maxPerTx,
            dailyLimit: dailyLimit,
            dailySpent: 0,
            lastResetDay: block.timestamp / 1 days,
            validUntil: validUntil,
            active: true
        });
        sessionKeyList.push(key);

        emit SessionKeyAdded(key, maxPerTx, dailyLimit, validUntil);
    }

    /**
     * @notice Revoke a session key
     * @param key The session key address to revoke
     */
    function revokeSessionKey(address key) external onlyOwner {
        require(sessionKeys[key].active, "WazabiAccount: key not active");
        sessionKeys[key].active = false;
        emit SessionKeyRevoked(key);
    }

    /**
     * @notice Check if a session key is valid
     */
    function isSessionKeyValid(address key) external view returns (bool) {
        SessionKey storage sk = sessionKeys[key];
        return sk.active && block.timestamp <= sk.validUntil;
    }

    /**
     * @notice Get remaining daily allowance for a session key
     */
    function getRemainingDailyAllowance(address key) external view returns (uint256) {
        SessionKey storage sk = sessionKeys[key];
        if (!sk.active) return 0;

        uint256 currentDay = block.timestamp / 1 days;
        if (currentDay > sk.lastResetDay) {
            return sk.dailyLimit; // New day, full allowance
        }
        if (sk.dailyLimit <= sk.dailySpent) return 0;
        return sk.dailyLimit - sk.dailySpent;
    }

    // ========================================================================
    // Internal Functions
    // ========================================================================

    function _call(
        address target,
        uint256 value,
        bytes memory data
    ) internal returns (bytes memory) {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        return result;
    }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        (newImplementation); // silence unused warning
    }

    // ========================================================================
    // Receive ETH/BNB
    // ========================================================================

    receive() external payable {}
}
