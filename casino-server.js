const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs").promises;
const bcrypt = require("bcrypt");

// CS2 Betting API client (optional - only load if module exists)
let cs2ApiClient = null;
try {
  cs2ApiClient = require("./cs2-api-client");
  console.log("CS2 API client loaded successfully");
} catch (error) {
  console.warn("CS2 API client not available:", error.message);
  console.warn("CS2 betting features will be limited without API client");
}

// CS2 Odds Provider - Multi-source aggregator (optional - only load if module exists)
let cs2OddsProvider = null;
try {
  cs2OddsProvider = require("./cs2-odds-provider");
  console.log("CS2 Odds Provider (multi-source) loaded successfully");
  const availableSources = cs2OddsProvider.getAvailableSources();
  console.log(`  Available odds sources: ${availableSources.join(", ")}`);
} catch (error) {
  console.warn("CS2 Odds Provider not available:", error.message);
  console.warn("Falling back to single-source (OddsPapi only)");
  // Fallback to using cs2ApiClient directly
  cs2OddsProvider = cs2ApiClient;
}

// Scheduled tasks for CS2 betting (using node-cron if available)
let cron = null;
try {
  cron = require("node-cron");
  console.log("node-cron loaded successfully for scheduled tasks");
} catch (error) {
  console.warn("node-cron not available. Scheduled tasks will use setInterval instead");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// CORS middleware for Express REST API
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
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
let usersLoadedPromise = loadUsers().then(data => {
  users = data;
  console.log(`Loaded ${Object.keys(users).length} users from file`);
  return data;
}).catch(err => {
  console.error("Error loading users:", err);
  users = {};
  return {};
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
// NOTE: All coinflip server logic is consolidated here in casino-server.js
// The separate coinflip/server.js file is not used - this is the single source of truth
// Room data: { roomId: { creatorId, betAmount, creatorChoice, players: [socketId1, socketId2], confirmed: false, gameState: 'waiting'|'confirmed'|'flipping'|'finished', coinResult: null, botId: string } }
const coinflipRooms = {};
let coinflipRoomCounter = 1;

// ========== CS2 BETTING STATE ==========
// CS2 betting data file path
const CS2_BETTING_FILE = path.join(__dirname, "cs2-betting-data.json");

// CS2 betting state: { events: {}, bets: {}, lastApiSync: null }
let cs2BettingState = {
  events: {},  // { eventId: { id, teams, startTime, status, odds, ... } }
  bets: {},    // { betId: { id, userId, matchId, selection, amount, odds, status, ... } }
  lastApiSync: null
};

// Load CS2 betting data from file
async function loadCS2BettingData() {
  try {
    const data = await fs.readFile(CS2_BETTING_FILE, "utf8");
    cs2BettingState = JSON.parse(data);
    console.log(`Loaded CS2 betting data: ${Object.keys(cs2BettingState.events).length} events, ${Object.keys(cs2BettingState.bets).length} bets`);
  } catch (error) {
    if (error.code === "ENOENT") {
      // File doesn't exist, create empty state
      await saveCS2BettingData();
      console.log("Created new CS2 betting data file");
    } else {
      console.error("Error loading CS2 betting data:", error);
    }
  }
}

// Save CS2 betting data to file
async function saveCS2BettingData() {
  try {
    await fs.writeFile(CS2_BETTING_FILE, JSON.stringify(cs2BettingState, null, 2), "utf8");
  } catch (error) {
    console.error("Error saving CS2 betting data:", error);
  }
}

// Initialize CS2 betting data on startup
loadCS2BettingData().catch(err => {
  console.error("Error initializing CS2 betting data:", err);
});

// ========== END CS2 BETTING STATE ==========

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
    // Ensure users are loaded before processing registration
    await usersLoadedPromise;
    
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
    // Ensure users are loaded before processing login
    await usersLoadedPromise;
    
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    // Check if user exists
    const user = users[username];
    if (!user) {
      console.log(`Login attempt failed: user '${username}' not found. Available users: ${Object.keys(users).join(', ')}`);
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      console.log(`Login attempt failed: invalid password for user '${username}'`);
      return res.status(401).json({ error: "Invalid username or password" });
    }

    console.log(`Login successful for user '${username}'`);

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

  // Test connection handler (for debugging)
  socket.on("testConnection", (data, callback) => {
    if (callback) callback({ success: true, socketId: socket.id });
  });

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

  socket.on("playWithBot", ({ roomId }, callback) => {
    const room = coinflipRooms[roomId];
    if (!room) {
      socket.emit("error", "Room not found");
      if (callback) callback({ error: "Room not found" });
      return;
    }

    if (socket.id !== room.creatorId) {
      socket.emit("error", "Only the room creator can add a bot");
      if (callback) callback({ error: "Only the room creator can add a bot" });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("error", "Room is already full");
      if (callback) callback({ error: "Room is already full" });
      return;
    }
    if (callback) callback({ success: true });

    // Create a bot player ID (using a special prefix)
    const botId = `bot_${roomId}_${Date.now()}`;
    
    // Add bot to players list
    players[botId] = {
      username: "Bot",
      credits: room.betAmount * 10, // Give bot enough credits
      roomId: roomId,
      userId: null,
      isBot: true
    };

    // Add bot to room
    room.players.push(botId);
    room.botId = botId; // Track bot ID for cleanup

    // Bot automatically chooses opposite of creator
    const botChoice = room.creatorChoice === 'Heads' ? 'Tails' : 'Heads';

    // Deduct credits from bot (they match the creator's bet)
    players[botId].credits -= room.betAmount;

    // Mark room as confirmed (bot auto-confirms)
    room.confirmed = true;
    room.gameState = 'confirmed';

    // Notify creator about bot joining
    io.to(roomId).emit("playersUpdate", {
      player1: {
        name: players[room.creatorId].username
      },
      player2: {
        name: "Bot"
      },
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice
    });

    // Start the coin flip immediately
    setTimeout(() => {
      const coinResult = Math.random() < 0.5 ? 'Heads' : 'Tails';
      room.coinResult = coinResult;
      room.gameState = 'finished';

      const results = {};
      const creatorId = room.creatorId;
      const botId = room.botId;

      if (coinResult === room.creatorChoice) {
        // Creator wins - gets both bets
        const winnings = room.betAmount * 2;
        players[creatorId].credits += winnings;
        
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
          bet: { color: room.creatorChoice, amount: room.betAmount }
        };
        results[botId] = {
          won: false,
          winnings: 0,
          newCredits: players[botId].credits,
          bet: { color: botChoice, amount: room.betAmount }
        };
      } else {
        // Bot wins - creator loses their bet (bot doesn't receive credits, it's just a virtual opponent)
        results[creatorId] = {
          won: false,
          winnings: 0,
          newCredits: players[creatorId].credits,
          bet: { color: room.creatorChoice, amount: room.betAmount }
        };
        results[botId] = {
          won: true,
          winnings: 0, // Bot doesn't actually receive credits
          newCredits: players[botId].credits,
          bet: { color: botChoice, amount: room.betAmount }
        };
      }

      // Emit results - use socket.id for creator, botId for bot
      const resultsForClient = {
        [creatorId]: results[creatorId],
        [botId]: results[botId]
      };
      
      io.to(roomId).emit("coinFlipResult", {
        coinResult,
        results: resultsForClient,
        betAmount: room.betAmount,
        creatorChoice: room.creatorChoice,
        choices: {
          [creatorId]: room.creatorChoice,
          [botId]: botChoice
        }
      });

      // Clean up bot after a delay
      setTimeout(() => {
        if (players[botId]) {
          delete players[botId];
        }
      }, 5000);
    }, 1000); // Small delay before flipping

    emitAvailableCoinflipRooms();
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

// ========== CS2 BETTING REST API ENDPOINTS ==========

// GET /api/cs2/events - Get all CS2 events/matches
app.get("/api/cs2/events", async (req, res) => {
  try {
    // Return events from in-memory state
    const allEvents = Object.values(cs2BettingState.events);
    console.log(`[CS2 API] Total events in state: ${allEvents.length}`);
    
    // Deduplicate by fixtureId (safety check)
    const seenIds = new Set();
    const uniqueEvents = allEvents.filter(event => {
      const id = event.fixtureId || event.id;
      if (seenIds.has(id)) {
        return false;
      }
      seenIds.add(id);
      return true;
    });
    
    const eventsArray = uniqueEvents.filter(event => {
      // Only return upcoming or live matches (not finished)
      const status = event.status || 'scheduled';
      const isActive = status === 'scheduled' || status === 'live';
      
      if (!isActive) {
        console.log(`[CS2 API] Filtering out event ${event.id} with status: ${status}`);
      }
      
      return isActive;
    });
    
    // Sort chronologically (next upcoming match first - earliest scheduled time)
    eventsArray.sort((a, b) => {
      const timeA = new Date(a.commenceTime || a.startTime || 0).getTime();
      const timeB = new Date(b.commenceTime || b.startTime || 0).getTime();
      return timeA - timeB; // Ascending: earliest first (next match to happen at the top)
    });
    
    console.log(`[CS2 API] Returning ${eventsArray.length} active events (${allEvents.length - uniqueEvents.length} duplicates removed)`);
    
    // Log first event structure for debugging
    if (eventsArray.length > 0) {
      const firstEvent = eventsArray[0];
      console.log(`[CS2 API] Sample event structure:`, JSON.stringify({
        id: firstEvent.id,
        homeTeam: firstEvent.homeTeam,
        awayTeam: firstEvent.awayTeam,
        commenceTime: firstEvent.commenceTime,
        status: firstEvent.status,
        hasOdds: !!firstEvent.odds,
        odds: firstEvent.odds
      }, null, 2));
    }
    
    res.json({
      success: true,
      events: eventsArray,
      count: eventsArray.length,
      lastSync: cs2BettingState.lastApiSync
    });
  } catch (error) {
    console.error("Error fetching CS2 events:", error);
    res.status(500).json({ success: false, error: "Failed to fetch events" });
  }
});

// GET /api/cs2/events/:eventId - Get specific event details
app.get("/api/cs2/events/:eventId", async (req, res) => {
  try {
    const eventId = req.params.eventId;
    let event = cs2BettingState.events[eventId];
    
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }
    
    // Use odds provider (multi-source) if available, otherwise fallback to single source
    const oddsClient = cs2OddsProvider || cs2ApiClient;
    
    // If odds are not available, try to fetch them from API
    if ((!event.odds || !event.odds.team1) && oddsClient && event.hasOdds !== false) {
      try {
        console.log(`Fetching odds for event ${eventId} from ${cs2OddsProvider ? 'multi-source provider' : 'single source'}...`);
        
        // Prepare match info for scrapers
        const matchInfo = {
          fixtureId: eventId,
          team1: event.homeTeam || event.participant1Name,
          team2: event.awayTeam || event.participant2Name,
          homeTeam: event.homeTeam || event.participant1Name,
          awayTeam: event.awayTeam || event.participant2Name
        };
        
        const oddsData = cs2OddsProvider && cs2OddsProvider.fetchMatchOdds
          ? await cs2OddsProvider.fetchMatchOdds(eventId, matchInfo)
          : await oddsClient.fetchMatchOdds(eventId);
        
        // Handle both provider format and api-client format
        let odds = null;
        if (oddsData) {
          if (oddsData.odds) {
            odds = oddsData.odds;
          } else if (oddsData.team1 || oddsData.team2) {
            odds = {
              team1: oddsData.team1,
              team2: oddsData.team2,
              draw: oddsData.draw || null
            };
          }
        }
        
        if (odds && (odds.team1 || odds.team2)) {
          event.odds = odds;
          event.hasOdds = true;
          if (oddsData.sources) {
            event.oddsSources = oddsData.sources;
          }
          if (oddsData.confidence) {
            event.oddsConfidence = oddsData.confidence;
          }
          cs2BettingState.events[eventId] = event;
          await saveCS2BettingData();
        }
      } catch (error) {
        console.error(`Error fetching odds for event ${eventId}:`, error.message);
        // Continue with existing event data even if odds fetch fails
      }
    }
    
    res.json({ success: true, event });
  } catch (error) {
    console.error("Error fetching CS2 event:", error);
    res.status(500).json({ success: false, error: "Failed to fetch event" });
  }
});

// GET /api/cs2/events/:eventId/odds - Fetch odds for a specific event (on-demand)
app.get("/api/cs2/events/:eventId/odds", async (req, res) => {
  try {
    const eventId = req.params.eventId;
    let event = cs2BettingState.events[eventId];
    
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }
    
    // Use odds provider (multi-source) if available, otherwise fallback to single source
    const oddsClient = cs2OddsProvider || cs2ApiClient;
    
    // If odds are not available, try to fetch them from API
    if ((!event.odds || !event.odds.team1 || !event.odds.team2) && oddsClient && event.hasOdds !== false) {
      try {
        console.log(`[CS2 API] Fetching odds for event ${eventId} from ${cs2OddsProvider ? 'multi-source provider' : 'single source'}...`);
        
        // Prepare match info for scrapers
        const matchInfo = {
          fixtureId: eventId,
          team1: event.homeTeam || event.participant1Name,
          team2: event.awayTeam || event.participant2Name,
          homeTeam: event.homeTeam || event.participant1Name,
          awayTeam: event.awayTeam || event.participant2Name
        };
        
        const oddsData = cs2OddsProvider && cs2OddsProvider.fetchMatchOdds
          ? await cs2OddsProvider.fetchMatchOdds(eventId, matchInfo)
          : await oddsClient.fetchMatchOdds(eventId);
        
        // Handle both provider format and api-client format
        let odds = null;
        if (oddsData) {
          if (oddsData.odds) {
            odds = oddsData.odds;
          } else if (oddsData.team1 || oddsData.team2) {
            odds = {
              team1: oddsData.team1,
              team2: oddsData.team2,
              draw: oddsData.draw || null
            };
          }
        }
        
        if (odds && (odds.team1 || odds.team2)) {
          event.odds = odds;
          event.hasOdds = true;
          if (oddsData.sources) {
            event.oddsSources = oddsData.sources;
          }
          if (oddsData.confidence) {
            event.oddsConfidence = oddsData.confidence;
          }
          cs2BettingState.events[eventId] = event;
          await saveCS2BettingData();
          console.log(`[CS2 API] Successfully fetched and updated odds for event ${eventId}:`, event.odds);
          if (oddsData.sources) {
            console.log(`[CS2 API] Odds aggregated from sources: ${oddsData.sources.join(", ")}`);
          }
        } else {
          console.warn(`[CS2 API] No odds data returned from API for event ${eventId}`);
        }
      } catch (error) {
        console.error(`[CS2 API] Error fetching odds for event ${eventId}:`, error.message);
        // Continue with existing event data even if odds fetch fails
      }
    }
    
    res.json({ success: true, event });
  } catch (error) {
    console.error("Error fetching CS2 event odds:", error);
    res.status(500).json({ success: false, error: "Failed to fetch event odds" });
  }
});

// GET /api/cs2/bets - Get bets for a session/user
app.get("/api/cs2/bets", async (req, res) => {
  try {
    const userId = req.query.userId || req.query.sessionId;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId or sessionId required" });
    }
    
    // Filter bets by userId
    const userBets = Object.values(cs2BettingState.bets).filter(bet => bet.userId === userId);
    
    res.json({
      success: true,
      bets: userBets,
      count: userBets.length
    });
  } catch (error) {
    console.error("Error fetching CS2 bets:", error);
    res.status(500).json({ success: false, error: "Failed to fetch bets" });
  }
});

// GET /api/cs2/balance - Get credit balance for a session/user
app.get("/api/cs2/balance", async (req, res) => {
  try {
    const userId = req.query.userId || req.query.sessionId;
    
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId or sessionId required" });
    }
    
    // Use existing casino user credits (shared with casino games)
    const user = users[userId];
    if (user) {
      res.json({ success: true, balance: user.credits || 0 });
    } else {
      // If user doesn't exist, return initial credits (they'll be created on first bet)
      res.json({ success: true, balance: INITIAL_CREDITS });
    }
  } catch (error) {
    console.error("Error fetching CS2 balance:", error);
    res.status(500).json({ success: false, error: "Failed to fetch balance" });
  }
});

