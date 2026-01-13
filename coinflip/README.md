# Coin Flip Game - Multiplayer Betting

A modern, fully-featured multiplayer coin flip game with an integrated betting system using in-game credits.

## Features

- 🎮 **Multiplayer Support**: Join or create rooms to play with other players online
- 💰 **Betting System**: Bet credits on coin flip outcomes with a real-time credit management system
- 🎨 **Modern UI**: Beautiful, intuitive interface with smooth animations
- 🪙 **Coin Flip Animation**: Realistic 3D coin flip animation
- 📊 **Real-time Updates**: Live updates for bets, results, and player actions using WebSockets

## How to Play

1. Start the server (see Setup below)
2. Enter your name when prompted
3. You'll start with **1,000 credits**
4. Create a room or join an existing one
5. Place your bet and choose Heads or Tails
6. Wait for your opponent to place their bet
7. Watch the coin flip animation
8. Winner takes both bets!

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Game Rules

- Each player starts with 1,000 credits
- Players must place a bet before the coin flip
- Both players must place their bets before the coin flips
- The winner takes both players' bets
- Credits are deducted when you place a bet
- Winnings are added automatically after each round

## Technologies Used

- Node.js
- Express.js
- Socket.io (WebSockets for real-time communication)
- HTML5
- CSS3 (with animations)
- Vanilla JavaScript



