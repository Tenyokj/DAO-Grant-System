// MockVotingSystem.sol - исправленная версия
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IFundingPool {
    function distributeFunds(uint256 roundId) external;
}

contract MockVotingSystem {
    mapping(uint256 => uint256) public winningIdeas;
    IFundingPool public fundingPool;

    // Убираем конструктор с параметром
    constructor() {
        // Ничего не делаем в конструкторе
    }

    // Добавляем метод для установки fundingPool после деплоя
    function setFundingPool(address _fundingPool) external {
        fundingPool = IFundingPool(_fundingPool);
    }

    // Устанавливаем победителя вручную
    function setWinningIdea(uint256 roundId, uint256 ideaId) external {
        winningIdeas[roundId] = ideaId;
    }

    // FundingPool будет спрашивать победителя
    function getWinningIdea(uint256 roundId) external view returns (uint256) {
        return winningIdeas[roundId];
    }

    // Метод distributeFunds для тестов, просто делегирует FundingPool
    function distributeFunds(uint256 roundId) external {
        require(address(fundingPool) != address(0), "FundingPool not set");
        fundingPool.distributeFunds(roundId);
    }
}