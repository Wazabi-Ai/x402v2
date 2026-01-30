// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./WazabiAccount.sol";

/**
 * @title WazabiAccountFactory
 * @notice Factory for deploying WazabiAccount smart wallets using CREATE2.
 *         Produces deterministic addresses that are identical across all EVM chains.
 * @dev Uses ERC-1967 proxy pattern for upgradeable accounts.
 *      The factory itself should be deployed at the same address on all chains
 *      using CREATE2 from a deterministic deployer.
 */
contract WazabiAccountFactory {
    // ========================================================================
    // State Variables
    // ========================================================================

    /// @notice The WazabiAccount implementation contract
    WazabiAccount public immutable accountImplementation;

    /// @notice The ERC-4337 EntryPoint contract
    IEntryPoint public immutable entryPoint;

    /// @notice Mapping of handle hash to deployed account address
    mapping(bytes32 => address) public handleToAccount;

    /// @notice Total number of accounts created
    uint256 public accountCount;

    // ========================================================================
    // Events
    // ========================================================================

    event AccountCreated(
        address indexed account,
        address indexed owner,
        string handle,
        uint256 salt
    );

    // ========================================================================
    // Constructor
    // ========================================================================

    /**
     * @notice Deploy the factory with an EntryPoint reference
     * @param _entryPoint The ERC-4337 EntryPoint contract address
     */
    constructor(IEntryPoint _entryPoint) {
        entryPoint = _entryPoint;
        accountImplementation = new WazabiAccount(_entryPoint);
    }

    // ========================================================================
    // Account Creation
    // ========================================================================

    /**
     * @notice Create a new WazabiAccount for an agent
     * @param owner The owner address (recovery key)
     * @param sessionKey Initial session key address
     * @param handle The agent handle (e.g., "molty.wazabi-x402")
     * @param salt Unique salt for CREATE2 deterministic deployment
     * @return account The deployed account address
     */
    function createAccount(
        address owner,
        address sessionKey,
        string calldata handle,
        uint256 salt
    ) external returns (WazabiAccount account) {
        bytes32 handleHash = keccak256(bytes(handle));

        // Check if account already exists for this handle
        address existing = handleToAccount[handleHash];
        if (existing != address(0)) {
            return WazabiAccount(payable(existing));
        }

        // Deploy proxy pointing to implementation
        bytes memory initData = abi.encodeCall(
            WazabiAccount.initialize,
            (owner, sessionKey, handle)
        );

        ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            initData
        );

        account = WazabiAccount(payable(address(proxy)));
        handleToAccount[handleHash] = address(account);
        accountCount++;

        emit AccountCreated(address(account), owner, handle, salt);
    }

    /**
     * @notice Compute the counterfactual address of an account
     * @dev Returns the address without deploying. Used for pre-funding.
     * @param owner The owner address
     * @param sessionKey Initial session key address
     * @param handle The agent handle
     * @param salt Unique salt for CREATE2
     * @return The computed address
     */
    function getAddress(
        address owner,
        address sessionKey,
        string calldata handle,
        uint256 salt
    ) public view returns (address) {
        bytes memory initData = abi.encodeCall(
            WazabiAccount.initialize,
            (owner, sessionKey, handle)
        );

        bytes32 bytecodeHash = keccak256(
            abi.encodePacked(
                type(ERC1967Proxy).creationCode,
                abi.encode(address(accountImplementation), initData)
            )
        );

        return Create2.computeAddress(bytes32(salt), bytecodeHash);
    }

    /**
     * @notice Check if an account exists for a handle
     * @param handle The agent handle to check
     * @return Whether an account has been deployed
     */
    function accountExists(string calldata handle) external view returns (bool) {
        bytes32 handleHash = keccak256(bytes(handle));
        return handleToAccount[handleHash] != address(0);
    }

    /**
     * @notice Get the account address for a handle
     * @param handle The agent handle
     * @return The account address (zero if not deployed)
     */
    function getAccountForHandle(string calldata handle) external view returns (address) {
        bytes32 handleHash = keccak256(bytes(handle));
        return handleToAccount[handleHash];
    }
}
