const socket = io(); // Initialize socket.io client
let roomId = null; // Store the current room ID
let playerId = null; // Store the current player ID
let playerName = null; // Store the player's name
let isChoosing = false; // Flag to track if the player is currently choosing
let playAgainClicked = false; // Flag to track if the player has clicked play again
let players = {}; // Store the players in the current room

// Handle server messages
socket.on("message", (message) => {
  document.getElementById("result").textContent = message; // Display the message from the server
});

// Display available rooms
socket.on("availableRooms", (rooms) => {
  const roomList = document.getElementById("roomList"); // Get the room list element
  roomList.innerHTML = ""; // Clear the room list
  if (rooms.length === 0) {
    roomList.innerHTML = "<p>No rooms available. Create a new room.</p>"; // Display message if no rooms are available
  } else {
    rooms.forEach(({ roomId, players, availableSpots }) => {
      const roomItem = document.createElement("div"); // Create a div for each room
      roomItem.classList.add("room-item"); // Add a class for styling
      roomItem.innerHTML = `
        <div class="room-info">
          <p>Room ID: ${roomId}</p>
          <p>Players: ${players.join(", ") || "None"}</p>
          <p>Available Spots: <span style="color: ${availableSpots === 0 ? 'red' : 'black'};">${availableSpots}</span></p>
        </div>
        <button onclick="joinRoom('${roomId}')" ${availableSpots === 0 ? 'disabled' : ''}>Join Room</button>
      `; // Set the room information and join button
      roomList.appendChild(roomItem); // Add the room item to the room list
    });
  }
});

// Update room list when a new room is created
socket.on("newRoom", (room) => {
  const roomList = document.getElementById("roomList"); // Get the room list element
  const roomItem = document.createElement("button"); // Create a button for the new room
  roomItem.textContent = `Join Room ${room}`; // Set the button text
  roomItem.onclick = () => joinRoom(room); // Set the button click handler
  roomList.appendChild(roomItem); // Add the button to the room list
});

// Join a room
function joinRoom(room) {
  socket.emit("joinRoom", { room, playerName }); // Emit joinRoom event to the server with the room ID and player name
}

// Create a new room
function createRoom() {
  socket.emit("createRoom", playerName); // Emit createRoom event to the server with the player name
}

// Start game and set player details
socket.on("startGame", ({ roomId: id, players: roomPlayers }) => {
  roomId = id; // Set the current room ID
  playerId = socket.id; // Set the current player ID
  players = roomPlayers; // Set the players in the current room
  document.getElementById("roomId").textContent = `Room ID: ${roomId}`; // Display the room ID
  document.getElementById("roomSelection").style.display = "none"; // Hide the room selection screen
  document.getElementById("gameScreen").style.display = "block"; // Show the game screen
  updatePlayerNames(); // Update player names on the screen
  if (Object.keys(players).length < 2) {
    disableButtons(); // Disable the buttons if both players are not in the room
    document.getElementById("result").textContent = `A room is created! Waiting for an opponent to join.`; // Display game start message
  } else {
    document.getElementById("result").textContent = `The game has started! Make your choice of Heads or Tails`; // Display game start message
    if (Object.keys(players)[0] === playerId) {
      enableButtons(); // Enable the buttons if both players are in the room and that the player is the first player
      document.getElementById("controls").style.display = "block"; // Show the controls
      document.getElementById("result").textContent = `You can choose Heads or Tails first.`; // Notify the first player to choose first
    }
  } 
});

// Update player names on the screen
function updatePlayerNames() {
  const player1Name = players[playerId];
  const player2Id = Object.keys(players).find((id) => id !== playerId);
  const player2Name = player2Id ? players[player2Id] : "TBD";
  document.getElementById("player1Score").textContent = `${player1Name} Score: 0`;
  document.getElementById("player2Score").textContent = `${player2Name} Score: 0`;
}

// Notify player when opponent leaves the room
socket.on("opponentLeft", () => {
  document.getElementById("result").textContent = "Your opponent has left the room. Waiting for a new player to join."; // Display opponent left message
  document.getElementById("controls").style.display = "none"; // Hide the controls
  enableButtons(); // Enable the buttons
  document.getElementById("nextRound").style.display = "none"; // Hide the next round button
  console.log("nextRound hidden by opponentleft"); // Log the player leaving the game
  document.getElementById("leaveGameContainer").style.display = "block"; // Show the leave game button
  // Reset scores locally
  document.getElementById("player1Score").textContent = `${players[playerId]} Score: 0`;
  const player2Id = Object.keys(players).find((id) => id !== playerId);
  document.getElementById("player2Score").textContent = `${player2Id ? players[player2Id] : "TBD"} Score: 0`;
});

// Handle player choice
function choose(choice) {
  if (!roomId) {
    document.getElementById("result").textContent = "Waiting for an opponent..."; // Display waiting message if no room ID
    return;
  }

  if (Object.keys(players).length < 2) {
    document.getElementById("result").textContent = "Waiting for an opponent to join before making a choice."; // Display waiting message if not both players have joined
    return;
  }

  const playerIds = Object.keys(players);
  const firstPlayerId = playerIds[0];
  const secondPlayerId = playerIds[1];
  console.log("socketid is: ", socket.id, "first player socketid is: ", firstPlayerId, "second player socketid is: ", secondPlayerId);
  console.log(`First player choice:`, choice);
  if (socket.id === secondPlayerId && !choice) {
    document.getElementById("result").textContent = "Waiting for the first player to make a choice."; // Display waiting message if the first player has not made a choice
    console.log(`request getting bounced`); // Log the first player's choice
    return;
  }

  if (isChoosing) {
    document.getElementById("result").textContent = "Waiting for opponent to choose..."; // Display waiting message if already choosing
    return;
  }

  // Emit playerChoice event to the server with the room ID and choice
  socket.emit("playerChoice", { roomId, choice });
  document.getElementById("result").textContent = `You chose ${choice}. Waiting for opponent...`; // Display choice message
  document.getElementById("controls").style.display = "none"; // Hide the controls
  disableButtons(); // Disable the buttons
  isChoosing = true; // Set the choosing flag to true
  players[socket.id].choice = choice; // Save the player's choice
}

