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
  socket.emit("availableRooms", Object.keys(rooms));

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
      io.to(room).emit("message", "Game started! Players are connected."); // Notify players that the game has started
      io.to(room).emit("startGame", { roomId: room, players: rooms[room].players }); // Start the game for both players
    } else {
      socket.emit("message", "Room not found."); // Notify the player if the room was not found
    }
  });

  socket.on("playerChoice", ({ roomId, choice }) => {
    const room = rooms[roomId];
    if (!room) return; // Ignore if room does not exist

    // Record player's choice
    room.playerChoices[socket.id] = choice;

    // Notify the opponent of the player's choice
    const opponentId = Object.keys(room.scores).find((id) => id !== socket.id);
    if (opponentId) {
      io.to(opponentId).emit("opponentChoice", choice);
    }

    // Check if both players have made their choices
    if (Object.keys(room.playerChoices).length === 2) {
      // Perform coin flip
      const coinResult = Math.random() > 0.5 ? "Heads" : "Tails";

      // Determine scores
      for (const playerId in room.playerChoices) {
        if (room.playerChoices[playerId] === coinResult) {
          room.scores[playerId]++;
        }
      }

      // Notify players of the result
      io.to(roomId).emit("coinFlipResult", {
        coinResult,
        scores: room.scores,
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
    } else {
      room.playAgain = true;
    }
  });

  socket.on("leaveGame", (roomId) => {
    socket.leave(roomId); // Leave the room
    io.to(roomId).emit("message", "A player has left the game."); // Notify the opponent that the player has left
    delete rooms[roomId]; // Remove room state
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`); // Log player disconnection

    // Handle disconnect during waiting
    if (waitingPlayer === socket.id) {
      waitingPlayer = null;
    }

    // Handle active game disconnection
    for (const roomId in rooms) {
      if (rooms[roomId].scores[socket.id] !== undefined) {
        io.to(roomId).emit("message", "Your opponent disconnected. Game over."); // Notify the opponent that the player has disconnected
        delete rooms[roomId]; // Remove room state
      }
    }
  });
});

const PORT = process.env.PORT || 3000; // Set the port for the server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`); // Log server start
});
