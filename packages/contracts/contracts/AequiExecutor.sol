// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract AequiExecutor is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Address for address;

    error ExecutionFailed(uint256 index, address target, bytes reason);
    error InvalidInjectionOffset(uint256 offset, uint256 length);
    error ZeroAmountInjection();
    error FeeExceedsMax(uint256 feeBps, uint256 maxFeeBps);
    error FeeRecipientRequired();

    event FeeConfigUpdated(address indexed feeRecipient, uint256 feeBps);
    event FeeCollected(address indexed token, address indexed recipient, uint256 amount);

    uint256 public constant MAX_FEE_BPS = 500;

    address public feeRecipient;
    uint256 public feeBps;

    struct TokenPull {
        address token;
        uint256 amount;
    }

    struct Approval {
        address token;
        address spender;
        uint256 amount;
        bool revokeAfter;
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
        address injectToken; // If non-zero, injects the balance of this token into the call data
        uint256 injectOffset; // The byte offset in 'data' to overwrite with the balance
    }

    constructor(address initialOwner, address _feeRecipient, uint256 _feeBps) Ownable(initialOwner) {
        if (_feeBps > MAX_FEE_BPS) revert FeeExceedsMax(_feeBps, MAX_FEE_BPS);
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
    }

    receive() external payable {}

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function rescueFunds(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function rescueETH(address payable to, uint256 amount) external onlyOwner {
        Address.sendValue(to, amount);
    }

    function setFeeConfig(address _feeRecipient, uint256 _feeBps) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeExceedsMax(_feeBps, MAX_FEE_BPS);
        if (_feeBps > 0 && _feeRecipient == address(0)) revert FeeRecipientRequired();
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
        emit FeeConfigUpdated(_feeRecipient, _feeBps);
    }

    function execute(
        TokenPull[] calldata pulls,
        Approval[] calldata approvals,
        Call[] calldata calls,
        address[] calldata tokensToFlush
    ) external payable nonReentrant whenNotPaused returns (bytes[] memory results) {
        uint256 ethBalanceBefore = address(this).balance - msg.value;
        uint256[] memory tokenBalancesBefore = _snapshotBalances(tokensToFlush);

        _pullTokens(pulls);
        _setApprovals(approvals);
        results = _performCalls(calls);
        _revokeApprovals(approvals);
        _flushDeltas(msg.sender, tokensToFlush, tokenBalancesBefore, ethBalanceBefore);
    }

    function _snapshotBalances(address[] calldata tokens) private view returns (uint256[] memory balances) {
        balances = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length;) {
            balances[i] = IERC20(tokens[i]).balanceOf(address(this));
            unchecked { ++i; }
        }
    }

    function _pullTokens(TokenPull[] calldata pulls) private {
        for (uint256 i; i < pulls.length;) {
            TokenPull calldata p = pulls[i];
            IERC20(p.token).safeTransferFrom(msg.sender, address(this), p.amount);
            unchecked { ++i; }
        }
    }

    function _setApprovals(Approval[] calldata approvals) private {
        for (uint256 i; i < approvals.length;) {
            Approval calldata a = approvals[i];
            IERC20(a.token).forceApprove(a.spender, a.amount);
            unchecked { ++i; }
        }
    }

    function _performCalls(Call[] calldata calls) private returns (bytes[] memory results) {
        results = new bytes[](calls.length);
        for (uint256 i; i < calls.length;) {
            Call calldata c = calls[i];
            
            bytes memory data = c.data;

            if (c.injectToken != address(0)) {
                uint256 injectedAmount = IERC20(c.injectToken).balanceOf(address(this));
                if (injectedAmount == 0) revert ZeroAmountInjection();

                if (c.injectOffset < 4) revert InvalidInjectionOffset(c.injectOffset, data.length);
                if (c.injectOffset + 32 > data.length) revert InvalidInjectionOffset(c.injectOffset, data.length);

                uint256 offset = c.injectOffset;
                assembly {
                    mstore(add(add(data, 32), offset), injectedAmount)
                }
            }

            (bool success, bytes memory ret) = c.target.call{value: c.value}(data);
            
            if (!success) {
                if (ret.length > 0) {
                    assembly {
                        let returndata_size := mload(ret)
                        revert(add(32, ret), returndata_size)
                    }
                } else {
                    revert ExecutionFailed(i, c.target, "");
                }
            }
            results[i] = ret;
            unchecked { ++i; }
        }
    }

    function _revokeApprovals(Approval[] calldata approvals) private {
        for (uint256 i; i < approvals.length;) {
            Approval calldata a = approvals[i];
            if (a.revokeAfter) {
                IERC20(a.token).forceApprove(a.spender, 0);
            }
            unchecked { ++i; }
        }
    }

    function _flushDeltas(
        address recipient,
        address[] calldata tokens,
        uint256[] memory balancesBefore,
        uint256 ethBalanceBefore
    ) private {
        uint256 _feeBps = feeBps;
        address _feeRecipient = feeRecipient;
        bool chargeFee = _feeBps > 0 && _feeRecipient != address(0);

        for (uint256 i; i < tokens.length;) {
            uint256 balanceAfter = IERC20(tokens[i]).balanceOf(address(this));
            if (balanceAfter > balancesBefore[i]) {
                uint256 delta = balanceAfter - balancesBefore[i];
                if (chargeFee) {
                    uint256 fee = (delta * _feeBps) / 10000;
                    if (fee > 0) {
                        IERC20(tokens[i]).safeTransfer(_feeRecipient, fee);
                        emit FeeCollected(tokens[i], _feeRecipient, fee);
                        delta -= fee;
                    }
                }
                IERC20(tokens[i]).safeTransfer(recipient, delta);
            }
            unchecked { ++i; }
        }

        uint256 ethBalanceAfter = address(this).balance;
        if (ethBalanceAfter > ethBalanceBefore) {
            uint256 ethDelta = ethBalanceAfter - ethBalanceBefore;
            if (chargeFee) {
                uint256 ethFee = (ethDelta * _feeBps) / 10000;
                if (ethFee > 0) {
                    Address.sendValue(payable(_feeRecipient), ethFee);
                    emit FeeCollected(address(0), _feeRecipient, ethFee);
                    ethDelta -= ethFee;
                }
            }
            Address.sendValue(payable(recipient), ethDelta);
        }
    }
}
