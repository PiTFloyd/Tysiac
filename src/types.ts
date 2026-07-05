// src/types.ts

export interface Card {
  id: string;
  suit: "H" | "D" | "C" | "S"; // H: Hearts (Kier), D: Diamonds (Karo), C: Clubs (Trefl), S: Spades (Pik)
  value: "9" | "J" | "Q" | "K" | "10" | "A";
  points: number;
}

export interface Player {
  username: string;
  isBot: boolean;
  ready: boolean;
  cardCount: number;
}

export interface GameState {
  scores: Record<string, number>;
  roundScores: Record<string, number>;
  trump: Card["suit"] | null;
  currentTurn: string;
  dealer: string;
  bidding: {
    highestBid: number;
    highestBidder: string | null;
    currentBidderIndex: number;
    passed: string[];
    minBid: number;
  };
  skatWinner: string | null;
  skatSeen: boolean;
  currentTrick: { username: string; card: Card }[];
  tricksCount: number;
  hand: Card[]; // Current player's hand
  skat: Card[]; // Skat cards (visible if revealed/won)
  hasUsedBomb?: Record<string, boolean>;
  validCardIds?: string[];
  skatCardIds?: string[];
}

export interface Room {
  id: string;
  mode: "solo" | "duo" | "multi";
  status: "LOBBY" | "BIDDING" | "SKAT_REVEAL" | "DISTRIBUTING" | "PLAYING" | "FINISHED";
  players: Player[];
  winnerUsername: string | null;
  gameState: GameState | null;
  saveVotes?: Record<string, boolean>;
  restoredFromSavedGameId?: string;
}

export interface SavedGame {
  id: string;
  mode: "solo" | "duo" | "multi";
  status: string;
  players: string; // JSON string of Player[]
  gameState: string; // JSON string of GameState
  createdAt: string;
}


export interface User {
  id: string;
  username: string;
  createdAt: string;
  winsCount?: number;
}

export interface LogMessage {
  message: string;
  timestamp: string;
}
