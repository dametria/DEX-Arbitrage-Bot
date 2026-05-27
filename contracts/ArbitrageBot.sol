// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// ─────────────────────────────── ERC-20 ──────────────────────────────────────

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// ───────────────────────── Aave V3 interfaces ─────────────────────────────────

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

// ─────────────────────── DEX router interfaces ───────────────────────────────

// Uniswap V3 / PancakeSwap V3 / Camelot V3
interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params)
        external returns (uint256 amountOut);
}

// Uniswap V2-compatible (Pangolin, SushiSwap V2)
interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

// Trader Joe V2.1
interface ILBRouter {
    enum Version { V1, V2, V2_1 }

    struct Path {
        uint256[]   pairBinSteps;
        Version[]   versions;
        address[]   tokenPath;
    }

    function swapExactTokensForTokens(
        uint256        amountIn,
        uint256        amountOutMin,
        Path  calldata path,
        address        to,
        uint256        deadline
    ) external returns (uint256 amountOut);
}

// Balancer V2 / Beethoven X
interface IBalancerVault {
    enum SwapKind { GIVEN_IN, GIVEN_OUT }

    struct SingleSwap {
        bytes32  poolId;
        SwapKind kind;
        address  assetIn;
        address  assetOut;
        uint256  amount;
        bytes    userData;
    }

    struct FundManagement {
        address sender;
        bool    fromInternalBalance;
        address payable recipient;
        bool    toInternalBalance;
    }

    function swap(
        SingleSwap    calldata singleSwap,
        FundManagement calldata funds,
        uint256        limit,
        uint256        deadline
    ) external returns (uint256);
}

// Velodrome V2
interface IVelodromeRouter {
    struct Route {
        address from;
        address to;
        bool    stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256         amountIn,
        uint256         amountOutMin,
        Route[] calldata routes,
        address          to,
        uint256          deadline
    ) external returns (uint256[] memory amounts);
}

// ─────────────────────────────── Ownable ───────────────────────────────────────

contract Ownable {
    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address initialOwner) {
        require(initialOwner != address(0), "Ownable: zero address");
        _owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        require(msg.sender == _owner, "Ownable: caller is not the owner");
        _;
    }

    function owner() public view returns (address) { return _owner; }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Ownable: zero address");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }
}

// ─────────────────────────────── ReentrancyGuard ───────────────────────────────

contract ReentrancyGuard {
    bool private _entered;

    modifier nonReentrant() {
        require(!_entered, "ReentrancyGuard: reentrant call");
        _entered = true;
        _;
        _entered = false;
    }
}

// ─────────────────────────────── Main contract ───────────────────────────────