// Display opponent's choice
socket.on("opponentChoice", ({ choice, playerId }) => {
  players[playerId].choice = choice; // Save the first player's choice
  document.getElementById("result").textContent = `check !!!Your opponent chose ${choice}. You must choose ${choice === 'Heads' ? 'Tails' : 'Heads'}.`; // Display opponent's choice message
  document.getElementById("controls").style.display = "block"; // Show the controls
  console.log(`First player choice: `,choice);
  if (choice === 'Heads') {
    document.querySelector("button[onclick=\"choose('Heads')\"]").disabled = true; // Disable the Heads button if opponent chose Heads
  } else {
    document.querySelector("button[onclick=\"choose('Tails')\"]").disabled = true; // Disable the Tails button if opponent chose Tails
  }
  isChoosing = false; // Set the choosing flag to false
});

// Display coin flip results and scores
socket.on("coinFlipResult", ({ coinResult, scores, messages }) => {
  document.getElementById("controls").style.display = "none"; // Hide the controls after both players have made their choices
  document.getElementById("leaveGameContainer").style.display = "none"; // Hide the leave game button
  const coinElement = document.getElementById("coin"); // Get the coin element
  coinElement.classList.add("animate"); // Start coin animation

  setTimeout(() => {
    coinElement.classList.remove("animate"); // Stop coin animation after 2 seconds
    document.getElementById("result").textContent = `The coin landed on ${coinResult}. ${messages[playerId]}`; // Display coin flip result and win/lose message
    document.getElementById("player1Score").textContent = `${players[playerId]} Score: ${scores[playerId] || 0}`; // Display player 1 score
    document.getElementById("player2Score").textContent = `${players[Object.keys(players).find((id) => id !== playerId)]} Score: ${
      scores[Object.keys(scores).find((id) => id !== playerId)] || 0
    }`; // Display player 2 score

    // Show the next round button only if both players are still in the room
    if (Object.keys(players).length === 2) {
      document.getElementById("nextRound").style.display = "block"; // Show the next round button
      console.log("displaying nexctRound within coinFlipResult"); // Log the player leaving the game
    }
    enableButtons(); // Enable the buttons
  }, 2000); // Delay result display to match coin animation
});

// Start a new round
function playAgain() {
  if (roomId) {
    playAgainClicked = true; // Set the play again flag to true
    socket.emit("playAgain", roomId); // Emit playAgain event to the server with the room ID
    document.getElementById("nextRound").style.display = "none"; // Hide the next round button
    console.log("hidding nextRound within playagain"); // Log the player leaving the game
    document.getElementById("controls").style.display = "none"; // Hide the controls
    document.getElementById("result").textContent = "Waiting for opponent to play again..."; // Display waiting message
    disableButtons(); // Disable the buttons
  }
}

// Leave the game
function leaveGame() {
  if (roomId) {
    socket.emit("leaveGame", roomId); // Emit leaveGame event to the server with the room ID
    document.getElementById("result").textContent = "You left the game."; // Display leave game message
    document.getElementById("controls").style.display = "none"; // Hide the controls
    document.getElementById("nextRound").style.display = "none"; // Hide the next round button
    document.getElementById("leaveGameContainer").style.display = "none"; // Hide the leave game button
    console.log("nextRound hidden by leavegame"); // Log the player leaving the game
    document.getElementById("gameScreen").style.display = "none"; // Hide the game screen
    document.getElementById("roomSelection").style.display = "block"; // Show the room selection screen
    enableButtons(); // Enable the buttons
    playAgainClicked = false; // Reset the play again flag
    document.getElementById("result").textContent = ""; // Reset result message
    document.querySelector("button[onclick=\"playAgain()\"]").disabled = true; // Disable the Play Again button
    // Reset scores locally
    document.getElementById("player1Score").textContent = "Player 1 Score: 0";
    document.getElementById("player2Score").textContent = "Player 2 Score: 0";
  }
}

// Reset UI for a new round
socket.on("newRound", () => {
  if (playAgainClicked) {
    document.getElementById("nextRound").style.display = "none"; // Hide the next round button
    document.getElementById("leaveGameContainer").style.display = "none"; // Hide the leave game button
    console.log("nextRound hidden by new round"); // Log the player leaving the game
    document.getElementById("controls").style.display = "block"; // Show the controls
    document.getElementById("result").textContent = "Make your choice."; // Display make your choice message
    enableButtons(); // Enable the buttons
    isChoosing = false; // Set the choosing flag to false
    playAgainClicked = false; // Reset the play again flag
  }
});

// Disable buttons
function disableButtons() {
  document.querySelectorAll("button").forEach(button => button.disabled = true); // Disable all buttons
}

// Enable buttons
function enableButtons() {
  document.querySelectorAll("button").forEach(button => button.disabled = false); // Enable all buttons
}

// Handle player name submission
function submitName() {
  playerName = document.getElementById("playerName").value; // Get the player's name from the input field
  if (playerName) {
    document.getElementById("nameEntry").style.display = "none"; // Hide the name entry screen
    document.getElementById("roomSelection").style.display = "block"; // Show the room selection screen
  } else {
    alert("Please enter your name."); // Alert the player to enter a name if the input is empty
  }
}
