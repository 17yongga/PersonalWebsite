const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));

// Initial credits for new players
const INITIAL_CREDITS = 1000;

// Player data: { socketId: { name, credits, roomId } }
const players = {};

// Room data: { roomId: { creatorId, betAmount, creatorChoice, players: [socketId1, socketId2], confirmed: false, gameState: 'waiting'|'confirmed'|'flipping'|'finished', coinResult: null } }
const rooms = {};
let roomCounter = 1;

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on("joinGame", (playerName, initialCredits) => {
    if (!playerName || playerName.trim() === "") {
      socket.emit("error", "Please enter a valid name");
      return;
    }

    // Check if player already exists (by name) and preserve their credits
    const existingPlayer = Object.values(players).find(p => p.name === playerName.trim());
    let playerCredits = INITIAL_CREDITS;
    
    if (existingPlayer) {
      // Player already exists - keep their credits
      playerCredits = existingPlayer.credits;
    } else if (initialCredits !== undefined && initialCredits !== null) {
      // Use provided initial credits (from casino)
      playerCredits = parseInt(initialCredits) || INITIAL_CREDITS;
    }

    // Initialize or update player data
    players[socket.id] = {
      name: playerName.trim(),
      credits: playerCredits,
      roomId: null
    };

    socket.emit("playerData", {
      name: players[socket.id].name,
      credits: players[socket.id].credits
    });

    // Send available rooms
    emitAvailableRooms(socket);
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

    const roomId = `room-${String(roomCounter).padStart(3, '0')}`;
    roomCounter++;
    
    socket.join(roomId);
    players[socket.id].roomId = roomId;
    
    rooms[roomId] = {
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

    emitAvailableRooms();
  });

  socket.on("joinRoom", ({ roomId }) => {
    if (!players[socket.id]) {
      socket.emit("error", "Please join the game first");
      return;
    }

    const room = rooms[roomId];
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
        name: players[room.players[0]].name
      },
      player2: {
        name: players[room.players[1]].name
      },
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice
    });

    // Notify the joiner (Emily) about the room details
    socket.emit("joinedRoom", {
      roomId,
      betAmount: room.betAmount,
      creatorChoice: room.creatorChoice,
      creatorName: players[room.creatorId].name
    });

    // Notify the creator (Gary) that someone joined
    io.to(room.creatorId).emit("opponentJoined", {
      opponentName: players[socket.id].name
    });

    emitAvailableRooms();
  });

  socket.on("confirmParticipation", ({ roomId }) => {
    const room = rooms[roomId];
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
      const room = rooms[roomId];
      
      if (room) {
        const isCreator = socket.id === room.creatorId;
        socket.leave(roomId);
        room.players = room.players.filter(id => id !== socket.id);
        
        if (isCreator) {
          // Creator is leaving - refund their bet and delete room
          if (!room.confirmed) {
            players[socket.id].credits += room.betAmount;
          }
          delete rooms[roomId];
        } else {
          // Joiner is leaving
          if (room.gameState === 'finished') {
            // Game already finished - don't reset, just notify and let creator leave too
            // The room will be deleted when creator leaves or when empty
          } else {
            // Game hasn't finished - reset room state back to waiting
            room.gameState = 'waiting';
            room.confirmed = false;
          }
          
          // Notify creator that opponent left
          io.to(room.creatorId).emit("opponentLeft");
          
          // Update creator's credits display (without sharing credits)
          socket.emit("playerData", {
            name: players[socket.id].name,
            credits: players[socket.id].credits
          });
        }

        if (room.players.length === 0) {
          delete rooms[roomId];
        }

        players[socket.id].roomId = null;
        emitAvailableRooms();
      }
    }

    socket.emit("leftRoom");
    emitAvailableRooms(socket);
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    if (players[socket.id] && players[socket.id].roomId) {
      const roomId = players[socket.id].roomId;
      const room = rooms[roomId];
      
      if (room) {
        socket.leave(roomId);
        room.players = room.players.filter(id => id !== socket.id);
        
        // Refund creator's bet if they disconnect before confirmation
        if (socket.id === room.creatorId && !room.confirmed) {
          players[socket.id].credits += room.betAmount;
        }

        const isCreator = socket.id === room.creatorId;
        
        if (room.players.length === 0) {
          delete rooms[roomId];
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
          delete rooms[roomId];
        }
      }
    }

    delete players[socket.id];
    emitAvailableRooms();
  });
});

function emitAvailableRooms(targetSocket = null) {
  const availableRooms = Object.keys(rooms)
    .filter(roomId => {
      const room = rooms[roomId];
      // Only show rooms that are waiting, not full, not confirmed, and not finished
      return room.players.length < 2 && 
             !room.confirmed && 
             room.gameState !== 'finished' &&
             room.gameState === 'waiting';
    })
    .map(roomId => ({
      roomId,
      playerCount: rooms[roomId].players.length,
      creatorName: players[rooms[roomId].creatorId]?.name || 'Unknown',
      betAmount: rooms[roomId].betAmount,
      creatorChoice: rooms[roomId].creatorChoice
      // Note: Not sharing creator credits
    }));

  if (targetSocket) {
    targetSocket.emit("availableRooms", availableRooms);
  } else {
    io.emit("availableRooms", availableRooms);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Coin Flip Game Server running on http://localhost:${PORT}`);
});