// POST /api/cs2/bets - Place a new bet
app.post("/api/cs2/bets", async (req, res) => {
  try {
    const { userId, eventId, selection, amount } = req.body;
    
    // Validation
    if (!userId || !eventId || !selection || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: userId, eventId, selection, amount" 
      });
    }
    
    if (typeof amount !== 'number' || amount < 1) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid bet amount. Must be a number >= 1" 
      });
    }
    
    // Check if event exists and is open for betting
    const event = cs2BettingState.events[eventId];
    if (!event) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }
    
    if (event.status !== 'scheduled') {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot place bet on event with status: ${event.status}` 
      });
    }
    
    // Validate selection (must be team1, team2, or draw)
    if (!['team1', 'team2', 'draw'].includes(selection)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid selection. Must be 'team1', 'team2', or 'draw'" 
      });
    }
    
    // Get user balance (use existing casino user system)
    let user = users[userId];
    if (!user) {
      // Create new user with initial credits
      user = {
        username: userId,
        credits: INITIAL_CREDITS,
        created: new Date().toISOString()
      };
      users[userId] = user;
      await saveUsers(users);
    }
    
    // Check sufficient credits
    if (user.credits < amount) {
      return res.status(400).json({ 
        success: false, 
        error: "Insufficient credits", 
        balance: user.credits 
      });
    }
    
    // Get odds for the selection
    const odds = event.odds && event.odds[selection];
    if (!odds || odds <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Odds not available for selection: ${selection}` 
      });
    }
    
    // Deduct credits
    user.credits -= amount;
    await saveUserBalance(userId, user.credits);
    
    // Create bet record
    const betId = `bet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const bet = {
      id: betId,
      userId: userId,
      eventId: eventId,
      selection: selection,
      amount: amount,
      odds: odds,
      potentialPayout: amount * odds,
      status: 'pending',
      placedAt: new Date().toISOString(),
      settledAt: null
    };
    
    cs2BettingState.bets[betId] = bet;
    await saveCS2BettingData();
    
    res.json({
      success: true,
      bet: bet,
      newBalance: user.credits
    });
  } catch (error) {
    console.error("Error placing CS2 bet:", error);
    res.status(500).json({ success: false, error: "Failed to place bet" });
  }
});

// Sync CS2 events/odds from API (used by scheduled tasks and manual sync)
async function syncCS2Events() {
  // Use odds provider for fetching matches (it re-exports from cs2ApiClient)
  // Fallback to cs2ApiClient if provider not available
  const matchClient = (cs2OddsProvider && cs2OddsProvider.fetchUpcomingMatches) 
    ? cs2OddsProvider 
    : cs2ApiClient;
  
  if (!matchClient) {
    console.warn("CS2 API client not available, skipping sync");
    return;
  }
  
  try {
    console.log("Syncing CS2 events from API...");
    
    // Fetch upcoming matches
    const matches = await matchClient.fetchUpcomingMatches({ limit: 50 });
    
    // Deduplicate matches by fixtureId (in case API returns duplicates)
    const uniqueMatches = [];
    const seenIds = new Set();
    
    for (const match of matches) {
      const eventId = match.fixtureId || match.id;
      if (!eventId || seenIds.has(eventId)) {
        if (seenIds.has(eventId)) {
          console.log(`[CS2 Sync] Skipping duplicate match: ${eventId}`);
        }
        continue;
      }
      seenIds.add(eventId);
      uniqueMatches.push(match);
    }
    
    console.log(`[CS2 Sync] Processing ${uniqueMatches.length} unique matches (${matches.length - uniqueMatches.length} duplicates removed)`);
    
    // Update events in state
    let updatedCount = 0;
    let newCount = 0;
    const oddsFetchPromises = []; // Batch odds fetching
    
    for (const match of uniqueMatches) {
      // Use fixtureId as the key since that's what OddsPapi uses
      const eventId = match.fixtureId || match.id;
      if (!eventId) {
        console.warn(`[CS2 Sync] Skipping match without ID:`, match);
        continue;
      }
      
      const existingEvent = cs2BettingState.events[eventId];
      
      // Determine status based on start time and API status
      const commenceTime = match.commenceTime || match.startTime;
      const startTimeObj = commenceTime ? new Date(commenceTime) : null;
      const now = new Date();
      
      let finalStatus = match.status;
      let finalCompleted = match.completed;
      
      // Override status if event is in the future (should be scheduled)
      if (startTimeObj && startTimeObj > now) {
        finalStatus = 'scheduled';
        finalCompleted = false;
      } else if (finalStatus === 'finished' || finalCompleted === true) {
        // Keep finished status if explicitly set
        finalStatus = 'finished';
        finalCompleted = true;
      } else if (match.statusId === 1 || finalStatus === 'live') {
        finalStatus = 'live';
        finalCompleted = false;
      } else if (!finalStatus) {
        // Default to scheduled if no status provided
        finalStatus = 'scheduled';
        finalCompleted = false;
      }
      
      // Use existing odds if available, otherwise initialize as null
      const existingOdds = existingEvent?.odds || match.odds || { team1: null, team2: null, draw: null };
      const needsOdds = (!existingOdds.team1 || !existingOdds.team2) && 
                        (finalStatus === 'scheduled' || finalStatus === 'live') &&
                        match.hasOdds !== false;
      
      // Queue for odds aggregation (will be processed by scheduled aggregation task)
      // No limit here since aggregation handles rate limiting
      if (needsOdds && (match.homeTeam || match.participant1Name) && (match.awayTeam || match.participant2Name)) {
        oddsFetchPromises.push({ eventId, status: finalStatus });
      }
      
      // Map to internal event format (handles both old and new API formats)
      cs2BettingState.events[eventId] = {
        id: eventId, // Use fixtureId as the primary ID
        fixtureId: eventId,
        sportId: match.sportId,
        sportName: match.sportName || match.sportTitle || match.sportKey,
        sportKey: match.sportKey || match.sportName,
        sportTitle: match.sportTitle || match.sportName,
        tournamentId: match.tournamentId,
        tournamentName: match.tournamentName,
        commenceTime: commenceTime,
        startTime: match.startTime || commenceTime,
        homeTeam: match.homeTeam || match.participant1Name || 'Team 1',
        awayTeam: match.awayTeam || match.participant2Name || 'Team 2',
        participant1Name: match.participant1Name || match.homeTeam || 'Team 1',
        participant2Name: match.participant2Name || match.awayTeam || 'Team 2',
        odds: existingOdds,
        status: finalStatus,
        statusId: match.statusId || (finalStatus === 'live' ? 1 : (finalStatus === 'finished' ? 2 : 0)),
        completed: finalCompleted,
        hasOdds: match.hasOdds !== false,
        lastUpdate: match.lastUpdate || match.updatedAt || new Date().toISOString()
      };
      
      // Debug: Log first new event structure
      if (!existingEvent && newCount === 0) {
        console.log(`[CS2 Sync] First new event structure:`, JSON.stringify(cs2BettingState.events[eventId], null, 2));
      }
      
      if (existingEvent) {
        updatedCount++;
      } else {
        newCount++;
      }
    }
    
    // Fetch odds sequentially with delays to respect rate limits (500ms cooldown per OddsPapi docs)
    if (oddsFetchPromises.length > 0) {
      console.log(`[CS2 Sync] Fetching odds for ${oddsFetchPromises.length} matches sequentially...`);
      
      for (let i = 0; i < oddsFetchPromises.length; i++) {
        const { eventId } = oddsFetchPromises[i];
        
        try {
          // Respect rate limit: 500ms cooldown between requests
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 600)); // 600ms delay (500ms + buffer)
          }
          
          console.log(`[CS2 Sync] Fetching odds for event ${eventId} (${i + 1}/${oddsFetchPromises.length})...`);
          // Use odds provider (multi-source) if available
          const oddsClient = cs2OddsProvider || cs2ApiClient;
          const event = cs2BettingState.events[eventId];
          
          // Prepare match info for scrapers
          const matchInfo = {
            fixtureId: eventId,
            team1: event?.homeTeam || event?.participant1Name,
            team2: event?.awayTeam || event?.participant2Name,
            homeTeam: event?.homeTeam || event?.participant1Name,
            awayTeam: event?.awayTeam || event?.participant2Name
          };
          
          const oddsData = cs2OddsProvider && cs2OddsProvider.fetchMatchOdds
            ? await cs2OddsProvider.fetchMatchOdds(eventId, matchInfo)
            : await oddsClient.fetchMatchOdds(eventId);
          
          // Handle both provider format and api-client format
          let odds = null;
          if (oddsData) {
            if (oddsData.odds) {
              odds = oddsData.odds;
            } else if (oddsData.team1 || oddsData.team2) {
              odds = {
                team1: oddsData.team1,
                team2: oddsData.team2,
                draw: oddsData.draw || null
              };
            }
          }
          
          if (odds && (odds.team1 || odds.team2) && cs2BettingState.events[eventId]) {
            cs2BettingState.events[eventId].odds = odds;
            cs2BettingState.events[eventId].hasOdds = true;
            if (oddsData.sources) {
              cs2BettingState.events[eventId].oddsSources = oddsData.sources;
              console.log(`[CS2 Sync] ✓ Successfully updated odds for event ${eventId} from sources: ${oddsData.sources.join(", ")}`);
            } else {
              console.log(`[CS2 Sync] ✓ Successfully updated odds for event ${eventId}:`, odds);
            }
          } else {
            console.log(`[CS2 Sync] ✗ No odds available for event ${eventId}`);
            if (cs2BettingState.events[eventId]) {
              cs2BettingState.events[eventId].hasOdds = false;
            }
          }
        } catch (error) {
          console.error(`[CS2 Sync] Error fetching odds for event ${eventId}:`, error.message);
          if (cs2BettingState.events[eventId]) {
            cs2BettingState.events[eventId].hasOdds = false;
          }
        }
      }
    }
    
    cs2BettingState.lastApiSync = new Date().toISOString();
    await saveCS2BettingData();
    
    console.log(`CS2 sync complete: ${newCount} new, ${updatedCount} updated`);
    return { newCount, updatedCount, total: matches.length };
  } catch (error) {
    console.error("Error syncing CS2 events:", error);
    return null;
  }
}

// Settle CS2 bets based on match results
async function settleCS2Bets() {
  if (!cs2ApiClient) {
    console.warn("CS2 API client not available, skipping settlement");
    return;
  }
  
  try {
    console.log("Settling CS2 bets...");
    
    // Get all pending bets
    const pendingBets = Object.values(cs2BettingState.bets).filter(bet => bet.status === 'pending');
    
    if (pendingBets.length === 0) {
      console.log("No pending bets to settle");
      return { settled: 0, won: 0, lost: 0 };
    }
    
    let settledCount = 0;
    let wonCount = 0;
    let lostCount = 0;
    
    // Group bets by eventId to minimize API calls
    const betsByEvent = {};
    for (const bet of pendingBets) {
      if (!betsByEvent[bet.eventId]) {
        betsByEvent[bet.eventId] = [];
      }
      betsByEvent[bet.eventId].push(bet);
    }
    
    // Check each event for results
    for (const eventId of Object.keys(betsByEvent)) {
      const event = cs2BettingState.events[eventId];
      
      if (!event) {
        console.warn(`Event ${eventId} not found in state, skipping bets`);
        continue;
      }
      
      // If event is not finished, check API for results
      if (event.status !== 'finished') {
        try {
          const result = await resultClient.fetchMatchResults(eventId);
          if (result && result.completed) {
            // Update event status
            event.status = 'finished';
            event.statusId = result.statusId;
            event.completed = true;
            event.result = {
              winner: result.winner,
              participant1Score: result.participant1Score || result.homeScore,
              participant2Score: result.participant2Score || result.awayScore,
              homeScore: result.homeScore || result.participant1Score,
              awayScore: result.awayScore || result.participant2Score
            };
            cs2BettingState.events[eventId] = event;
          } else {
            // Event not finished yet, skip
            continue;
          }
        } catch (error) {
          console.error(`Error fetching results for event ${eventId}:`, error.message);
          // Continue with next event
          continue;
        }
      }
      
      // Settle bets for this event
      const eventBets = betsByEvent[eventId];
      for (const bet of eventBets) {
        if (bet.status !== 'pending') {
          continue;
        }
        
        const winner = event.result?.winner;
        
        if (!winner) {
          // No result available, check if event was cancelled
          if (event.status === 'cancelled') {
            // Void bet - return stake
            bet.status = 'void';
            bet.result = 'void';
            
            // Return credits to user
            const user = users[bet.userId];
            if (user) {
              user.credits += bet.amount;
              await saveUserBalance(bet.userId, user.credits);
            }
          }
          // Otherwise, keep as pending (event might be in progress)
          continue;
        }
        
        // Determine if bet won
        const betWon = (bet.selection === 'team1' && winner === 'team1') ||
                       (bet.selection === 'team2' && winner === 'team2') ||
                       (bet.selection === 'draw' && winner === 'draw');
        
        if (betWon) {
          // Bet won - pay out
          bet.status = 'won';
          bet.result = 'win';
          const payout = bet.potentialPayout;
          
          const user = users[bet.userId];
          if (user) {
            user.credits += payout;
            await saveUserBalance(bet.userId, user.credits);
          }
          
          wonCount++;
        } else {
          // Bet lost
          bet.status = 'lost';
          bet.result = 'loss';
          lostCount++;
        }
        
        bet.settledAt = new Date().toISOString();
        cs2BettingState.bets[bet.id] = bet;
        settledCount++;
      }
    }
    
    if (settledCount > 0) {
      await saveCS2BettingData();
      console.log(`Settled ${settledCount} bets: ${wonCount} won, ${lostCount} lost`);
    }
    
    return { settled: settledCount, won: wonCount, lost: lostCount };
  } catch (error) {
    console.error("Error settling CS2 bets:", error);
    return null;
  }
}

// Aggregate odds for all active CS2 events from HLTV and gambling scrapers
async function aggregateCS2Odds() {
  if (!cs2OddsProvider) {
    console.warn("[CS2 Odds] Odds provider not available, skipping aggregation");
    return null;
  }
  
  try {
    console.log("[CS2 Odds] Starting odds aggregation for active events...");
    
    // Get all active events (scheduled or live) that need odds
    const activeEvents = Object.values(cs2BettingState.events).filter(event => {
      const needsOdds = (!event.odds || !event.odds.team1 || !event.odds.team2);
      const isActive = event.status === 'scheduled' || event.status === 'live';
      const hasTeams = (event.homeTeam || event.participant1Name) && (event.awayTeam || event.participant2Name);
      return needsOdds && isActive && hasTeams;
    });
    
    if (activeEvents.length === 0) {
      console.log("[CS2 Odds] No active events need odds aggregation");
      return { processed: 0, updated: 0, failed: 0 };
    }
    
    console.log(`[CS2 Odds] Processing ${activeEvents.length} events for odds aggregation...`);
    
    let updatedCount = 0;
    let failedCount = 0;
    
    // Process events sequentially with delays to respect rate limits
    for (let i = 0; i < activeEvents.length; i++) {
      const event = activeEvents[i];
      const eventId = event.fixtureId || event.id;
      
      try {
        // Respect rate limits - delay between requests (3-4 seconds for scraping)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 3500));
        }
        
        console.log(`[CS2 Odds] Aggregating odds for event ${eventId} (${i + 1}/${activeEvents.length}): ${event.homeTeam || event.participant1Name} vs ${event.awayTeam || event.participant2Name}`);
        
        // Prepare match info for scrapers
        const matchInfo = {
          fixtureId: eventId,
          team1: event.homeTeam || event.participant1Name,
          team2: event.awayTeam || event.participant2Name,
          homeTeam: event.homeTeam || event.participant1Name,
          awayTeam: event.awayTeam || event.participant2Name
        };
        
        // Fetch aggregated odds from primary sources (HLTV + gambling scrapers)
        const oddsData = await cs2OddsProvider.fetchMatchOdds(eventId, matchInfo);
        
        if (oddsData && (oddsData.team1 || oddsData.team2)) {
          // Update event with aggregated odds
          event.odds = {
            team1: oddsData.team1,
            team2: oddsData.team2,
            draw: oddsData.draw || null
          };
          event.hasOdds = true;
          if (oddsData.sources) {
            event.oddsSources = oddsData.sources;
          }
          if (oddsData.confidence) {
            event.oddsConfidence = oddsData.confidence;
          }
          
          cs2BettingState.events[eventId] = event;
          updatedCount++;
          
          console.log(`[CS2 Odds] ✓ Updated odds for event ${eventId} from sources: ${oddsData.sources ? oddsData.sources.join(", ") : "unknown"}`);
          console.log(`[CS2 Odds]   Odds: team1=${oddsData.team1}, team2=${oddsData.team2}`);
        } else {
          console.log(`[CS2 Odds] ⚠ No odds available for event ${eventId}`);
          failedCount++;
        }
      } catch (error) {
        console.error(`[CS2 Odds] Error aggregating odds for event ${eventId}:`, error.message);
        failedCount++;
        // Continue with next event
      }
    }
    
    // Save updated events
    if (updatedCount > 0) {
      await saveCS2BettingData();
    }
    
    console.log(`[CS2 Odds] Aggregation complete: ${updatedCount} updated, ${failedCount} failed out of ${activeEvents.length} events`);
    return { processed: activeEvents.length, updated: updatedCount, failed: failedCount };
    
  } catch (error) {
    console.error("[CS2 Odds] Error during odds aggregation:", error);
    return null;
  }
}

// GET /api/cs2/admin/sports - List available sports (for debugging)
app.get("/api/cs2/admin/sports", async (req, res) => {
  try {
    // Use cs2ApiClient directly for admin endpoints (not available in provider)
    if (!cs2ApiClient) {
      return res.status(503).json({
        success: false,
        error: "CS2 API client not available" 
      });
    }

    const relatedSports = await cs2ApiClient.listRelatedSports();
    
    res.json({
      success: true,
      sports: relatedSports,
      count: relatedSports.length,
      currentSportId: cs2ApiClient.findCS2SportId ? await cs2ApiClient.findCS2SportId() : null,
      oddsProviderEnabled: !!cs2OddsProvider,
      availableOddsSources: cs2OddsProvider ? cs2OddsProvider.getAvailableSources() : []
    });
  } catch (error) {
    console.error("Error listing sports:", error);
    res.status(500).json({ success: false, error: "Failed to list sports" });
  }
});

// POST /api/cs2/admin/sync - Force refresh of events/odds from API
app.post("/api/cs2/admin/sync", async (req, res) => {
  try {
    const result = await syncCS2Events();
    
    // Also trigger odds aggregation after syncing events
    const oddsResult = await aggregateCS2Odds();
    
    if (result) {
      res.json({
        success: true,
        message: `Synced ${result.total} matches and aggregated odds`,
        ...result,
        oddsResult: oddsResult,
        lastSync: cs2BettingState.lastApiSync
      });
    } else {
      res.status(503).json({ 
        success: false, 
        error: "Failed to sync or API client not available",
        oddsResult: oddsResult
      });
    }
  } catch (error) {
    console.error("Error in sync endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to sync data" });
  }
});

// POST /api/cs2/admin/aggregate - Manually trigger odds aggregation
app.post("/api/cs2/admin/aggregate", async (req, res) => {
  try {
    const result = await aggregateCS2Odds();
    
    if (result !== null) {
      res.json({
        success: true,
        message: "CS2 odds aggregation completed",
        result: result
      });
    } else {
      res.status(503).json({ 
        success: false, 
        error: "Failed to aggregate odds or odds provider not available" 
      });
    }
  } catch (error) {
    console.error("Error in aggregate endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to aggregate odds" });
  }
});

// POST /api/cs2/admin/settle - Manually trigger bet settlement
app.post("/api/cs2/admin/settle", async (req, res) => {
  try {
    const result = await settleCS2Bets();
    if (result) {
      res.json({
        success: true,
        message: `Settled ${result.settled} bets`,
        ...result
      });
    } else {
      res.status(503).json({ 
        success: false, 
        error: "Failed to settle bets or API client not available" 
      });
    }
  } catch (error) {
    console.error("Error in settle endpoint:", error);
    res.status(500).json({ success: false, error: "Failed to settle bets" });
  }
});

// ========== END CS2 BETTING REST API ENDPOINTS ==========

// ========== CS2 BETTING SCHEDULED TASKS ==========

// Configuration for scheduled tasks
const CS2_SYNC_INTERVAL_MS = parseInt(process.env.CS2_SYNC_INTERVAL_MS || "1800000", 10); // 30 minutes default
const CS2_SETTLEMENT_INTERVAL_MS = parseInt(process.env.CS2_SETTLEMENT_INTERVAL_MS || "300000", 10); // 5 minutes default
const CS2_ODDS_AGGREGATION_INTERVAL_MS = parseInt(process.env.CS2_ODDS_AGGREGATION_INTERVAL_MS || "600000", 10); // 10 minutes default for odds aggregation

let cs2SyncInterval = null;
let cs2SettlementInterval = null;
let cs2OddsAggregationInterval = null;

// Start scheduled tasks for CS2 betting
function startCS2ScheduledTasks() {
  if (!cs2ApiClient) {
    console.log("CS2 API client not available, skipping scheduled tasks");
    return;
  }
  
  // Use node-cron if available, otherwise use setInterval
  if (cron) {
    // Sync events every 30 minutes (using cron syntax)
    // "*/30 * * * *" means every 30 minutes
    cs2SyncInterval = cron.schedule("*/30 * * * *", async () => {
      await syncCS2Events();
    }, {
      scheduled: true,
      timezone: "UTC"
    });
    
    // Check for settlement every 5 minutes
    cs2SettlementInterval = cron.schedule("*/5 * * * *", async () => {
      await settleCS2Bets();
    }, {
      scheduled: true,
      timezone: "UTC"
    });
    
    // Schedule odds aggregation every 10 minutes
    cs2OddsAggregationInterval = cron.schedule("*/10 * * * *", async () => {
      await aggregateCS2Odds();
    }, {
      scheduled: true,
      timezone: "UTC"
    });
    
    console.log("CS2 scheduled tasks started using node-cron:");
    console.log(`  - Event sync: every 30 minutes`);
    console.log(`  - Settlement check: every 5 minutes`);
    console.log(`  - Odds aggregation: every 10 minutes`);
  } else {
    // Fallback to setInterval
    cs2SyncInterval = setInterval(async () => {
      await syncCS2Events();
    }, CS2_SYNC_INTERVAL_MS);
    
    cs2SettlementInterval = setInterval(async () => {
      await settleCS2Bets();
    }, CS2_SETTLEMENT_INTERVAL_MS);
    
    // Schedule odds aggregation
    cs2OddsAggregationInterval = setInterval(async () => {
      await aggregateCS2Odds();
    }, CS2_ODDS_AGGREGATION_INTERVAL_MS);
    
    console.log("CS2 scheduled tasks started using setInterval:");
    console.log(`  - Event sync: every ${CS2_SYNC_INTERVAL_MS / 1000 / 60} minutes`);
    console.log(`  - Settlement check: every ${CS2_SETTLEMENT_INTERVAL_MS / 1000 / 60} minutes`);
    console.log(`  - Odds aggregation: every ${CS2_ODDS_AGGREGATION_INTERVAL_MS / 1000 / 60} minutes`);
  }
  
  // Initial sync after server starts (wait 10 seconds to let server fully initialize)
  setTimeout(async () => {
    console.log("Performing initial CS2 event sync...");
    await syncCS2Events();
    
    // Also perform initial odds aggregation for events that need it
    console.log("Performing initial CS2 odds aggregation...");
    await aggregateCS2Odds();
  }, 10000);
}

// Stop scheduled tasks (for graceful shutdown)
function stopCS2ScheduledTasks() {
  if (cs2SyncInterval) {
    if (cron && cs2SyncInterval.stop) {
      cs2SyncInterval.stop();
    } else if (typeof cs2SyncInterval === 'number') {
      clearInterval(cs2SyncInterval);
    }
    cs2SyncInterval = null;
  }
  
  if (cs2SettlementInterval) {
    if (cron && cs2SettlementInterval.stop) {
      cs2SettlementInterval.stop();
    } else if (typeof cs2SettlementInterval === 'number') {
      clearInterval(cs2SettlementInterval);
    }
    cs2SettlementInterval = null;
  }
  
  if (cs2OddsAggregationInterval) {
    if (cron && cs2OddsAggregationInterval.stop) {
      cs2OddsAggregationInterval.stop();
    } else if (typeof cs2OddsAggregationInterval === 'number') {
      clearInterval(cs2OddsAggregationInterval);
    }
    cs2OddsAggregationInterval = null;
  }
  
  console.log("CS2 scheduled tasks stopped");
}

// Start CS2 scheduled tasks if API client is available
if (cs2ApiClient) {
  startCS2ScheduledTasks();
}

// ========== END CS2 BETTING SCHEDULED TASKS ==========

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Casino Server running on http://localhost:${PORT}`);
  console.log(`  - Roulette game available`);
  console.log(`  - Coinflip game available`);
  if (cs2ApiClient) {
    console.log(`  - CS2 Betting available (REST API: /api/cs2/*)`);
  }
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  stopCS2ScheduledTasks();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  stopCS2ScheduledTasks();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

