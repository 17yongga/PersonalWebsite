const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs").promises;
const bcrypt = require("bcrypt");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static("."));
app.use(express.json());

// Initial credits for new players
const INITIAL_CREDITS = 10000;

// User data file path
const USERS_FILE = path.join(__dirname, "casino-users.json");

// Player data: { socketId: { username, credits, roomId, userId } }
const players = {};

// Socket to user mapping: { socketId: userId }
const socketToUser = {};

// Load users from file
async function loadUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, create empty users object
      await saveUsers({});
      return {};
    }
    throw error;
  }
}

// Save users to file
async function saveUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

// Get users object
let users = {};
loadUsers().then(data => {
  users = data;
}).catch(err => {
  console.error("Error loading users:", err);
});

// Save user balance
async function saveUserBalance(userId, credits) {
  if (users[userId]) {
    users[userId].credits = credits;
    users[userId].lastPlayed = new Date().toISOString();
    await saveUsers(users);
  }
}

// Roulette game state
let rouletteState = {
  currentBets: {}, // { socketId: { color: 'red'|'black'|'green', amount: number } }
  spinning: false,
  lastResult: null,
  spinTimer: null,
  nextSpinTime: null,
  history: [] // Array of last 50 results: { number, color, timestamp }
};

// Coinflip game state
// Room data: { roomId: { creatorId, betAmount, creatorChoice, players: [socketId1, socketId2], confirmed: false, gameState: 'waiting'|'confirmed'|'flipping'|'finished', coinResult: null } }
const coinflipRooms = {};
let coinflipRoomCounter = 1;

// Roulette numbers: 0-14, 0=green, 1-14 alternating red/black
const rouletteNumbers = [
  { num: 0, color: 'green' },
  { num: 1, color: 'red' },
  { num: 2, color: 'black' },
  { num: 3, color: 'red' },
  { num: 4, color: 'black' },
  { num: 5, color: 'red' },
  { num: 6, color: 'black' },
  { num: 7, color: 'red' },
  { num: 8, color: 'black' },
  { num: 9, color: 'red' },
  { num: 10, color: 'black' },
  { num: 11, color: 'red' },
  { num: 12, color: 'black' },
  { num: 13, color: 'red' },
  { num: 14, color: 'black' }
];

// Start auto-spin timer
function startRouletteTimer() {
  // Clear any existing timers
  if (rouletteState.spinTimer) {
    clearInterval(rouletteState.spinTimer);
    rouletteState.spinTimer = null;
  }
  if (rouletteState.countdownTimer) {
    clearTimeout(rouletteState.countdownTimer);
    rouletteState.countdownTimer = null;
  }

  // Only update next spin time if it's not already set (to avoid overwriting)
  if (!rouletteState.nextSpinTime || rouletteState.nextSpinTime < Date.now()) {
    updateNextSpinTime();
  }

  // Calculate time until spin based on nextSpinTime
  const timeUntilSpin = Math.max(0, rouletteState.nextSpinTime - Date.now());

  // Wait for countdown to complete before spinning
  rouletteState.countdownTimer = setTimeout(() => {
    if (!rouletteState.spinning) {
      spinRoulette();
      // Note: Next timer will be started after spin completes (in spinRoulette)
    }
  }, timeUntilSpin);
}

function updateNextSpinTime() {
  rouletteState.nextSpinTime = Date.now() + 15000; // 15 seconds - time for players to place bets
  io.emit('nextSpinTime', { time: rouletteState.nextSpinTime });
}