contract ArbitrageBot is ReentrancyGuard, Ownable {

    // ── Storage ──────────────────────────────────────────────────────────────

    IPool public immutable aavePool;

    struct DexConfig {
        address router;
        uint8   dexType;
        uint24  feeTier;
        bytes32 balancerPoolId;
        int128  curveIndexIn;
        int128  curveIndexOut;
        address veloFactory;
        bool    veloStable;
        uint256 lbBinStep;
    }

    mapping(uint8 => DexConfig) public dexConfigs;

    // ── Events ───────────────────────────────────────────────────────────────

    event ArbitrageExecuted(
        uint8   indexed buyDexId,
        uint8   indexed sellDexId,
        address         tokenBorrow,
        address         tokenBuy,
        uint256         loanAmount,
        uint256         profit,
        uint256         aavePremium
    );

    event DexConfigSet(uint8 indexed dexId, address router, uint8 dexType);
    event Withdrawn(address token, uint256 amount, address to);

    // ── Errors ───────────────────────────────────────────────────────────────

    error OnlyAavePool();
    error OnlyInitiator();
    error DeadlineExpired();
    error InsufficientProfit(uint256 got, uint256 min);
    error UnknownDexType(uint8 dexType);
    error ZeroBalance();

    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _aavePool, address _owner) Ownable(_owner) {
        aavePool = IPool(_aavePool);
    }

    // ── Owner: register a DEX ────────────────────────────────────────────────

    function setDexConfig(uint8 dexId, DexConfig calldata cfg) external onlyOwner {
        require(cfg.router != address(0), "Zero router");
        dexConfigs[dexId] = cfg;
        emit DexConfigSet(dexId, cfg.router, cfg.dexType);
    }

    // ── Entry point ──────────────────────────────────────────────────────────

    struct ArbParams {
        uint8   buyDexId;
        uint8   sellDexId;
        address tokenBorrow;
        address tokenBuy;
        uint256 loanAmount;
        uint256 minProfit;
        uint256 deadline;
        uint8   hops;
        uint8   hopDexId;
        address hopToken;
    }

    function initiateArbitrage(ArbParams calldata p) external onlyOwner nonReentrant {
        if (block.timestamp > p.deadline) revert DeadlineExpired();

        bytes memory encoded = abi.encode(p);

        aavePool.flashLoanSimple(
            address(this),
            p.tokenBorrow,
            p.loanAmount,
            encoded,
            0
        );
    }

    // ── Aave callback ────────────────────────────────────────────────────────

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        if (msg.sender != address(aavePool))  revert OnlyAavePool();
        if (initiator  != address(this))      revert OnlyInitiator();

        ArbParams memory p = abi.decode(params, (ArbParams));

        if (block.timestamp > p.deadline) revert DeadlineExpired();

        uint256 usdtBefore = IERC20(asset).balanceOf(address(this));

        if (p.hops == 1) {
            _executeOneHop(p, amount);
        } else {
            _executeTwoHop(p, amount);
        }

        uint256 usdtAfter = IERC20(asset).balanceOf(address(this));
        uint256 repayAmount = amount + premium;

        uint256 grossProfit = usdtAfter > usdtBefore ? usdtAfter - usdtBefore : 0;
        uint256 netProfit   = grossProfit > premium ? grossProfit - premium : 0;

        if (netProfit < p.minProfit) revert InsufficientProfit(netProfit, p.minProfit);

        IERC20(asset).approve(address(aavePool), repayAmount);

        emit ArbitrageExecuted(
            p.buyDexId,
            p.sellDexId,
            asset,
            p.tokenBuy,
            amount,
            netProfit,
            premium
        );

        return true;
    }

    // ── Hop executors ─────────────────────────────────────────────────────────

    function _executeOneHop(ArbParams memory p, uint256 amountIn) internal {
        uint256 wbtcReceived = _swap(
            p.buyDexId,
            p.tokenBorrow,
            p.tokenBuy,
            amountIn,
            1,
            p.deadline
        );

        _swap(
            p.sellDexId,
            p.tokenBuy,
            p.tokenBorrow,
            wbtcReceived,
            1,
            p.deadline
        );
    }

    function _executeTwoHop(ArbParams memory p, uint256 amountIn) internal {
        uint256 hopReceived = _swap(
            p.buyDexId,
            p.tokenBorrow,
            p.hopToken,
            amountIn,
            1,
            p.deadline
        );

        uint256 wbtcReceived = _swap(
            p.hopDexId,
            p.hopToken,
            p.tokenBuy,
            hopReceived,
            1,
            p.deadline
        );

        _swap(
            p.sellDexId,
            p.tokenBuy,
            p.tokenBorrow,
            wbtcReceived,
            1,
            p.deadline
        );
    }

    // ── DEX dispatcher ───────────────────────────────────────────────────────

    function _swap(
        uint8   dexId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        DexConfig storage cfg = dexConfigs[dexId];
        address router = cfg.router;

        IERC20(tokenIn).approve(router, amountIn);

        uint8 dt = cfg.dexType;

        // Uniswap V3 / PancakeSwap V3 / Camelot V3
        if (dt == 0 || dt == 7) {
            return IUniswapV3Router(router).exactInputSingle(
                IUniswapV3Router.ExactInputSingleParams({
                    tokenIn:           tokenIn,
                    tokenOut:          tokenOut,
                    fee:               cfg.feeTier,
                    recipient:         address(this),
                    deadline:          deadline,
                    amountIn:          amountIn,
                    amountOutMinimum:  amountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        }

        // Uniswap V2-compatible (Pangolin, SushiSwap)
        if (dt == 1) {
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            uint256[] memory amounts = IUniswapV2Router(router).swapExactTokensForTokens(
                amountIn, amountOutMin, path, address(this), deadline
            );
            return amounts[amounts.length - 1];
        }

        // Trader Joe V2.1
        if (dt == 2) {
            uint256[]   memory binSteps = new uint256[](1);
            ILBRouter.Version[] memory versions  = new ILBRouter.Version[](1);
            address[]   memory tokenPath = new address[](2);
            binSteps[0]  = cfg.lbBinStep;
            versions[0]  = ILBRouter.Version.V2_1;
            tokenPath[0] = tokenIn;
            tokenPath[1] = tokenOut;
            return ILBRouter(router).swapExactTokensForTokens(
                amountIn,
                amountOutMin,
                ILBRouter.Path({ pairBinSteps: binSteps, versions: versions, tokenPath: tokenPath }),
                address(this),
                deadline
            );
        }

        // Balancer V2 / Beethoven X
        if (dt == 3) {
            return IBalancerVault(router).swap(
                IBalancerVault.SingleSwap({
                    poolId:   cfg.balancerPoolId,
                    kind:     IBalancerVault.SwapKind.GIVEN_IN,
                    assetIn:  tokenIn,
                    assetOut: tokenOut,
                    amount:   amountIn,
                    userData: ""
                }),
                IBalancerVault.FundManagement({
                    sender:              address(this),
                    fromInternalBalance: false,
                    recipient:           payable(address(this)),
                    toInternalBalance:   false
                }),
                amountOutMin,
                deadline
            );
        }

        // Velodrome V2
        if (dt == 4) {
            IVelodromeRouter.Route[] memory routes = new IVelodromeRouter.Route[](1);
            routes[0] = IVelodromeRouter.Route({
                from:    tokenIn,
                to:      tokenOut,
                stable:  cfg.veloStable,
                factory: cfg.veloFactory
            });
            uint256[] memory amounts = IVelodromeRouter(router).swapExactTokensForTokens(
                amountIn, amountOutMin, routes, address(this), deadline
            );
            return amounts[amounts.length - 1];
        }

        revert UnknownDexType(dt);
    }

    // ── Owner utilities ──────────────────────────────────────────────────────

    function withdraw(address token, address to) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) revert ZeroBalance();
        IERC20(token).transfer(to, bal);
        emit Withdrawn(token, bal, to);
    }

    function withdrawNative(address payable to) external onlyOwner {
        uint256 bal = address(this).balance;
        if (bal == 0) revert ZeroBalance();
        to.transfer(bal);
    }

    receive() external payable {}
}
