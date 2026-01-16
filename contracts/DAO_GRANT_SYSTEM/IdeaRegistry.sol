// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IdeaRegistry
 * @notice Central registry for storing and managing ideas within the DAO ecosystem
 * @dev Manages idea lifecycle, metadata, status transitions, and voting data
 */
contract IdeaRegistry is Ownable {
    uint256 private _ideaIdCounter = 1;

    /* ========== ENUMS ========== */

    /**
     * @notice Lifecycle status of an idea
     */
    enum Status {
        Pending,    // Idea created, not yet voted
        Voting,     // Idea currently in a voting round
        WonVoting,  // Idea won voting but not yet funded
        Funded,     // Idea has received funding
        Rejected,   // Idea rejected
        Completed   // Idea completed
    }

    /* ========== STRUCTS ========== */

    /**
     * @notice Complete idea data structure
     * @param id Unique identifier for the idea
     * @param author Ethereum address of the idea creator
     * @param title Short descriptive title
     * @param description Detailed explanation of the idea
     * @param link Optional external reference (documentation, images, etc.)
     * @param createdAt Block timestamp when idea was created
     * @param totalVotes Cumulative voting power received
     * @param status Current lifecycle status
     */
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

    /* ========== STATE VARIABLES ========== */

    /// @dev Mapping from idea ID to Idea struct
    mapping(uint256 => Idea) public ideas;
    
    /// @dev Mapping from author address to array of their idea IDs
    mapping(address => uint256[]) public authorIdeas;
    
    /// @dev Mapping of addresses authorized to update idea statuses
    mapping(address => bool) public authorizedUpdaters;

    /* ========== EVENTS ========== */

    /**
     * @notice Emitted when a new idea is created
     * @param ideaId Unique identifier of the created idea
     * @param author Address of the idea creator
     * @param title Title of the created idea
     */
    event IdeaCreated(uint256 indexed ideaId, address indexed author, string title);
    
    /**
     * @notice Emitted when an idea's status is updated
     * @param ideaId Unique identifier of the updated idea
     * @param newStatus New status value
     */
    event IdeaStatusUpdated(uint256 indexed ideaId, Status newStatus);
    
    /**
     * @notice Emitted when votes are added to an idea
     * @param ideaId Unique identifier of the idea receiving votes
     * @param voter Address that contributed votes
     * @param votes Amount of votes added
     */
    event IdeaVoted(uint256 indexed ideaId, address indexed voter, uint256 votes);

    /* ========== CONSTRUCTOR ========== */

    /**
     * @notice Initializes the IdeaRegistry contract
     * @dev Sets the contract deployer as the initial owner
     */
    constructor() Ownable(msg.sender) {}

    /* ========== MODIFIERS ========== */

    /**
     * @notice Restricts function access to owner or authorized updaters
     */
    modifier onlyAuthorizedUpdater() {
        require(
            msg.sender == owner() || authorizedUpdaters[msg.sender],
            "IdeaRegistry: not authorized"
        );
        _;
    }

    /* ========== EXTERNAL FUNCTIONS ========== */

    /**
     * @notice Creates a new idea entry
     * @dev Idea starts with Pending status and zero votes
     * @param _title Title of the idea (non-empty)
     * @param _description Detailed description (non-empty)
     * @param _link Optional external link (can be empty)
     * @custom:emits IdeaCreated
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
     * @notice Updates the status of an existing idea
     * @dev Only callable by owner or authorized updaters (e.g., GrantManager)
     * @param _ideaId ID of the idea to update
     * @param _newStatus Numeric representation of the new status (0-5)
     * @custom:emits IdeaStatusUpdated
     * @custom:requires _ideaId must exist
     * @custom:requires _newStatus must be valid (≤ Status.Completed)
     */
    function updateStatus(uint256 _ideaId, uint8 _newStatus) external onlyAuthorizedUpdater {
        require(_ideaId > 0 && _ideaId < _ideaIdCounter, "Idea does not exist");
        require(_newStatus <= uint8(Status.Completed), "Invalid status");

        ideas[_ideaId].status = Status(_newStatus);
        emit IdeaStatusUpdated(_ideaId, ideas[_ideaId].status);
    }

    /**
     * @notice Manually adds votes to an idea (admin function)
     * @dev Primarily for administrative adjustments and testing
     * @param _ideaId ID of the idea receiving votes
     * @param _amount Number of votes to add
     * @custom:emits IdeaVoted
     * @custom:requires Only owner can call
     * @custom:requires _ideaId must exist
     */
    function addVote(uint256 _ideaId, uint256 _amount) external onlyOwner {
        require(_ideaId < _ideaIdCounter, "Idea does not exist");
        ideas[_ideaId].totalVotes += _amount;
        emit IdeaVoted(_ideaId, msg.sender, _amount);
    }

    /* ========== VIEW FUNCTIONS ========== */

    /**
     * @notice Retrieves all idea IDs created by a specific author
     * @param _author Address to query
     * @return Array of idea IDs created by the author
     */
    function getIdeasByAuthor(address _author) external view returns (uint256[] memory) {
        return authorIdeas[_author];
    }

    /**
     * @notice Retrieves the author address for a specific idea
     * @dev Optimized for external contracts needing only author information
     * @param ideaId ID of the idea to query
     * @return author Address of the idea creator
     * @custom:requires ideaId must exist
     */
    function getIdeaAuthor(uint256 ideaId) external view returns (address) {
        require(ideaId > 0 && ideaId < _ideaIdCounter, "Idea does not exist");
        return ideas[ideaId].author;
    }

    /**
     * @notice Retrieves comprehensive idea data as separate return values
     * @param _ideaId ID of the idea to retrieve
     * @return id Unique identifier
     * @return author Creator address
     * @return title Idea title
     * @return description Detailed description
     * @return link External reference
     * @return createdAt Creation timestamp
     * @return totalVotes Cumulative votes received
     * @return status Current lifecycle status as uint8
     * @custom:requires _ideaId must exist
     */
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
        require(_ideaId > 0 && _ideaId < _ideaIdCounter, "Idea does not exist");
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

    /**
     * @notice Retrieves complete idea structure
     * @param _ideaId ID of the idea to retrieve
     * @return Idea struct containing all idea data
     * @custom:requires _ideaId must exist
     */
    function getIdeaStruct(uint256 _ideaId) external view returns (Idea memory) {
        require(_ideaId < _ideaIdCounter, "Idea does not exist");
        return ideas[_ideaId];
    }

    /**
     * @notice Returns the total number of created ideas
     * @return Count of all ideas (counter - 1 since counter starts at 1)
     */
    function totalIdeas() external view returns (uint256) {
        return _ideaIdCounter - 1;
    }

    /* ========== ADMIN FUNCTIONS ========== */

    /**
     * @notice Authorizes or revokes status update permissions
     * @dev Used to grant GrantManager and other contracts update capabilities
     * @param updater Address to modify permissions for
     * @param status true to authorize, false to revoke
     * @custom:requires Only owner can call
     * @custom:requires updater cannot be zero address
     */
    function authorizeUpdater(address updater, bool status) external onlyOwner {
        require(updater != address(0), "IdeaRegistry: updater 0");
        authorizedUpdaters[updater] = status;
    }
}