function spinRoulette() {
  if (rouletteState.spinning) return;

  rouletteState.spinning = true;
  
  // Pick random number
  const winningNumber = Math.floor(Math.random() * 15); // 0-14
  const winningColor = rouletteNumbers[winningNumber].color;

  // Emit spin start
  io.emit('rouletteSpinStart', {
    winningNumber,
    winningColor,
    bets: getBetsSnapshot()
  });

  // After 2 seconds (animation), calculate results
  setTimeout(() => {
    const results = {};
    const totalPayout = 0;

    // Calculate winnings for each player
    Object.keys(rouletteState.currentBets).forEach(socketId => {
      const bet = rouletteState.currentBets[socketId];
      if (bet.color === winningColor) {
        // Different payout multipliers based on color
        let multiplier = 2; // Default for red/black
        if (winningColor === 'green') {
          multiplier = 14; // 14x payout for green
        }
        const winnings = bet.amount * multiplier;
        if (players[socketId]) {
          players[socketId].credits += winnings;
          // Save balance to file
          const userId = players[socketId].userId;
          if (userId) {
            saveUserBalance(userId, players[socketId].credits).catch(err => {
              console.error("Error saving balance:", err);
            });
          }
          results[socketId] = {
            won: true,
            winnings: winnings,
            newCredits: players[socketId].credits,
            bet: bet
          };
        }
      } else {
        // Lost
        if (players[socketId]) {
          results[socketId] = {
            won: false,
            winnings: 0,
            newCredits: players[socketId].credits,
            bet: bet
          };
        }
      }
    });

    // Emit results
    io.emit('rouletteSpinResult', {
      winningNumber,
      winningColor,
      results,
      bets: getBetsSnapshot(),
      history: rouletteState.history
    });

    // Clear bets and reset
    rouletteState.currentBets = {};
    rouletteState.lastResult = { number: winningNumber, color: winningColor };
    rouletteState.spinning = false;
    
    // Add to history (keep last 50)
    rouletteState.history.unshift({
      number: winningNumber,
      color: winningColor,
      timestamp: Date.now()
    });
    if (rouletteState.history.length > 50) {
      rouletteState.history.pop();
    }

    // Wait for animation to complete and result to be displayed before starting timer
    // Animation takes ~4-6 seconds, then we show the result
    // So we wait ~6 seconds before starting the countdown
    setTimeout(() => {
      // Calculate next spin time: 15 seconds from now (after result is displayed)
      const timeUntilNextSpin = 15000; // 15 seconds
      rouletteState.nextSpinTime = Date.now() + timeUntilNextSpin;
      io.emit('nextSpinTime', { time: rouletteState.nextSpinTime });
      
      // Schedule next spin
      startRouletteTimer();
    }, 6000); // Wait 6 seconds for animation + result display
    }, 2000);
}

function getBetsSnapshot() {
  const snapshot = {};
  Object.keys(rouletteState.currentBets).forEach(socketId => {
    if (players[socketId]) {
      snapshot[socketId] = {
        playerName: players[socketId].username,
        color: rouletteState.currentBets[socketId].color,
        amount: rouletteState.currentBets[socketId].amount
      };
    }
  });
  return snapshot;
}

