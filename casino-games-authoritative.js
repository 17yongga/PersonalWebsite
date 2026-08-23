'use strict';

const crypto = require('crypto');

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const TEN_VALUE_CARDS = new Set(['10', 'jack', 'queen', 'king']);
const PACHINKO_MULTIPLIERS = Object.freeze({
  low: Object.freeze([5, 2.5, 1.6, 1.3, 1.15, 1.05, 0.95, 0.9, 0.85, 0.9, 0.95, 1.05, 1.15, 1.3, 1.6, 2.5, 5]),
  medium: Object.freeze([50, 18, 6, 3, 1.8, 1.2, 0.9, 0.75, 0.6, 0.75, 0.9, 1.2, 1.8, 3, 6, 18, 50]),
  high: Object.freeze([220, 55, 18, 7, 2.6, 1.25, 0.78, 0.48, 0.28, 0.48, 0.78, 1.25, 2.6, 7, 18, 55, 220])
});

function evaluateBlackjackHand(hand) {
  let score = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.value === 'ace') {
      score += 11;
      aces += 1;
    } else if (['jack', 'queen', 'king'].includes(card.value)) {
      score += 10;
    } else {
      score += Number(card.value);
    }
  }
  while (score > 21 && aces > 0) {
    score -= 10;
    aces -= 1;
  }
  return { score, isSoft: aces > 0 };
}

function scoreHand(hand) {
  return evaluateBlackjackHand(hand).score;
}

function createShuffledDeck(randomInt = crypto.randomInt) {
  const deck = SUITS.flatMap(suit => VALUES.map(value => ({ suit, value })));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
}

function cardPublic(card) {
  return card ? { suit: card.suit, value: card.value } : null;
}

class BlackjackService {
  constructor({ randomInt = crypto.randomInt, deckFactory = createShuffledDeck } = {}) {
    this.randomInt = randomInt;
    this.deckFactory = deckFactory;
    this.rounds = new Map();
  }

