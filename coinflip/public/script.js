const socket = io();

// Socket connection handlers
socket.on('connect', () => {
  console.log('Connected to server');
  const statusEl = document.getElementById('connectionStatus');
  const indicatorEl = document.getElementById('statusIndicator');
  if (statusEl && indicatorEl) {
    statusEl.textContent = '● Connected';
    statusEl.style.color = '#10b981';
    indicatorEl.style.color = '#10b981';
  }
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  const statusEl = document.getElementById('connectionStatus');
  const indicatorEl = document.getElementById('statusIndicator');
  if (statusEl && indicatorEl) {
    statusEl.textContent = '● Disconnected - Please refresh';
    statusEl.style.color = '#ef4444';
    indicatorEl.style.color = '#ef4444';
  }
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  const statusEl = document.getElementById('connectionStatus');
  const indicatorEl = document.getElementById('statusIndicator');
  if (statusEl && indicatorEl) {
    statusEl.textContent = '● Connection failed - Make sure server is running';
    statusEl.style.color = '#ef4444';
    indicatorEl.style.color = '#ef4444';
  }
});

// Game state
let playerData = {
  name: '',
  credits: 0
};
let currentRoomId = null;
let isCreator = false;
let joinTimeout = null;
let createBetAmount = 0;
let createChoice = null;
let gameFinished = false;

// DOM Elements
const welcomeScreen = document.getElementById('welcomeScreen');
const mainScreen = document.getElementById('mainScreen');
const playerNameInput = document.getElementById('playerNameInput');
const joinBtn = document.getElementById('joinBtn');
const playerNameDisplay = document.getElementById('playerNameDisplay');
const creditsAmount = document.getElementById('creditsAmount');
const roomSelection = document.getElementById('roomSelection');
const roomList = document.getElementById('roomList');
const createRoomBtn = document.getElementById('createRoomBtn');
const gameRoom = document.getElementById('gameRoom');
const currentRoomIdDisplay = document.getElementById('currentRoomId');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const player1Card = document.getElementById('player1Card');
const player2Card = document.getElementById('player2Card');
const player1Name = document.getElementById('player1Name');
const player2Name = document.getElementById('player2Name');
const player1Bet = document.getElementById('player1Bet');
const player2Bet = document.getElementById('player2Bet');
const player1Choice = document.getElementById('player1Choice');
const player2Choice = document.getElementById('player2Choice');
const coin = document.getElementById('coin');
const coinResult = document.getElementById('coinResult');
const gameStatus = document.getElementById('gameStatus');
const statusMessage = document.getElementById('statusMessage');
const confirmationSection = document.getElementById('confirmationSection');
const confirmBetAmount = document.getElementById('confirmBetAmount');
const confirmCreatorChoice = document.getElementById('confirmCreatorChoice');
const confirmParticipationBtn = document.getElementById('confirmParticipationBtn');
const resultsSection = document.getElementById('resultsSection');
const resultMessage = document.getElementById('resultMessage');
const errorToast = document.getElementById('errorToast');
const errorMessage = document.getElementById('errorMessage');

// Bet creation elements
const createBetAmountInput = document.getElementById('createBetAmountInput');
const createChooseHeadsBtn = document.getElementById('createChooseHeadsBtn');
const createChooseTailsBtn = document.getElementById('createChooseTailsBtn');

// Initialize
if (joinBtn) {
  joinBtn.addEventListener('click', joinGame);
}
if (playerNameInput) {
  playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinGame();
  });
}

if (createRoomBtn) {
  createRoomBtn.addEventListener('click', createRoom);
}
if (leaveRoomBtn) {
  leaveRoomBtn.addEventListener('click', leaveRoom);
}
if (confirmParticipationBtn) {
  confirmParticipationBtn.addEventListener('click', confirmParticipation);
}

// Quick bet buttons for creating room
if (createBetAmountInput) {
  const quickBetButtons = document.querySelectorAll('.bet-setup-section .btn-quick-bet');
  quickBetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const amount = btn.dataset.amount === '0' ? playerData.credits : parseInt(btn.dataset.amount);
      createBetAmountInput.value = amount;
      updateCreateRoomButton();
    });
  });
  createBetAmountInput.addEventListener('input', updateCreateRoomButton);
}

if (createChooseHeadsBtn) {
  createChooseHeadsBtn.addEventListener('click', () => selectCreateChoice('Heads'));
}
if (createChooseTailsBtn) {
  createChooseTailsBtn.addEventListener('click', () => selectCreateChoice('Tails'));
}