// Authentication endpoints
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: "Username must be between 3 and 20 characters" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Check if user already exists
    if (users[username]) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    users[username] = {
      username,
      password: hashedPassword,
      credits: INITIAL_CREDITS,
      createdAt: new Date().toISOString(),
      lastPlayed: new Date().toISOString()
    };

    await saveUsers(users);

    res.json({ 
      success: true, 
      message: "Account created successfully",
      credits: INITIAL_CREDITS
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    // Check if user exists
    const user = users[username];
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Update last played
    user.lastPlayed = new Date().toISOString();
    await saveUsers(users);

    res.json({ 
      success: true, 
      username: user.username,
      credits: user.credits
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Send current roulette state
  socket.emit('rouletteState', {
    spinning: rouletteState.spinning,
    lastResult: rouletteState.lastResult,
    currentBets: getBetsSnapshot(),
    nextSpinTime: rouletteState.nextSpinTime,
    history: rouletteState.history
  });

  socket.on("joinCasino", async ({ username }) => {
    if (!username || username.trim() === "") {
      socket.emit("error", "Please provide a valid username");
      return;
    }

    // Check if user exists
    const user = users[username];
    if (!user) {
      socket.emit("error", "User not found. Please register first.");
      return;
    }

    // Initialize player data with saved balance
    players[socket.id] = {
      username: username.trim(),
      credits: user.credits,
      roomId: null,
      userId: username
    };

    socketToUser[socket.id] = username;

    socket.emit("playerData", {
      username: players[socket.id].username,
      credits: players[socket.id].credits
    });

    // Send current roulette state
    socket.emit('rouletteState', {
      spinning: rouletteState.spinning,
      lastResult: rouletteState.lastResult,
      currentBets: getBetsSnapshot(),
      nextSpinTime: rouletteState.nextSpinTime,
      history: rouletteState.history
    });
  });

  socket.on("placeRouletteBet", ({ color, amount }) => {
    if (!players[socket.id]) {
      socket.emit("error", "Please join the casino first");
      return;
    }

    if (rouletteState.spinning) {
      socket.emit("error", "Cannot place bets while wheel is spinning");
      return;
    }

    // Check if player already has a bet
    if (rouletteState.currentBets[socket.id]) {
      socket.emit("error", "You can only place one bet per round. Please clear your current bet first.");
      return;
    }

    if (color !== 'red' && color !== 'black' && color !== 'green') {
      socket.emit("error", "Invalid color. Choose red, black, or green");
      return;
    }

    const betAmount = parseInt(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
      socket.emit("error", "Invalid bet amount");
      return;
    }

    if (betAmount > players[socket.id].credits) {
      socket.emit("error", "Insufficient credits");
      return;
    }

    // Deduct credits
    players[socket.id].credits -= betAmount;
    
    // Save balance to file
    const userId = players[socket.id].userId;
    if (userId) {
      saveUserBalance(userId, players[socket.id].credits).catch(err => {
        console.error("Error saving balance:", err);
      });
    }

    // Place bet
    rouletteState.currentBets[socket.id] = { color, amount: betAmount };

    // Update player data
    socket.emit("playerData", {
      username: players[socket.id].username,
      credits: players[socket.id].credits
    });

    // Broadcast updated bets to all players
    io.emit('rouletteBetsUpdate', {
      bets: getBetsSnapshot()
    });
  });

  socket.on("clearRouletteBet", () => {
    if (!players[socket.id]) {
      return;
    }

    if (rouletteState.spinning) {
      socket.emit("error", "Cannot clear bets while wheel is spinning");
      return;
    }

    if (rouletteState.currentBets[socket.id]) {
      const bet = rouletteState.currentBets[socket.id];
      // Refund credits
      players[socket.id].credits += bet.amount;
      
      // Save balance to file
      const userId = players[socket.id].userId;
      if (userId) {
        saveUserBalance(userId, players[socket.id].credits).catch(err => {
          console.error("Error saving balance:", err);
        });
      }
      
      delete rouletteState.currentBets[socket.id];

      // Update player data
      socket.emit("playerData", {
        username: players[socket.id].username,
        credits: players[socket.id].credits
      });

      // Broadcast updated bets
      io.emit('rouletteBetsUpdate', {
        bets: getBetsSnapshot()
      });
    }
  });

  // ========== COINFLIP GAME HANDLERS ==========
  
  socket.on("joinGame", (playerName, initialCredits) => {
    if (!playerName || playerName.trim() === "") {
      socket.emit("error", "Please enter a valid name");
      return;
    }

    // Check if player already exists in our players object
    const existingPlayer = Object.values(players).find(p => p.username === playerName.trim());
    let playerCredits = INITIAL_CREDITS;
    
    if (existingPlayer) {
      // Player already exists - use their credits
      playerCredits = existingPlayer.credits;
    } else if (initialCredits !== undefined && initialCredits !== null) {
      // Use provided initial credits (from casino)
      playerCredits = parseInt(initialCredits) || INITIAL_CREDITS;
    }

    // Initialize or update player data if not already set
    if (!players[socket.id]) {
      players[socket.id] = {
        username: playerName.trim(),
        credits: playerCredits,
        roomId: null,
        userId: playerName.trim() // Use username as userId for coinflip
      };
      socketToUser[socket.id] = playerName.trim();
    } else {
      // Update credits if different
      players[socket.id].credits = playerCredits;
    }

    socket.emit("playerData", {
      name: players[socket.id].username,
      credits: players[socket.id].credits
    });

    // Send available rooms
    emitAvailableCoinflipRooms(socket);
  });

  socket.on("createRoom", ({ betAmount, choice }) => {
    if (!players[socket.id]) {
      socket.emit("error", "Please join the game first");
      return;
    }

    const betAmountNum = parseInt(betAmount);
    if (isNaN(betAmountNum) || betAmountNum <= 0) {
      socket.emit("error", "Invalid bet amount");
      return;
    }

    if (betAmountNum > players[socket.id].credits) {
      socket.emit("error", "Insufficient credits");
      return;
    }

    if (choice !== 'Heads' && choice !== 'Tails') {
      socket.emit("error", "Invalid choice");
      return;
    }

    // Deduct credits from creator
    players[socket.id].credits -= betAmountNum;
    
    // Save balance
    const userId = players[socket.id].userId;
    if (userId && users[userId]) {
      saveUserBalance(userId, players[socket.id].credits).catch(err => {
        console.error("Error saving balance:", err);
      });
    }

    const roomId = `room-${String(coinflipRoomCounter).padStart(3, '0')}`;
    coinflipRoomCounter++;
    
    socket.join(roomId);
    players[socket.id].roomId = roomId;
    
    coinflipRooms[roomId] = {
      creatorId: socket.id,
      betAmount: betAmountNum,
      creatorChoice: choice,
      players: [socket.id],
      confirmed: false,
      gameState: 'waiting',
      coinResult: null
    };

    socket.emit("roomCreated", { 
      roomId,
      betAmount: betAmountNum,
      choice: choice,
      credits: players[socket.id].credits
    });

    socket.emit("gameState", {
      state: 'waiting',
      message: "Room created! Waiting for opponent to join..."
    });

    emitAvailableCoinflipRooms();
  });

  socket.on("joinRoom", ({ roomId }) => {
    if (!players[socket.id]) {
      socket.emit("error", "Please join the game first");
      return;
    }

    const room = coinflipRooms[roomId];
    if (!room) {
      socket.emit("error", "Room not found");
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("error", "Room is full");
      return;
    }

    socket.join(roomId);
    players[socket.id].roomId = roomId;
    room.players.push(socket.id);

    // Notify both players (without sharing credits)
    io.to(roomId).emit("playersUpdate", {
      player1: {
        name: players[room.players[0]].username
      },
      player2: {
        name: players[room.players[1]].username
      },
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice
    });

    // Notify the joiner about the room details
    socket.emit("joinedRoom", {
      roomId,
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice,
      creatorName: players[room.creatorId].username
    });

    // Notify the creator that someone joined
    io.to(room.creatorId).emit("opponentJoined", {
      opponentName: players[socket.id].username
    });

    emitAvailableCoinflipRooms();
  });

  socket.on("confirmParticipation", ({ roomId }) => {
    const room = coinflipRooms[roomId];
    if (!room || !room.players.includes(socket.id)) {
      socket.emit("error", "You are not in this room");
      return;
    }

    if (room.gameState !== 'waiting') {
      socket.emit("error", "Game already started");
      return;
    }

    // Deduct credits from the joiner (they match the creator's bet)
    if (socket.id !== room.creatorId) {
      if (players[socket.id].credits < room.betAmount) {
        socket.emit("error", "Insufficient credits");
        return;
      }
      players[socket.id].credits -= room.betAmount;
      
      // Save balance
      const userId = players[socket.id].userId;
      if (userId && users[userId]) {
        saveUserBalance(userId, players[socket.id].credits).catch(err => {
          console.error("Error saving balance:", err);
        });
      }
    }

    room.confirmed = true;
    room.gameState = 'flipping';

    // Perform coin flip
    const coinResult = Math.random() > 0.5 ? 'Heads' : 'Tails';
    room.coinResult = coinResult;

    // Calculate winnings
    // Joiner automatically gets the opposite choice of creator
    const joinerChoice = room.creatorChoice === 'Heads' ? 'Tails' : 'Heads';
    
    const results = {};
    const creatorId = room.creatorId;
    const joinerId = room.players.find(id => id !== creatorId);

    if (room.creatorChoice === coinResult) {
      // Creator wins - gets both bets
      const winnings = room.betAmount * 2;
      players[creatorId].credits += winnings;
      
      // Save creator balance
      const creatorUserId = players[creatorId].userId;
      if (creatorUserId && users[creatorUserId]) {
        saveUserBalance(creatorUserId, players[creatorId].credits).catch(err => {
          console.error("Error saving balance:", err);
        });
      }
      
      results[creatorId] = {
        won: true,
        winnings: winnings,
        newCredits: players[creatorId].credits,
        choice: room.creatorChoice
      };
      results[joinerId] = {
        won: false,
        winnings: 0,
        newCredits: players[joinerId].credits,
        choice: joinerChoice
      };
    } else {
      // Joiner wins - gets both bets
      const winnings = room.betAmount * 2;
      players[joinerId].credits += winnings;
      
      // Save joiner balance
      const joinerUserId = players[joinerId].userId;
      if (joinerUserId && users[joinerUserId]) {
        saveUserBalance(joinerUserId, players[joinerId].credits).catch(err => {
          console.error("Error saving balance:", err);
        });
      }
      
      results[joinerId] = {
        won: true,
        winnings: winnings,
        newCredits: players[joinerId].credits,
        choice: joinerChoice
      };
      results[creatorId] = {
        won: false,
        winnings: 0,
        newCredits: players[creatorId].credits,
        choice: room.creatorChoice
      };
    }
    
    // Store choices for display
    room.choices = {
      [creatorId]: room.creatorChoice,
      [joinerId]: joinerChoice
    };

    // Emit results
    io.to(roomId).emit("coinFlipResult", {
      coinResult: coinResult,
      results: results,
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice,
      choices: room.choices
    });

    room.gameState = 'finished';
  });

  socket.on("leaveRoom", () => {
    if (players[socket.id] && players[socket.id].roomId) {
      const roomId = players[socket.id].roomId;
      const room = coinflipRooms[roomId];
      
      if (room) {
        const isCreator = socket.id === room.creatorId;
        socket.leave(roomId);
        room.players = room.players.filter(id => id !== socket.id);
        
        if (isCreator) {
          // Creator is leaving - refund their bet and delete room
          if (!room.confirmed) {
            players[socket.id].credits += room.betAmount;
            
            // Save balance
            const userId = players[socket.id].userId;
            if (userId && users[userId]) {
              saveUserBalance(userId, players[socket.id].credits).catch(err => {
                console.error("Error saving balance:", err);
              });
            }
          }
          delete coinflipRooms[roomId];
        } else {
          // Joiner is leaving
          if (room.gameState === 'finished') {
            // Game already finished - don't reset
          } else {
            // Game hasn't finished - reset room state back to waiting
            room.gameState = 'waiting';
            room.confirmed = false;
          }
          
          // Notify creator that opponent left
          io.to(room.creatorId).emit("opponentLeft");
        }

        if (room.players.length === 0) {
          delete coinflipRooms[roomId];
        }

        players[socket.id].roomId = null;
        emitAvailableCoinflipRooms();
      }
    }

    socket.emit("leftRoom");
    emitAvailableCoinflipRooms(socket);
  });

  socket.on("disconnect", async () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    // Save balance before disconnecting
    if (players[socket.id] && players[socket.id].userId) {
      await saveUserBalance(players[socket.id].userId, players[socket.id].credits);
    }
    
    // Handle coinflip room cleanup
    if (players[socket.id] && players[socket.id].roomId) {
      const roomId = players[socket.id].roomId;
      const room = coinflipRooms[roomId];
      
      if (room) {
        socket.leave(roomId);
        room.players = room.players.filter(id => id !== socket.id);
        
        // Refund creator's bet if they disconnect before confirmation
        if (socket.id === room.creatorId && !room.confirmed) {
          players[socket.id].credits += room.betAmount;
        }

        const isCreator = socket.id === room.creatorId;
        
        if (room.players.length === 0) {
          delete coinflipRooms[roomId];
        } else if (!isCreator) {
          // Joiner disconnected
          if (room.gameState === 'finished') {
            // Game already finished - don't reset
          } else {
            // Game hasn't finished - reset room state
            room.gameState = 'waiting';
            room.confirmed = false;
          }
          const remainingPlayerId = room.players[0];
          io.to(remainingPlayerId).emit("opponentLeft");
        } else {
          // Creator disconnected - refund bet if not confirmed
          if (!room.confirmed) {
            players[socket.id].credits += room.betAmount;
          }
          delete coinflipRooms[roomId];
        }
      }
    }
    
    // Remove player's bet if they disconnect
    if (rouletteState.currentBets[socket.id]) {
      delete rouletteState.currentBets[socket.id];
      io.emit('rouletteBetsUpdate', {
        bets: getBetsSnapshot()
      });
    }

    delete socketToUser[socket.id];
    delete players[socket.id];
    emitAvailableCoinflipRooms();
  });
});

// Helper function to emit available coinflip rooms
function emitAvailableCoinflipRooms(targetSocket = null) {
  const availableRooms = Object.keys(coinflipRooms)
    .filter(roomId => {
      const room = coinflipRooms[roomId];
      // Only show rooms that are waiting, not full, not confirmed, and not finished
      return room.players.length < 2 && 
             !room.confirmed && 
             room.gameState !== 'finished' &&
             room.gameState === 'waiting';
    })
    .map(roomId => ({
      roomId,
      playerCount: coinflipRooms[roomId].players.length,
      creatorName: players[coinflipRooms[roomId].creatorId]?.username || 'Unknown',
      betAmount: coinflipRooms[roomId].betAmount,
      creatorChoice: coinflipRooms[roomId].creatorChoice
    }));

  if (targetSocket) {
    targetSocket.emit("availableRooms", availableRooms);
  } else {
    io.emit("availableRooms", availableRooms);
  }
}

// Start roulette timer
startRouletteTimer();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Casino Server running on http://localhost:${PORT}`);
  console.log(`  - Roulette game available`);
  console.log(`  - Coinflip game available`);
});

