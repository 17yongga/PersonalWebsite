const deck = [];
const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
const values = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King", "Ace"];

let playerHand = [];
let dealerHand = [];
let playerWins = 0;
let dealerWins = 0;
let gameOver = false;
let playerstood = false;

function createDeck() {
    deck.length = 0; // Clear the deck to avoid duplicates
    suits.forEach(suit => {
        values.forEach(value => {
            deck.push({ suit, value });
        });
    });
}

function shuffleDeck() {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
}

function dealCard(hand) {
    hand.push(deck.pop());
}

function calculateScore(hand) {
    let score = 0;
    let aces = 0;
    hand.forEach(card => {
        if (card.value === "Ace") {
            aces++;
            score += 11;
        } else if (["King", "Queen", "Jack"].includes(card.value)) {
            score += 10;
        } else {
            score += parseInt(card.value);
        }
    });

    while (score > 21 && aces > 0) {
        score -= 10;
        aces--;
    }

    return score;
}

function updateUI() {
    const playerCardsDiv = document.getElementById("player-cards");
    const dealerCardsDiv = document.getElementById("dealer-cards");
    playerCardsDiv.innerHTML = "";
    dealerCardsDiv.innerHTML = "";

    playerHand.forEach(card => {
        const cardImg = document.createElement("div");
        cardImg.classList.add("card");
        cardImg.style.backgroundImage = `url('images/${card.value}_of_${card.suit}.png')`;
        playerCardsDiv.appendChild(cardImg);
    });

    dealerHand.forEach(card => {
        const cardImg = document.createElement("div");
        cardImg.classList.add("card");
        cardImg.style.backgroundImage = `url('images/${card.value}_of_${card.suit}.png')`;
        dealerCardsDiv.appendChild(cardImg);
    });

    const playerScore = calculateScore(playerHand);
    const dealerScore = calculateScore(dealerHand);
    
    let resultText = "";
    if (playerScore > 21) {
        resultText = "Player Busts! Dealer Wins!";
        dealerWins++;
        gameOver = true;
    } else if (dealerScore > 21) {
        resultText = "Dealer Busts! Player Wins!";
        playerWins++;
        gameOver = true;
    } else if (playerScore === 21) {
        resultText = "Player Hits Blackjack! Player Wins!";
        playerWins++;
        gameOver = true;
    } else if (playerstood) {
        if (playerScore > dealerScore) {
            resultText = "Player Wins!";
            playerWins++;
            gameOver = true;
        } else if (dealerScore > playerScore) {
            resultText = "Dealer Wins!";
            dealerWins++;
            gameOver = true;
        } else {
            resultText = "It's a Tie!";
            gameOver = true;
        }
    }

    document.getElementById("result").innerText = resultText;
    document.getElementById("player-score").innerText = `Player Wins: ${playerWins}`;
    document.getElementById("dealer-score").innerText = `Dealer Wins: ${dealerWins}`;
    document.getElementById("player-value").innerText = `Player Has: ${playerScore}`;
    document.getElementById("dealer-value").innerText = `Dealer Has: ${dealerScore}`;
}

function resetGame() {
    playerHand = [];
    dealerHand = [];
    gameOver = false;
    playerstood = false;
    createDeck();
    shuffleDeck();
    dealCard(playerHand);
    dealCard(dealerHand);
    updateUI();
    document.getElementById("result").innerText = "Game reset! Hit or Stand?";
}

document.getElementById("hit").addEventListener("click", () => {
    if (!gameOver) {
        dealCard(playerHand);
        updateUI();
    }
});

document.getElementById("stand").addEventListener("click", () => {
    playerstood = true;
    if (!gameOver) {
        let dealerScore = calculateScore(dealerHand);
        while (dealerScore < 17) {
            dealCard(dealerHand);
            dealerScore = calculateScore(dealerHand);
        }
        updateUI();
    }
});

document.getElementById("reset").addEventListener("click", resetGame);

createDeck();
shuffleDeck();
dealCard(playerHand);
dealCard(dealerHand);
document.getElementById("result").innerText = "Press Reset to start a new game!";
updateUI();