function selectCreateChoice(choice) {
  createChoice = choice;
  if (createChooseHeadsBtn && createChooseTailsBtn) {
    createChooseHeadsBtn.classList.remove('selected');
    createChooseTailsBtn.classList.remove('selected');
    if (choice === 'Heads') {
      createChooseHeadsBtn.classList.add('selected');
    } else {
      createChooseTailsBtn.classList.add('selected');
    }
  }
  updateCreateRoomButton();
}

function updateCreateRoomButton() {
  if (!createBetAmountInput || !createRoomBtn) return;
  
  const amount = parseInt(createBetAmountInput.value) || 0;
  const isValid = amount > 0 && 
                  amount <= playerData.credits && 
                  createChoice !== null;
  createRoomBtn.disabled = !isValid;
}

function joinGame() {
  const name = playerNameInput ? playerNameInput.value.trim() : '';
  if (!name) {
    showError('Please enter your name');
    return;
  }
  
  if (!socket.connected) {
    showError('Not connected to server. Please wait...');
    return;
  }
  
  console.log('Joining game with name:', name);
  
  if (joinTimeout) {
    clearTimeout(joinTimeout);
  }
  
  if (joinBtn) {
    joinBtn.disabled = true;
    joinBtn.textContent = 'Connecting...';
  }
  
  joinTimeout = setTimeout(() => {
    console.error('Timeout waiting for playerData response');
    showError('Server did not respond. Please try again.');
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join Game';
    }
  }, 5000);
  
  socket.emit('joinGame', name);
}

function createRoom() {
  if (!playerData.name) {
    showError('Please join the game first');
    return;
  }
  
  const amount = parseInt(createBetAmountInput.value);
  if (!amount || amount <= 0 || amount > playerData.credits || !createChoice) {
    showError('Please set a valid bet amount and choice');
    return;
  }
  
  socket.emit('createRoom', { betAmount: amount, choice: createChoice });
}

function leaveRoom() {
  socket.emit('leaveRoom');
}

function confirmParticipation() {
  if (!currentRoomId) {
    showError('Not in a room');
    return;
  }
  socket.emit('confirmParticipation', { roomId: currentRoomId });
}

// Socket event handlers
socket.on('error', (message) => {
  console.error('Socket error:', message);
  showError(message);
  if (joinTimeout) {
    clearTimeout(joinTimeout);
    joinTimeout = null;
  }
  if (joinBtn) {
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join Game';
  }
});

socket.on('playerData', (data) => {
  console.log('Received playerData:', data);
  
  if (joinTimeout) {
    clearTimeout(joinTimeout);
    joinTimeout = null;
  }
  
  playerData = data;
  
  if (playerNameDisplay) {
    playerNameDisplay.textContent = data.name;
  }
  if (creditsAmount) {
    creditsAmount.textContent = formatCredits(data.credits);
  }
  
  if (welcomeScreen) {
    welcomeScreen.classList.add('hidden');
  }
  if (mainScreen) {
    mainScreen.classList.remove('hidden');
  }
  
  if (joinBtn) {
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join Game';
  }
  
  console.log('Successfully joined game. Switched to main screen.');
});

socket.on('availableRooms', (rooms) => {
  if (!roomList) return;
  
  roomList.innerHTML = '';
  if (rooms.length === 0) {
    roomList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No rooms available. Create a new room to start playing!</p>';
  } else {
    rooms.forEach(room => {
      const roomItem = document.createElement('div');
      roomItem.className = 'room-item';
      roomItem.innerHTML = `
        <div class="room-item-info">
          <h3>${room.roomId}</h3>
          <p><strong>Creator:</strong> ${room.creatorName}</p>
          <p><strong>Bet Amount:</strong> <span class="credit-amount">${formatCredits(room.betAmount)}</span> credits</p>
          <p><strong>Choice:</strong> ${room.creatorChoice}</p>
        </div>
        <button class="btn btn-primary" onclick="window.joinRoom('${room.roomId}')">Join Room</button>
      `;
      roomList.appendChild(roomItem);
    });
  }
});

window.joinRoom = function(roomId) {
  socket.emit('joinRoom', { roomId });
};

