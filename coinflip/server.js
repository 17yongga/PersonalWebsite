const express = require("express"); // Import express module
const http = require("http"); // Import http module
const { Server } = require("socket.io"); // Import socket.io module

const app = express(); // Create an express application
const server = http.createServer(app); // Create an HTTP server
const io = new Server(server); // Create a socket.io server

app.use(express.static("public")); // Serve static files from the 'public' folder

let waitingPlayer = null; // Track the waiting player
const rooms = {}; // Track room state: { roomId: { playerChoices: {}, scores: {}, players: {} } }
let roomCounter = 1; // Room counter to generate room IDs

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`); // Log player connection

  // Send available rooms to the connected player
  socket.emit("availableRooms", Object.keys(rooms).map(roomId => ({
    roomId,
    players: Object.values(rooms[roomId].players),
    availableSpots: 2 - Object.keys(rooms[roomId].players).length
  })));

  socket.on("createRoom", (playerName) => {
    const roomId = `room-${String(roomCounter).padStart(3, '0')}`; // Generate a new room ID
    roomCounter++;
    socket.join(roomId); // Join the new room
    rooms[roomId] = {
      playerChoices: {}, // Track player choices
      scores: { [socket.id]: 0 }, // Track scores for players
      players: { [socket.id]: playerName } // Track player names
    };
    socket.emit("message", `Room created. Room ID: ${roomId}`); // Notify the player that the room was created
    socket.emit("startGame", { roomId, players: rooms[roomId].players }); // Start the game for the player
    io.emit("newRoom", roomId); // Notify all players about the new room
  });

  socket.on("joinRoom", ({ room, playerName }) => {
    if (rooms[room]) {
      socket.join(room); // Join the existing room
      rooms[room].scores[socket.id] = 0; // Initialize the player's score
      rooms[room].players[socket.id] = playerName; // Add the player's name to the room
      io.to(room).emit("message", "A player has joined the room."); // Notify players that a player has joined
      io.emit("availableRooms", Object.keys(rooms).map(roomId => ({
        roomId,
        players: Object.values(rooms[roomId].players),
        availableSpots: 2 - Object.keys(rooms[roomId].players).length
      }))); // Update available rooms for all clients

      // Notify the new player of the existing player's choice if already made
      const existingPlayerId = Object.keys(rooms[room].players).find(id => id !== socket.id);
      if (existingPlayerId && rooms[room].playerChoices[existingPlayerId]) {
        const existingChoice = rooms[room].playerChoices[existingPlayerId];
        const oppositeChoice = existingChoice === 'Heads' ? 'Tails' : 'Heads';
        socket.emit("opponentChoice", existingChoice);
        socket.emit("message", `Your opponent chose ${existingChoice}. You must choose ${oppositeChoice}.`);
      }

      // Start the game if the room is full
      if (Object.keys(rooms[room].players).length === 2) {
        io.to(room).emit("message", "Game started! Players are connected."); // Notify players that the game has started
        io.to(room).emit("startGame", { roomId: room, players: rooms[room].players }); // Start the game for both players
        const firstPlayerId = Object.keys(rooms[room].players)[0];
        io.to(firstPlayerId).emit("message", "You can choose Heads or Tails first.");
      }
    } else {
      socket.emit("message", "Room not found."); // Notify the player if the room was not found
    }
  });

  socket.on("playerChoice", ({ roomId, choice }) => {
    const room = rooms[roomId];
    if (!room) return; // Ignore if room does not exist

    // Ensure both players have joined before making a choice
    if (Object.keys(room.players).length < 2) {
      socket.emit("message", "Waiting for an opponent to join before making a choice.");
      return;
    }

    // Record player's choice
    room.playerChoices[socket.id] = choice;
    console.log(`Player ${socket.id} chose: ${choice}`); // Log the player's choice

    // Ensure the first player has made a choice before the second player
    const playerIds = Object.keys(room.players);
    const firstPlayerId = playerIds[0];
    const secondPlayerId = playerIds[1];
    console.log(`First player choice: ${room.playerChoices[firstPlayerId]}`); // Log the first player's choice

    if (socket.id === secondPlayerId && !room.playerChoices[firstPlayerId]) {
      socket.emit("message", "Waiting for the first player to make a choice.");
      console.log(`request getting bounced`); // Log the first player's choice
      return;
    }

    // Notify the player that their choice has been recorded
    socket.emit("message", `You chose ${choice}. Waiting for opponent...`);

    // Notify the opponent of the player's choice
    const opponentId = Object.keys(room.scores).find((id) => id !== socket.id);
    if (opponentId) {
      io.to(opponentId).emit("opponentChoice", { choice, playerId: socket.id });
    }

    // Check if both players have made their choices
    if (Object.keys(room.playerChoices).length === 2) {
      // Perform coin flip
      const coinResult = Math.random() > 0.5 ? "Heads" : "Tails";

      // Determine scores and messages
      const messages = {};
      for (const playerId in room.playerChoices) {
        if (room.playerChoices[playerId] === coinResult) {
          room.scores[playerId]++;
          messages[playerId] = "You win!";
        } else {
          messages[playerId] = "You lose!";
        }
      }

      // Notify players of the result
      io.to(roomId).emit("coinFlipResult", {
        coinResult,
        scores: room.scores,
        messages,
      });

      // Reset player choices for the next round
      room.playerChoices = {};
    }
  });

  socket.on("playAgain", (roomId) => {
    const room = rooms[roomId];
    if (!room) return; // Ignore if room does not exist

    // Notify the opponent that the player wants to play again
    const opponentId = Object.keys(room.scores).find((id) => id !== socket.id);
    if (opponentId) {
      io.to(opponentId).emit("message", "Your opponent wants to play again. Waiting for your response...");
    }

    // Start a new round if both players want to play again
    if (room.playAgain) {
      io.to(roomId).emit("message", "Starting a new round!");
      io.to(roomId).emit("newRound");
      room.playAgain = false;
      room.playerChoices = {}; // Clear player choices for the new round
    } else {
      room.playAgain = true;
    }
  });

  socket.on("leaveGame", (roomId) => {
    socket.leave(roomId); // Leave the room
    io.to(roomId).emit("message", "A player has left the game."); // Notify the opponent that the player has left

    // Check if the room is empty and delete it
    const room = rooms[roomId];
    if (room) {
      delete room.scores[socket.id];
      delete room.players[socket.id];
      if (Object.keys(room.players).length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit("opponentLeft"); // Emit opponentLeft event to the remaining player
        io.to(roomId).emit("message", "Your opponent has left. Waiting for a new player to join."); // Notify the remaining player
        // Reset scores for the remaining player
        for (const playerId in room.scores) {
          room.scores[playerId] = 0;
        }
      }
      io.emit("availableRooms", Object.keys(rooms).map(roomId => ({
        roomId,
        players: Object.values(rooms[roomId].players),
        availableSpots: 2 - Object.keys(rooms[roomId].players).length
      }))); // Update available rooms for all clients
    }
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`); // Log player disconnection

    // Handle disconnect during waiting
    if (waitingPlayer === socket.id) {
      waitingPlayer = null;
    }

    // Handle active game disconnection
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.scores[socket.id] !== undefined) {
        io.to(roomId).emit("message", "Your opponent disconnected. Game over."); // Notify the opponent that the player has disconnected
        delete room.scores[socket.id];
        delete room.players[socket.id];
        if (Object.keys(room.players).length === 0) {
          delete rooms[roomId];
        } else {
          io.to(roomId).emit("opponentLeft"); // Emit opponentLeft event to the remaining player
          io.to(roomId).emit("message", "Your opponent has left. Waiting for a new player to join."); // Notify the remaining player
          // Reset scores for the remaining player
          for (const playerId in room.scores) {
            room.scores[playerId] = 0;
          }
        }
        io.emit("availableRooms", Object.keys(rooms).map(roomId => ({
          roomId,
          players: Object.values(rooms[roomId].players),
          availableSpots: 2 - Object.keys(rooms[roomId].players).length
        }))); // Update available rooms for all clients
      }
    }
  });
});

const PORT = process.env.PORT || 3000; // Set the port for the server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`); // Log server start
});
