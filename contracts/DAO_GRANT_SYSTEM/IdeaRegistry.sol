// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title IdeaRegistry
/// @notice Stores ideas, their metadata, and manages statuses and votes
/// @dev Can be used together with VotingSystem to manage idea funding
contract IdeaRegistry is Ownable {
    uint256 private _ideaIdCounter;

    /* ========== ENUMS ========== */

    /// @dev Status of an idea
    enum Status {
        Pending,    // Idea created, not yet voted
        Voting,     // Idea currently in a voting round
        Funded,     // Idea has received funding
        Rejected,   // Idea rejected
        Completed   // Idea completed
    }

    /* ========== STRUCTS ========== */

    struct Idea {
        uint256 id;
        address author;
        string title;
        string description;
        string link;
        uint256 createdAt;
        uint256 totalVotes;
        Status status;
    }

    /* ========== STATE ========== */

    mapping(uint256 => Idea) public ideas;
    mapping(address => uint256[]) public authorIdeas;

    /* ========== AUTHORIZED UPDATERS ========== */

    /// @notice Addresses (e.g. VotingSystem) authorized to update idea status in addition to owner
    mapping(address => bool) public authorizedUpdaters;

    /* ========== EVENTS ========== */

    event IdeaCreated(uint256 indexed ideaId, address indexed author, string title);
    event IdeaStatusUpdated(uint256 indexed ideaId, Status newStatus);
    event IdeaVoted(uint256 indexed ideaId, address indexed voter, uint256 votes);

    /* ========== CONSTRUCTOR ========== */

    constructor() Ownable(msg.sender) {}

    /* ========== MODIFIERS ========== */

    /// @notice Allows only owner or an authorized updater to call
    modifier onlyAuthorizedUpdater() {
        require(msg.sender == owner() || authorizedUpdaters[msg.sender], "IdeaRegistry: not authorized");
        _;
    }

    /* ========== EXTERNAL / PUBLIC API ========== */

    /**
     * @notice Create a new idea
     * @param _title Title of the idea
     * @param _description Description of the idea
     * @param _link Optional link (e.g., to documentation or image)
     */
    function createIdea(
        string memory _title,
        string memory _description,
        string memory _link
    ) external {
        require(bytes(_title).length > 0, "Title required");
        require(bytes(_description).length > 0, "Description required");

        uint256 newId = _ideaIdCounter;

        ideas[newId] = Idea({
            id: newId,
            author: msg.sender,
            title: _title,
            description: _description,
            link: _link,
            createdAt: block.timestamp,
            totalVotes: 0,
            status: Status.Pending
        });

        authorIdeas[msg.sender].push(newId);
        emit IdeaCreated(newId, msg.sender, _title);

       _ideaIdCounter++;
    }

    /**
     * @notice Update the status of an idea
     * @dev Only owner or authorized updaters can call. Used by VotingSystem.
     * @param _ideaId ID of the idea to update
     * @param _newStatus Numeric representation of new status
     */
    function updateStatus(uint256 _ideaId, uint8 _newStatus) external onlyAuthorizedUpdater {
        require(_ideaId < _ideaIdCounter, "Idea does not exist");
        require(_newStatus <= uint8(Status.Completed), "Invalid status");

        ideas[_ideaId].status = Status(_newStatus);
        emit IdeaStatusUpdated(_ideaId, ideas[_ideaId].status);
    }

    /**
     * @notice Add votes to an idea manually (for admin adjustments)
     * @dev Only owner can call
     * @param _ideaId ID of the idea
     * @param _amount Number of votes to add
     */
    function addVote(uint256 _ideaId, uint256 _amount) external onlyOwner {
        require(_ideaId < _ideaIdCounter, "Idea does not exist");
        ideas[_ideaId].totalVotes += _amount;
        emit IdeaVoted(_ideaId, msg.sender, _amount);
    }

    /**
     * @notice Get all idea IDs created by an author
     * @param _author Address of the author
     * @return Array of idea IDs
     */
    function getIdeasByAuthor(address _author) external view returns (uint256[] memory) {
        return authorIdeas[_author];
    }

    function getIdea(uint256 _ideaId) external view returns (
        uint256 id,
        address author,
        string memory title,
        string memory description,
        string memory link,
        uint256 createdAt,
        uint256 totalVotes,
        uint8 status
    ) {
        require(_ideaId < _ideaIdCounter, "Idea does not exist");
        Idea memory idea = ideas[_ideaId];
        return (
            idea.id,
            idea.author,
            idea.title,
            idea.description,
            idea.link,
            idea.createdAt,
            idea.totalVotes,
            uint8(idea.status)
        );
    }
    
    function getIdeaStruct(uint256 _ideaId) external view returns (Idea memory) {
        require(_ideaId < _ideaIdCounter, "Idea does not exist");
        return ideas[_ideaId];
    }

    /**
     * @notice Get the total number of ideas created
     * @return Total idea count
     */
    function totalIdeas() external view returns (uint256) {
        return _ideaIdCounter;
    }

    /* ========== ADMIN ========== */

    /**
     * @notice Authorize or revoke an address to update idea statuses (in addition to owner)
     * @param updater Address to authorize/revoke
     * @param status true = authorize, false = revoke
     */
    function authorizeUpdater(address updater, bool status) external onlyOwner {
        require(updater != address(0), "IdeaRegistry: updater 0");
        authorizedUpdaters[updater] = status;
    }
}