  #createHand(cards, bet) {
    return { cards, bet, doubled: false, complete: false, result: null, payout: 0 };
  }

  #activeHand(round) {
    return round.playerHands[round.activeHandIndex] || null;
  }

  #totalBet(round) {
    return round.playerHands.reduce((total, hand) => total + hand.bet, 0);
  }

  #canSplit(round) {
    const hand = this.#activeHand(round);
    return round.phase === 'player' && !round.hasSplit && round.playerHands.length === 1 &&
      hand?.cards.length === 2 && hand.cards[0].value === hand.cards[1].value;
  }

  #advanceOrSettle(round) {
    const nextIndex = round.playerHands.findIndex((hand, index) => index > round.activeHandIndex && !hand.complete);
    if (nextIndex >= 0) {
      round.activeHandIndex = nextIndex;
      return round;
    }
    return this.#settle(round);
  }

  start(username, bet, { randomInt = this.randomInt, roundId = crypto.randomUUID() } = {}) {
    if (!Number.isSafeInteger(bet) || bet < 1) throw new RangeError('Invalid bet');
    const existing = this.rounds.get(username);
    if (existing && !existing.settled) throw new Error('A blackjack round is already active');
    const deck = this.deckFactory(randomInt);
    const playerCards = [deck.pop(), deck.pop()];
    const round = {
      id: roundId,
      username,
      baseBet: bet,
      insuranceBet: 0,
      deck,
      playerHands: [this.#createHand(playerCards, bet)],
      activeHandIndex: 0,
      hasSplit: false,
      splitAces: false,
      dealer: [deck.pop(), deck.pop()],
      phase: 'player',
      settled: false,
      payout: 0,
      result: null,
      revision: 0,
      actionRequests: new Map()
    };
    if (round.dealer[1].value === 'ace') round.phase = 'insurance';
    else if (TEN_VALUE_CARDS.has(round.dealer[1].value) && scoreHand(round.dealer) === 21) this.#settle(round);
    else if (scoreHand(playerCards) === 21) this.#settle(round);
    this.rounds.set(username, round);
    return this.publicState(round);
  }

  action(username, roundId, action) {
    const round = this.rounds.get(username);
    if (!round || round.id !== roundId) throw new Error('Blackjack round not found');
    if (round.settled) return this.publicState(round);
    if (round.phase === 'insurance') {
      if (!['insurance', 'declineInsurance'].includes(action)) throw new Error('Insurance decision required');
      if (action === 'insurance') round.insuranceBet = round.baseBet / 2;
      const dealerBlackjack = scoreHand(round.dealer) === 21;
      round.revision += 1;
      if (dealerBlackjack) return this.publicState(this.#settle(round));
      round.phase = 'player';
      if (scoreHand(round.playerHands[0].cards) === 21) return this.publicState(this.#settle(round));
      return this.publicState(round);
    }
    if (round.phase !== 'player') throw new Error('Action is not allowed now');

    const hand = this.#activeHand(round);
    if (!hand || hand.complete) throw new Error('Active blackjack hand is unavailable');
    if (action === 'hit') {
      if (round.splitAces) throw new Error('Split aces receive one card each');
      hand.cards.push(round.deck.pop());
      if (scoreHand(hand.cards) >= 21) {
        hand.complete = true;
        this.#advanceOrSettle(round);
      }
    } else if (action === 'stand') {
      hand.complete = true;
      this.#advanceOrSettle(round);
    } else if (action === 'double') {
      if (hand.cards.length !== 2 || hand.doubled || round.splitAces) {
        throw new Error('Double down is only available on an initial playable hand');
      }
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(round.deck.pop());
      hand.complete = true;
      this.#advanceOrSettle(round);
    } else if (action === 'split') {
      if (!this.#canSplit(round)) throw new Error('Split is only available for an equal-rank starting pair');
      const [leftCard, rightCard] = hand.cards;
      round.hasSplit = true;
      round.splitAces = leftCard.value === 'ace';
      round.playerHands = [
        this.#createHand([leftCard, round.deck.pop()], round.baseBet),
        this.#createHand([rightCard, round.deck.pop()], round.baseBet)
      ];
      round.activeHandIndex = 0;
      if (round.splitAces) {
        round.playerHands.forEach(splitHand => { splitHand.complete = true; });
        this.#settle(round);
      }
    } else {
      throw new Error('Unknown blackjack action');
    }
    round.revision += 1;
    return this.publicState(round);
  }

  #settle(round) {
    if (round.settled) return round;
    round.phase = 'dealer';
    round.playerHands.forEach(hand => { hand.complete = true; });
    const unsplitNatural = !round.hasSplit && round.playerHands.length === 1 &&
      round.playerHands[0].cards.length === 2 && scoreHand(round.playerHands[0].cards) === 21;
    const hasLiveHand = round.playerHands.some(hand => scoreHand(hand.cards) <= 21);
    if (hasLiveHand && !unsplitNatural) {
      while (scoreHand(round.dealer) < 17) round.dealer.push(round.deck.pop());
    }
    const dealerScore = scoreHand(round.dealer);
    const dealerNatural = round.dealer.length === 2 && dealerScore === 21;
    let payout = round.insuranceBet && dealerNatural ? round.insuranceBet * 3 : 0;

    round.playerHands.forEach(hand => {
      const playerScore = scoreHand(hand.cards);
      const playerNatural = !round.hasSplit && hand.cards.length === 2 && playerScore === 21;
      let result = 'loss';
      let handPayout = 0;
      if (playerScore > 21) result = 'bust';
      else if (playerNatural && !dealerNatural) { result = 'blackjack'; handPayout = hand.bet * 2.5; }
      else if (dealerNatural && playerNatural) { result = 'push'; handPayout = hand.bet; }
      else if (dealerNatural) result = 'dealer_blackjack';
      else if (dealerScore > 21 || playerScore > dealerScore) { result = 'win'; handPayout = hand.bet * 2; }
      else if (playerScore === dealerScore) { result = 'push'; handPayout = hand.bet; }
      hand.result = result;
      hand.payout = handPayout;
      payout += handPayout;
    });

    const totalBet = this.#totalBet(round);
    const totalStake = totalBet + round.insuranceBet;
    if (round.playerHands.length === 1) round.result = round.playerHands[0].result;
    else if (payout > totalStake) round.result = 'split_win';
    else if (payout === totalStake) round.result = 'split_push';
    else round.result = round.playerHands.some(hand => ['win', 'blackjack'].includes(hand.result)) ? 'split_mixed' : 'split_loss';
    round.settled = true;
    round.phase = 'settled';
    round.payout = payout;
    return round;
  }

  publicState(round) {
    const revealDealer = round.settled;
    const activeHand = this.#activeHand(round) || round.playerHands[0];
    const playerHands = round.playerHands.map((hand, index) => ({
      cards: hand.cards.map(cardPublic),
      ...evaluateBlackjackHand(hand.cards),
      bet: hand.bet,
      doubled: hand.doubled,
      complete: hand.complete,
      result: hand.result,
      payout: hand.payout,
      active: !round.settled && round.phase === 'player' && index === round.activeHandIndex
    }));
    const canAct = !round.settled && round.phase === 'player' && Boolean(activeHand) && !activeHand.complete;
    const activeEvaluation = evaluateBlackjackHand(activeHand.cards);
    const visibleDealerCards = revealDealer ? round.dealer : round.dealer.slice(1);
    const dealerEvaluation = evaluateBlackjackHand(visibleDealerCards);
    return {
      roundId: round.id,
      revision: round.revision,
      baseBet: round.baseBet,
      bet: this.#totalBet(round),
      insuranceBet: round.insuranceBet,
      phase: round.phase,
      settled: round.settled,
      hasSplit: round.hasSplit,
      splitAces: round.splitAces,
      activeHandIndex: round.activeHandIndex,
      playerHand: activeHand.cards.map(cardPublic),
      playerHands,
      dealerHand: round.dealer.map((card, index) => revealDealer || index !== 0 ? cardPublic(card) : null),
      playerScore: activeEvaluation.score,
      playerSoft: activeEvaluation.isSoft,
      dealerScore: dealerEvaluation.score,
      dealerSoft: dealerEvaluation.isSoft,
      canHit: canAct && !round.splitAces,
      canStand: canAct,
      canDouble: canAct && activeHand.cards.length === 2 && !activeHand.doubled && !round.splitAces,
      canSplit: canAct && this.#canSplit(round),
      payout: round.payout,
      result: round.result,
      handResults: playerHands.map(hand => hand.result),
      debit: this.#totalBet(round) + round.insuranceBet
    };
  }
}

function calculatePachinkoSettlement(bet, risk, rawResults) {
  if (!Number.isSafeInteger(bet) || bet < 1) throw new RangeError('Pachinko bet must be a positive whole number');
  const multipliers = PACHINKO_MULTIPLIERS[risk];
  if (!multipliers) throw new RangeError('Invalid risk level');
  if (!Array.isArray(rawResults) || rawResults.length < 1) throw new TypeError('Pachinko results are required');

  let payoutMilli = 0;
  const results = rawResults.map(result => {
    const slotIndex = Number(result?.slotIndex);
    const canonicalMultiplier = multipliers[slotIndex];
    if (!Number.isSafeInteger(slotIndex) || canonicalMultiplier === undefined || result?.multiplier !== canonicalMultiplier) {
      throw new RangeError('Pachinko result does not match the canonical multiplier table');
    }
    const ballPayoutMilli = Math.round(bet * canonicalMultiplier * 1000);
    if (!Number.isSafeInteger(ballPayoutMilli) || ballPayoutMilli < 0) throw new RangeError('Pachinko payout exceeds the safe range');
    payoutMilli += ballPayoutMilli;
    if (!Number.isSafeInteger(payoutMilli)) throw new RangeError('Pachinko batch payout exceeds the safe range');
    return { slotIndex, multiplier: canonicalMultiplier, payout: ballPayoutMilli / 1000 };
  });

  return { results, payout: payoutMilli / 1000 };
}

function generatePachinkoResult(risk, randomInt = crypto.randomInt) {
  const multipliers = PACHINKO_MULTIPLIERS[risk];
  if (!multipliers) throw new RangeError('Invalid risk level');
  let slotIndex = 0;
  for (let row = 0; row < 16; row += 1) slotIndex += randomInt(2);
  return { slotIndex, multiplier: multipliers[slotIndex] };
}

module.exports = {
  BlackjackService,
  PACHINKO_MULTIPLIERS,
  calculatePachinkoSettlement,
  createShuffledDeck,
  generatePachinkoResult,
  scoreHand,
  evaluateBlackjackHand
};