socket.on('roomCreated', ({ roomId, betAmount, choice, credits }) => {
  console.log('Room created:', roomId);
  currentRoomId = roomId;
  isCreator = true;
  gameFinished = false; // Reset game finished state
  playerData.credits = credits;
  
  if (creditsAmount) {
    creditsAmount.textContent = formatCredits(credits);
  }
  if (currentRoomIdDisplay) {
    currentRoomIdDisplay.textContent = roomId;
  }
  if (roomSelection) {
    roomSelection.classList.add('hidden');
  }
  if (gameRoom) {
    gameRoom.classList.remove('hidden');
  }
  if (confirmationSection) {
    confirmationSection.classList.add('hidden');
  }
  if (resultsSection) {
    resultsSection.classList.add('hidden');
  }
  
  // Update player 1 (creator) info - don't show credits on card
  if (player1Name) player1Name.textContent = playerData.name;
  if (player1Bet) player1Bet.textContent = `Bet: ${formatCredits(betAmount)}`;
  if (player1Choice) {
    player1Choice.textContent = choice;
    player1Choice.classList.add(choice.toLowerCase());
  }
  
  if (gameStatus) {
    gameStatus.classList.remove('hidden');
  }
  if (statusMessage) {
    statusMessage.textContent = 'Room created! Waiting for opponent to join...';
  }
  
  if (player1Card) player1Card.classList.add('active');
  if (player2Card) player2Card.classList.remove('active');
  
  resetGameUI();
});

socket.on('joinedRoom', ({ roomId, betAmount, creatorChoice, creatorName }) => {
  console.log('Joined room:', roomId);
  currentRoomId = roomId;
  isCreator = false;
  gameFinished = false; // Reset game finished state
  
  // Calculate joiner's choice (opposite of creator)
  const joinerChoice = creatorChoice === 'Heads' ? 'Tails' : 'Heads';
  
  if (currentRoomIdDisplay) {
    currentRoomIdDisplay.textContent = roomId;
  }
  if (roomSelection) {
    roomSelection.classList.add('hidden');
  }
  if (gameRoom) {
    gameRoom.classList.remove('hidden');
  }
  if (confirmationSection) {
    confirmationSection.classList.remove('hidden');
  }
  if (resultsSection) {
    resultsSection.classList.add('hidden');
  }
  
  if (confirmBetAmount) {
    confirmBetAmount.textContent = formatCredits(betAmount);
  }
  if (confirmCreatorChoice) {
    confirmCreatorChoice.textContent = creatorChoice;
    confirmCreatorChoice.className = `choice-display ${creatorChoice.toLowerCase()}`;
  }
  
  // Update joiner choice display in confirmation section
  const confirmJoinerChoice = document.getElementById('confirmJoinerChoice');
  if (confirmJoinerChoice) {
    confirmJoinerChoice.textContent = joinerChoice;
    confirmJoinerChoice.className = `choice-display confirm-choice ${joinerChoice.toLowerCase()}`;
  }
  
  // Update player 2 choice display immediately
  if (player2Choice) {
    player2Choice.textContent = joinerChoice;
    player2Choice.classList.add(joinerChoice.toLowerCase());
  }
  
  if (gameStatus) {
    gameStatus.classList.remove('hidden');
  }
  if (statusMessage) {
    statusMessage.textContent = `Joined room created by ${creatorName}. Review details and confirm participation.`;
  }
  
  resetGameUI();
  
  // Show player 2 choice even before confirmation
  if (player2Choice) {
    player2Choice.textContent = joinerChoice;
    player2Choice.classList.add(joinerChoice.toLowerCase());
  }
});

socket.on('opponentJoined', ({ opponentName }) => {
  if (gameStatus) {
    gameStatus.classList.remove('hidden');
  }
  if (statusMessage) {
    statusMessage.textContent = `${opponentName} joined! Waiting for them to confirm participation...`;
  }
});

socket.on('playersUpdate', ({ player1, player2, betAmount, creatorChoice }) => {
  if (player1Name) player1Name.textContent = player1.name;
  // Don't display opponent credits - only show our own credits in header
  if (player2Name) player2Name.textContent = player2.name;
  
  // Calculate joiner's choice (opposite of creator)
  const joinerChoice = creatorChoice === 'Heads' ? 'Tails' : 'Heads';
  
  // Update bet info
  if (player1Bet) player1Bet.textContent = `Bet: ${formatCredits(betAmount)}`;
  if (player1Choice && creatorChoice) {
    player1Choice.textContent = creatorChoice;
    player1Choice.className = 'player-card-choice ' + creatorChoice.toLowerCase();
  }
  if (player2Bet) player2Bet.textContent = `Bet: ${formatCredits(betAmount)}`;
  // Show joiner's choice (opposite of creator)
  if (player2Choice) {
    player2Choice.textContent = joinerChoice;
    player2Choice.className = 'player-card-choice ' + joinerChoice.toLowerCase();
  }
  
  // Update player cards based on who is you
  const isPlayer1 = player1.name === playerData.name;
  if (player1Card && player2Card) {
    if (isPlayer1) {
      player1Card.classList.add('active');
      player2Card.classList.remove('active');
    } else {
      player2Card.classList.add('active');
      player1Card.classList.remove('active');
    }
  }
});

socket.on('coinFlipResult', ({ coinResult: result, results, betAmount, creatorChoice, choices }) => {
  gameFinished = true; // Mark game as finished
  
  if (confirmationSection) {
    confirmationSection.classList.add('hidden');
  }
  
  // Hide status message once game starts
  if (gameStatus) {
    gameStatus.classList.add('hidden');
  }
  
  // Clear winner/loser classes from previous rounds
  if (player1Card) {
    player1Card.classList.remove('winner', 'loser');
  }
  if (player2Card) {
    player2Card.classList.remove('winner', 'loser');
  }
  
  const playerId = socket.id;
  
  // Update choices display from server data IMMEDIATELY (before coin flip animation)
  // This ensures choices are visible during the coin flip
  if (choices && player1Name && player2Name) {
    // Find which socket IDs correspond to player1 and player2
    // Player1 is the first player in the room (usually creator)
    // We need to match by checking the current player's position
    const allPlayerIds = Object.keys(choices);
    
    // We'll update based on the player names we have displayed
    // Check if current player is player1 (their name matches player1Name)
    const isPlayer1 = player1Name.textContent === playerData.name;
    
    if (isPlayer1) {
      // Current player is player1
      if (player1Choice && choices[playerId]) {
        player1Choice.textContent = choices[playerId];
        player1Choice.className = 'player-card-choice ' + choices[playerId].toLowerCase();
      }
      const opponentId = allPlayerIds.find(id => id !== playerId);
      if (player2Choice && opponentId && choices[opponentId]) {
        player2Choice.textContent = choices[opponentId];
        player2Choice.className = 'player-card-choice ' + choices[opponentId].toLowerCase();
      }
    } else {
      // Current player is player2
      if (player2Choice && choices[playerId]) {
        player2Choice.textContent = choices[playerId];
        player2Choice.className = 'player-card-choice ' + choices[playerId].toLowerCase();
      }
      const opponentId = allPlayerIds.find(id => id !== playerId);
      if (player1Choice && opponentId && choices[opponentId]) {
        player1Choice.textContent = choices[opponentId];
        player1Choice.className = 'player-card-choice ' + choices[opponentId].toLowerCase();
      }
    }
  }
  
  // Animate coin flip with appropriate animation
  if (coin) {
    coin.classList.remove('flipping-heads', 'flipping-tails', 'show-heads', 'show-tails');
    if (result === 'Heads') {
      coin.classList.add('flipping-heads');
    } else {
      coin.classList.add('flipping-tails');
    }
  }
  
  setTimeout(() => {
    if (coin) {
      coin.classList.remove('flipping-heads', 'flipping-tails');
      if (result === 'Heads') {
        coin.classList.add('show-heads');
      } else {
        coin.classList.add('show-tails');
      }
    }
    
    // Show result
    if (coinResult) {
      coinResult.textContent = `Result: ${result}`;
      coinResult.classList.add('show');
    }
    
    // Update credits
    playerData.credits = results[playerId].newCredits;
    if (creditsAmount) {
      creditsAmount.textContent = formatCredits(playerData.credits);
    }
    
    // Don't update opponent credits - we don't share credit values
    
    // Mark winner and loser on player cards
    const playerResult = results[playerId];
    const opponentId = Object.keys(results).find(id => id !== playerId);
    const isPlayer1 = player1Name && player1Name.textContent === playerData.name;
    
    if (playerResult.won) {
      // Current player won
      if (isPlayer1 && player1Card) {
        player1Card.classList.add('winner');
      } else if (!isPlayer1 && player2Card) {
        player2Card.classList.add('winner');
      }
      // Mark opponent as loser
      if (isPlayer1 && player2Card) {
        player2Card.classList.add('loser');
      } else if (!isPlayer1 && player1Card) {
        player1Card.classList.add('loser');
      }
    } else {
      // Current player lost
      if (isPlayer1 && player1Card) {
        player1Card.classList.add('loser');
      } else if (!isPlayer1 && player2Card) {
        player2Card.classList.add('loser');
      }
      // Mark opponent as winner
      if (isPlayer1 && player2Card) {
        player2Card.classList.add('winner');
      } else if (!isPlayer1 && player1Card) {
        player1Card.classList.add('winner');
      }
    }
    
    // Show result message
    if (resultMessage) {
      if (playerResult.won) {
        resultMessage.textContent = `🎉 You Won! +${formatCredits(playerResult.winnings)} credits`;
        resultMessage.className = 'result-message win';
        if (coinResult) coinResult.classList.add('winner');
      } else {
        resultMessage.textContent = `😔 You Lost! -${formatCredits(betAmount)} credits`;
        resultMessage.className = 'result-message lose';
        if (coinResult) coinResult.classList.add('loser');
      }
    }
    
    if (resultsSection) {
      resultsSection.classList.remove('hidden');
    }
    
    // Players can now leave on their own by clicking the leave room button
    
  }, 2000);
});

socket.on('opponentLeft', () => {
  // If game has finished, keep results visible and don't reset UI
  if (gameFinished) {
    // Game is over - just update player 2 display to show they left
    if (player2Name) player2Name.textContent = 'Left';
    // Keep results section visible
    if (resultsSection) {
      resultsSection.classList.remove('hidden');
    }
    // Keep status message hidden since game is over
    if (gameStatus) {
      gameStatus.classList.add('hidden');
    }
    return; // Don't reset anything else
  }
  
  // Game hasn't finished - normal behavior (waiting for another player)
  if (gameStatus) {
    gameStatus.classList.remove('hidden');
  }
  if (statusMessage) {
    statusMessage.textContent = 'Opponent left. Waiting for another player to join...';
  }
  // Reset game state - don't leave room, creator stays and waits
  if (confirmationSection) {
    confirmationSection.classList.add('hidden');
  }
  if (resultsSection) {
    resultsSection.classList.add('hidden');
  }
  resetGameUI();
  
  // Update player 2 display to show waiting state
  if (player2Name) player2Name.textContent = 'Waiting...';
  if (player2Bet) player2Bet.textContent = 'No bet';
  if (player2Choice) {
    player2Choice.textContent = '';
    player2Choice.className = 'player-card-choice';
  }
});

socket.on('leftRoom', () => {
  currentRoomId = null;
  isCreator = false;
  gameFinished = false; // Reset game finished state
  createChoice = null;
  if (createBetAmountInput) createBetAmountInput.value = '';
  if (createChooseHeadsBtn) createChooseHeadsBtn.classList.remove('selected');
  if (createChooseTailsBtn) createChooseTailsBtn.classList.remove('selected');
  updateCreateRoomButton();
  
  if (gameRoom) gameRoom.classList.add('hidden');
  if (roomSelection) roomSelection.classList.remove('hidden');
  resetGameUI();
});

function resetGameUI() {
  if (player1Bet) player1Bet.textContent = 'No bet';
  if (player2Bet) player2Bet.textContent = 'No bet';
  if (player1Choice) {
    player1Choice.textContent = '';
    player1Choice.className = 'player-card-choice';
  }
  if (player2Choice) {
    player2Choice.textContent = '';
    player2Choice.className = 'player-card-choice';
  }
  if (coin) {
    coin.classList.remove('flipping-heads', 'flipping-tails', 'show-heads', 'show-tails');
  }
  if (coinResult) {
    coinResult.classList.remove('show', 'winner', 'loser');
    coinResult.textContent = '';
  }
  // Clear winner/loser classes
  if (player1Card) {
    player1Card.classList.remove('winner', 'loser');
  }
  if (player2Card) {
    player2Card.classList.remove('winner', 'loser');
  }
}

function formatCredits(amount) {
  return amount.toLocaleString();
}

function showError(message) {
  if (!errorMessage || !errorToast) return;
  
  errorMessage.textContent = message;
  errorToast.classList.remove('hidden');
  setTimeout(() => {
    if (errorToast) {
      errorToast.classList.add('hidden');
    }
  }, 3000);
}
