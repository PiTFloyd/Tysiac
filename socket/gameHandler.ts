// socket/gameHandler.ts

import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../auth/authController";
import { prisma } from "../src/db";

// Card type definition
export interface Card {
  id: string;
  suit: "H" | "D" | "C" | "S"; // Hearts (Kier - 100), Diamonds (Karo - 80), Clubs (Trefl - 60), Spades (Pik - 40)
  value: "9" | "J" | "Q" | "K" | "10" | "A";
  points: number;
}

const POINTS_MAP: Record<Card["value"], number> = {
  "9": 0,
  "J": 2,
  "Q": 3,
  "K": 4,
  "10": 10,
  "A": 11,
};

const MARRIAGE_VALUES: Record<Card["suit"], number> = {
  H: 100, // Kier
  D: 80,  // Karo
  C: 60,  // Trefl
  S: 40,  // Pik
};

const RANK_ORDER: Record<Card["value"], number> = {
  "9": 1,
  "J": 2,
  "Q": 3,
  "K": 4,
  "10": 5,
  "A": 6,
};

function getValidCardsToPlay(
  hand: Card[],
  currentTrick: { username: string; card: Card }[],
  trump: Card["suit"] | null
): Card[] {
  if (currentTrick.length === 0) {
    return hand;
  }

  const leadCard = currentTrick[0].card;
  const hasLeadSuit = hand.some((c) => c.suit === leadCard.suit);

  if (currentTrick.length === 1) {
    // Second player
    if (hasLeadSuit) {
      // Must follow suit. Also must beat if possible
      const beatingLeadSuitCards = hand.filter(
        (c) => c.suit === leadCard.suit && RANK_ORDER[c.value] > RANK_ORDER[leadCard.value]
      );
      if (beatingLeadSuitCards.length > 0) {
        return beatingLeadSuitCards;
      } else {
        return hand.filter((c) => c.suit === leadCard.suit);
      }
    } else {
      // Doesn't have leading suit.
      // Must beat if possible (by trumping, since we don't have lead suit)
      if (trump && leadCard.suit !== trump) {
        const trumpCards = hand.filter((c) => c.suit === trump);
        if (trumpCards.length > 0) {
          return trumpCards;
        }
      }
      return hand;
    }
  }

  if (currentTrick.length === 2) {
    // Third player
    if (hasLeadSuit) {
      return hand.filter((c) => c.suit === leadCard.suit);
    } else {
      // Doesn't have lead suit - can play any card (no obligation to play trump!)
      return hand;
    }
  }

  return hand;
}

function hasMarriageInHand(hand: Card[]): boolean {
  return (["H", "D", "C", "S"] as Card["suit"][]).some((suit) => {
    return hand.some((c) => c.suit === suit && c.value === "K") &&
           hand.some((c) => c.suit === suit && c.value === "Q");
  });
}

export interface Player {
  id: string;
  username: string;
  isBot: boolean;
  socketId?: string;
  ready: boolean;
}

export interface GameState {
  deck: Card[];
  hands: Record<string, Card[]>; // username -> cards
  skat: Card[];                 // 3 stock cards
  scores: Record<string, number>; // cumulative match scores
  roundScores: Record<string, number>; // current round card points
  roundMarriages: Record<string, Card["suit"][]>; // declared marriages in this round
  trump: Card["suit"] | null;
  dealerIndex: number;
  currentTurn: string;         // username
  bidding: {
    highestBid: number;
    highestBidder: string | null;
    currentBidderIndex: number;
    passed: string[]; // usernames of passed players
    minBid: number;
    originalBid?: number;
  };
  skatWinner: string | null;
  skatSeen: boolean;
  distributedTo: string[]; // usernames who received a card from bidder
  currentTrick: { username: string; card: Card }[];
  firstPlayerOfTrick: string | null;
  tricksCount: number;
  hasUsedBomb: Record<string, boolean>;
}

export interface Room {
  id: string;
  mode: "solo" | "duo" | "multi"; // Solo (1 player + 2 bots), Duo (2 players + 1 bot), Multi (3 players)
  players: Player[];
  status: "LOBBY" | "BIDDING" | "SKAT_REVEAL" | "DISTRIBUTING" | "PLAYING" | "FINISHED";
  gameState: GameState | null;
  winnerUsername: string | null;
  createdAt: Date;
  saveVotes?: Record<string, boolean>;
  restoredFromSavedGameId?: string;
}

// Memory storage for active rooms
const rooms: Record<string, Room> = {};

// Memory storage for active resume lobbies
const resumeLobbies: Record<
  string,
  {
    savedGameId: string;
    joinedPlayers: Set<string>;
    participants: string[];
    sockets: Record<string, string>;
    originalPlayers: any[];
    gameState: any;
    mode: "solo" | "duo" | "multi";
    status: string;
  }
> = {};

function createDeck(): Card[] {
  const suits: Card["suit"][] = ["H", "D", "C", "S"];
  const values: Card["value"][] = ["9", "J", "Q", "K", "10", "A"];
  const deck: Card[] = [];
  let counter = 0;
  for (const suit of suits) {
    for (const value of values) {
      deck.push({
        id: `${suit}_${value}_${counter++}`,
        suit,
        value,
        points: POINTS_MAP[value],
      });
    }
  }
  return deck;
}

function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Generate code
function generateRoomCode(): string {
  const chars = "ABCDEFGHIJKLMNPQRSTUVWXYZ123456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Get standard 10-rounded score
function roundScore(score: number): number {
  return Math.round(score / 10) * 10;
}

export function registerSocketHandlers(io: Server) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Authentication error: Token required"));
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
      socket.data.userId = decoded.userId;
      socket.data.username = decoded.username;
      next();
    } catch (err) {
      next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const username = socket.data.username;
    const userId = socket.data.userId;

    console.log(`User connected: ${username} (${socket.id})`);

    // Helper to send game logs
    const logToRoom = (roomId: string, message: string) => {
      io.to(roomId).emit("game:msg", { message, timestamp: new Date().toLocaleTimeString() });
    };

    // Helper to save game state to DB when requested or on auto-vote
    const triggerGameSave = async (room: Room) => {
      logToRoom(room.id, `💾 Wszystkie głosy za zapisaniem gry zostały zebrane! Gra jest zapisywana w bazie danych...`);
      
      try {
        let savedGame;
        if (room.restoredFromSavedGameId) {
          try {
            savedGame = await prisma.savedGame.update({
              where: { id: room.restoredFromSavedGameId },
              data: {
                mode: room.mode,
                status: room.status,
                players: JSON.stringify(room.players),
                gameState: JSON.stringify(room.gameState),
              }
            });
            logToRoom(room.id, `✅ Stan zapisu gry zaktualizowany pomyślnie!`);
          } catch (updateErr) {
            console.warn("Failed to update existing saved game, creating new one:", updateErr);
            savedGame = await prisma.savedGame.create({
              data: {
                mode: room.mode,
                status: room.status,
                players: JSON.stringify(room.players),
                gameState: JSON.stringify(room.gameState),
              }
            });
            logToRoom(room.id, `✅ Gra pomyślnie zapisana!`);
          }
        } else {
          savedGame = await prisma.savedGame.create({
            data: {
              mode: room.mode,
              status: room.status,
              players: JSON.stringify(room.players),
              gameState: JSON.stringify(room.gameState),
            }
          });
          logToRoom(room.id, `✅ Gra pomyślnie zapisana!`);
        }
        
        // Interrupt game
        room.status = "FINISHED";
        room.winnerUsername = "GRA_ZAPISANA"; // Special flag indicating game was saved and finished
        emitRoomState(room);
        
        // Delete active room from active memory after a short delay so clients can notice the update
        setTimeout(() => {
          delete rooms[room.id];
        }, 3000);
      } catch (err) {
        console.error("Error saving game to database:", err);
        io.to(room.id).emit("room:error", "Błąd zapisu gry w bazie danych.");
      }
    };

    // Helper to mask hands of other players
    const emitRoomState = (room: Room) => {
      room.players.forEach((p) => {
        if (p.isBot || !p.socketId) return;

        const gs = room.gameState;
        const dealerIdx = gs?.dealerIndex ?? -1;
        const forcedBidderIdx = dealerIdx !== -1 ? (dealerIdx + 1) % 3 : -1;
        const forcedBidderName = forcedBidderIdx !== -1 ? room.players[forcedBidderIdx]?.username : null;
        const isSkatWinnerForcedBidder = gs?.skatWinner === forcedBidderName;

        // Mask skat unless in reveal state or won by this user.
        // If skatWinner is the forced bidder, do NOT show it to other players even in SKAT_REVEAL.
        const showSkat = gs ? (
          room.status === "SKAT_REVEAL"
            ? (!isSkatWinnerForcedBidder || gs.skatWinner === p.username)
            : (gs.skatWinner === p.username)
        ) : false;

        const playerHand = gs?.hands[p.username] || [];
        const validCards = gs && room.status === "PLAYING" && gs.currentTurn === p.username
          ? getValidCardsToPlay(playerHand, gs.currentTrick, gs.trump).map((c) => c.id)
          : [];

        // Clone state to protect secret cards
        const maskedState = {
          id: room.id,
          mode: room.mode,
          status: room.status,
          saveVotes: room.saveVotes || {},
          restoredFromSavedGameId: room.restoredFromSavedGameId,
          players: room.players.map((pl) => ({
            username: pl.username,
            isBot: pl.isBot,
            ready: pl.ready,
            cardCount: room.gameState?.hands[pl.username]?.length || 0,
          })),
          winnerUsername: room.winnerUsername,
          gameState: room.gameState
            ? {
                scores: room.gameState.scores,
                roundScores: room.gameState.roundScores,
                trump: room.gameState.trump,
                currentTurn: room.gameState.currentTurn,
                dealer: room.players[room.gameState.dealerIndex]?.username || "Brak",
                bidding: room.gameState.bidding,
                skatWinner: room.gameState.skatWinner,
                skatSeen: room.gameState.skatSeen,
                currentTrick: room.gameState.currentTrick,
                tricksCount: room.gameState.tricksCount,
                skat: showSkat ? room.gameState.skat : [],
                // Send only this specific player's hand
                hand: room.gameState.hands[p.username] || [],
                hasUsedBomb: room.gameState.hasUsedBomb || {},
                validCardIds: validCards,
              }
            : null,
        };

        io.to(p.socketId).emit("room:state", maskedState);
      });
    };

    // 1. Create room
    socket.on("room:create", ({ mode }: { mode: "solo" | "duo" | "multi" }) => {
      const roomId = generateRoomCode();
      const newRoom: Room = {
        id: roomId,
        mode,
        players: [{ id: userId, username, isBot: false, socketId: socket.id, ready: true }],
        status: "LOBBY",
        gameState: null,
        winnerUsername: null,
        createdAt: new Date(),
      };

      // Auto-add bots based on mode
      if (mode === "solo") {
        newRoom.players.push(
          { id: "bot_1", username: "Bot Aleksandra", isBot: true, ready: true },
          { id: "bot_2", username: "Bot Bartosz", isBot: true, ready: true }
        );
      } else if (mode === "duo") {
        newRoom.players.push(
          { id: "bot_1", username: "Bot Aleksandra", isBot: true, ready: true }
        );
      }

      rooms[roomId] = newRoom;
      socket.join(roomId);

      logToRoom(roomId, `${username} utworzył pokój ${roomId} (Tryb: ${mode})`);
      emitRoomState(newRoom);

      // Auto start if all 3 are ready (e.g., solo vs bots)
      const allReady = newRoom.players.length === 3 && newRoom.players.every((p) => p.ready);
      if (allReady) {
        startGame(newRoom);
      }
    });

    // 2. Join room
    socket.on("room:join", ({ roomId }: { roomId: string }) => {
      const room = rooms[roomId?.toUpperCase()];
      if (!room) {
        socket.emit("room:error", "Pokój nie istnieje.");
        return;
      }

      // Check if user already in room
      const existingIdx = room.players.findIndex((p) => p.username === username);
      let isReconnect = false;

      if (existingIdx !== -1) {
        const wasDisconnected = !room.players[existingIdx].socketId;
        room.players[existingIdx].socketId = socket.id;
        
        // Reset save vote to false when they reconnect so they can vote again in future save votes!
        if (room.saveVotes && room.saveVotes[username] !== undefined) {
          room.saveVotes[username] = false;
        }

        if (room.status === "LOBBY") {
          room.players[existingIdx].ready = true;
        } else if (wasDisconnected) {
          isReconnect = true;
          logToRoom(room.id, `🔌 Gracz ${username} powrócił do stołu!`);
        }
      } else {
        // Only block new players if game is already active
        if (room.status !== "LOBBY") {
          socket.emit("room:error", "Rozgrywka w tym pokoju już trwa.");
          return;
        }

        // If room is already full (max 3 players)
        const humanAndBotCount = room.players.length;
        if (humanAndBotCount >= 3) {
          // If we have bots we can replace a bot with the joining human
          const botIdx = room.players.findIndex((p) => p.isBot);
          if (botIdx !== -1) {
            logToRoom(roomId, `${room.players[botIdx].username} opuścił stół (zastąpiony przez gracza ${username})`);
            room.players.splice(botIdx, 1);
          } else {
            socket.emit("room:error", "Pokój jest pełny.");
            return;
          }
        }
        room.players.push({ id: userId, username, isBot: false, socketId: socket.id, ready: false });
      }

      socket.join(room.id);
      if (!isReconnect) {
        logToRoom(room.id, `${username} dołączył do pokoju`);
      }
      emitRoomState(room);
    });

    // 3. Player ready
    socket.on("room:ready", ({ roomId }: { roomId: string }) => {
      const room = rooms[roomId?.toUpperCase()];
      if (!room || room.status !== "LOBBY") return;

      const player = room.players.find((p) => p.username === username);
      if (player) {
        player.ready = true;
        logToRoom(room.id, `${username} jest gotowy`);
        emitRoomState(room);

        // Auto start if all 3 are ready
        const allReady = room.players.length === 3 && room.players.every((p) => p.ready);
        if (allReady) {
          startGame(room);
        }
      }
    });

    // 3.5. Owner start game (forces game start, fills empty spots with bots)
    socket.on("room:start", ({ roomId }: { roomId: string }) => {
      const room = rooms[roomId?.toUpperCase()];
      if (!room || room.status !== "LOBBY") return;

      const isOwner = room.players[0]?.username === username;
      if (!isOwner) {
        socket.emit("room:error", "Tylko założyciel pokoju może rozpocząć grę.");
        return;
      }

      // Add bots if there are fewer than 3 players
      const botNames = ["Bot Aleksandra", "Bot Bartosz"];
      while (room.players.length < 3) {
        const nextBotNum = room.players.length;
        const botName = botNames[nextBotNum - 1] || `Bot ${nextBotNum}`;
        room.players.push({
          id: `bot_${Date.now()}_${nextBotNum}`,
          username: botName,
          isBot: true,
          ready: true,
        });
        logToRoom(room.id, `${botName} dołączył do gry.`);
      }

      // Mark all players as ready
      room.players.forEach((p) => {
        p.ready = true;
      });

      logToRoom(room.id, "Gra rozpoczęta ręcznie przez lidera pokoju.");
      emitRoomState(room);
      startGame(room);
    });

    // Start a new round of play
    function startRound(room: Room) {
      if (!room.gameState) return;

      const gs = room.gameState;
      gs.deck = createDeck();
      const shuffled = shuffleDeck(gs.deck);

      // Deal 7 cards to each of the 3 players, 3 to skat
      const p1 = room.players[0].username;
      const p2 = room.players[1].username;
      const p3 = room.players[2].username;

      gs.hands[p1] = shuffled.slice(0, 7);
      gs.hands[p2] = shuffled.slice(7, 14);
      gs.hands[p3] = shuffled.slice(14, 21);
      gs.skat = shuffled.slice(21, 24);

      // Reset round states
      room.players.forEach((p) => {
        gs.roundScores[p.username] = 0;
        gs.roundMarriages[p.username] = [];
      });
      gs.trump = null;
      gs.currentTrick = [];
      gs.tricksCount = 0;
      gs.firstPlayerOfTrick = null;

      // Set dealer index (rotate dealer)
      gs.dealerIndex = (gs.dealerIndex + 1) % 3;
      const dealerName = room.players[gs.dealerIndex].username;

      // First bidder is the player to the left of the dealer
      const firstBidderIdx = (gs.dealerIndex + 1) % 3;
      const firstBidderName = room.players[firstBidderIdx].username;

      gs.bidding = {
        highestBid: 100,
        highestBidder: firstBidderName, // Standard rule: first bidder automatically bids 100
        currentBidderIndex: (firstBidderIdx + 1) % 3, // Next player to bid
        passed: [],
        minBid: 110,
      };

      gs.skatWinner = null;
      gs.skatSeen = false;
      gs.distributedTo = [];

      room.status = "BIDDING";
      gs.currentTurn = room.players[gs.bidding.currentBidderIndex].username;

      logToRoom(room.id, `Nowe rozdanie rozpoczęte. Rozdaje: ${dealerName}. Pierwsza licytacja należy do gracza ${gs.currentTurn} (obecna stawka: 100 u ${firstBidderName})`);
      emitRoomState(room);

      // Check if current turn is bot
      checkAndRunBotAction(room);
    }

    function startGame(room: Room) {
      const p1 = room.players[0].username;
      const p2 = room.players[1].username;
      const p3 = room.players[2].username;

      room.gameState = {
        deck: [],
        hands: { [p1]: [], [p2]: [], [p3]: [] },
        skat: [],
        scores: { [p1]: 0, [p2]: 0, [p3]: 0 },
        roundScores: { [p1]: 0, [p2]: 0, [p3]: 0 },
        roundMarriages: { [p1]: [], [p2]: [], [p3]: [] },
        trump: null,
        dealerIndex: -1, // Will become 0 on first round
        currentTurn: "",
        bidding: {
          highestBid: 100,
          highestBidder: null,
          currentBidderIndex: 0,
          passed: [],
          minBid: 100,
        },
        skatWinner: null,
        skatSeen: false,
        distributedTo: [],
        currentTrick: [],
        firstPlayerOfTrick: null,
        tricksCount: 0,
        hasUsedBomb: { [p1]: false, [p2]: false, [p3]: false },
      };

      room.saveVotes = {};
      room.players.forEach((p) => {
        room.saveVotes![p.username] = p.isBot ? true : false;
      });

      logToRoom(room.id, `Gra się rozpoczyna! Gracze: ${p1}, ${p2}, ${p3}`);
      startRound(room);
    }

    // 4. Bidding (Licytacja)
    socket.on("game:bid", ({ roomId, bid, pass }: { roomId: string; bid?: number; pass?: boolean }) => {
      const room = rooms[roomId?.toUpperCase()];
      if (!room || !room.gameState || room.status !== "BIDDING") return;

      const gs = room.gameState;
      if (gs.currentTurn !== username) {
        socket.emit("room:error", "To nie jest twoja tura licytacji.");
        return;
      }

      if (!pass && bid && bid > 140) {
        const hand = gs.hands[username] || [];
        if (!hasMarriageInHand(hand)) {
          socket.emit("room:error", "Nie możesz licytować powyżej 140 punktów nie mając meldunku na ręce!");
          return;
        }
      }

      handleBidAction(room, username, bid, pass);
    });

    function handleBidAction(room: Room, playerUsername: string, bid?: number, pass?: boolean) {
      const gs = room.gameState!;
      const bidding = gs.bidding;

      if (pass) {
        if (!bidding.passed.includes(playerUsername)) {
          bidding.passed.push(playerUsername);
          logToRoom(room.id, `${playerUsername} pasuje.`);
        }
      } else if (bid && bid >= bidding.minBid && bid % 10 === 0) {
        bidding.highestBid = bid;
        bidding.highestBidder = playerUsername;
        bidding.minBid = bid + 10;
        logToRoom(room.id, `${playerUsername} licytuje ${bid}.`);
      } else {
        // Invalid bid
        return;
      }

      // Check if bidding is complete
      // Bidding completes when 2 players have passed
      const activePlayers = room.players.filter((p) => !bidding.passed.includes(p.username));

      if (bidding.passed.length >= 2) {
        // Bidding winner is the remaining active player
        const winner = activePlayers[0] || room.players.find((p) => p.username === bidding.highestBidder);
        if (winner) {
          gs.skatWinner = winner.username;
          room.status = "SKAT_REVEAL";
          gs.currentTurn = winner.username;
          gs.bidding.originalBid = bidding.highestBid;
          logToRoom(room.id, `Licytację wygrywa ${winner.username} z ofertą ${bidding.highestBid}! Odkrywanie musika (skata)...`);
          emitRoomState(room);

          // Reveal Skat automatically
          setTimeout(() => {
            if (room.status === "SKAT_REVEAL" && room.gameState) {
              room.gameState.skatSeen = true;
              // Winner takes the 3 skat cards into their hand
              room.gameState.hands[winner.username].push(...room.gameState.skat);
              room.gameState.skat = [];
              room.status = "DISTRIBUTING";
              logToRoom(room.id, `${winner.username} pobrał musik. Musi teraz oddać po jednej karcie pozostałym graczom.`);
              emitRoomState(room);
              checkAndRunBotAction(room);
            }
          }, 3000);
        }
      } else {
        // Find next active bidder
        let nextIdx = bidding.currentBidderIndex;
        do {
          nextIdx = (nextIdx + 1) % 3;
        } while (bidding.passed.includes(room.players[nextIdx].username));

        bidding.currentBidderIndex = nextIdx;
        gs.currentTurn = room.players[nextIdx].username;
        emitRoomState(room);
        checkAndRunBotAction(room);
      }
    }

    // Increase/decrease contract value (podniesienie/zmiana stawki gry)
    socket.on("game:increase_bid", ({ roomId, newBid }: { roomId: string; newBid: number }) => {
      const room = rooms[roomId?.toUpperCase()];
      if (!room || !room.gameState || (room.status !== "DISTRIBUTING" && room.status !== "SKAT_REVEAL")) return;

      const gs = room.gameState;
      if (gs.skatWinner !== username) {
        socket.emit("room:error", "Tylko licytator może zmienić stawkę kontraktu.");
        return;
      }

      const minBidAllowed = gs.bidding.originalBid || 100;
      if (newBid < minBidAllowed) {
        socket.emit("room:error", `Nowa stawka nie może być niższa niż wylicytowana stawka (${minBidAllowed} pkt).`);
        return;
      }

      if (newBid % 10 !== 0) {
        socket.emit("room:error", "Stawka musi być wielokrotnością 10.");
        return;
      }

      if (newBid > 300) {
        socket.emit("room:error", "Maksymalna stawka kontraktu to 300.");
        return;
      }

      if (newBid > 140) {
        const hand = gs.hands[username] || [];
        if (!hasMarriageInHand(hand)) {
          socket.emit("room:error", "Nie możesz podnieść kontraktu powyżej 140 punktów nie mając meldunku na ręce!");
          return;
        }
      }

      const oldBid = gs.bidding.highestBid;
      if (oldBid === newBid) return;

      gs.bidding.highestBid = newBid;
      if (newBid > oldBid) {
        logToRoom(room.id, `📈 ${username} podniósł wartość gry z ${oldBid} na ${newBid} pkt!`);
      } else {
        logToRoom(room.id, `📉 ${username} obniżył wartość gry z ${oldBid} na ${newBid} pkt!`);
      }
      emitRoomState(room);
    });

    // Bomb action (bomba)
    socket.on("game:bomba", ({ roomId }: { roomId: string }) => {
      const room = rooms[roomId?.toUpperCase()];
      if (!room || !room.gameState || (room.status !== "PLAYING" && room.status !== "DISTRIBUTING" && room.status !== "SKAT_REVEAL")) return;

      const gs = room.gameState;
      if (gs.skatWinner !== username) {
        socket.emit("room:error", "Tylko osoba, która zgarnęła musik, może rzucić bombę.");
        return;
      }

      if (gs.hasUsedBomb && gs.hasUsedBomb[username]) {
        socket.emit("room:error", "Wykorzystałeś już bombę w tym meczu (można rzucić tylko raz na cały mecz).");
        return;
      }

      if (room.status === "PLAYING" && (gs.tricksCount > 0 || gs.currentTrick.length > 0)) {
        socket.emit("room:error", "Bomba może być zgłoszona tylko przed zagraniem pierwszej karty.");
        return;
      }

      handleBomba(room, username);
    });

    // 5. Distribute card
    socket.on("game:distribute", ({ roomId, cardId, targetUsername }: { roomId: string; cardId: string; targetUsername: string }) => {
      const room = rooms[roomId?.toUpperCase()];
      if (!room || !room.gameState || room.status !== "DISTRIBUTING") return;

      const gs = room.gameState;
      if (gs.currentTurn !== username) {
        socket.emit("room:error", "To nie jest twoja tura.");
        return;
      }

      const success = handleDistributeAction(room, username, cardId, targetUsername);
      if (!success) {
        socket.emit("room:error", "Nieprawidłowy ruch rozdania karty.");
      }
    });

    function handleDistributeAction(room: Room, bidderUsername: string, cardId: string, targetUsername: string): boolean {
      const gs = room.gameState!;
      if (targetUsername === bidderUsername) return false;

      // Must distribute to other active players
      const otherPlayers = room.players.filter((p) => p.username !== bidderUsername).map((p) => p.username);
      if (!otherPlayers.includes(targetUsername)) return false;

      if (gs.distributedTo.includes(targetUsername)) return false;

      const hand = gs.hands[bidderUsername];
      if (!hand) return false;
      const cardIdx = hand.findIndex((c) => c.id === cardId);
      if (cardIdx === -1) return false;

      const targetHand = gs.hands[targetUsername];
      if (!targetHand) return false;

      // Transfer card
      const [card] = hand.splice(cardIdx, 1);
      targetHand.push(card);
      gs.distributedTo.push(targetUsername);

      logToRoom(room.id, `${bidderUsername} oddał jedną kartę graczowi ${targetUsername}.`);

      if (gs.distributedTo.length >= 2) {
        // Completed distribution! Start trick playing phase
        room.status = "PLAYING";
        gs.currentTurn = bidderUsername; // Bidder starts the first trick
        logToRoom(room.id, `Rozdanie zakończone. Wszystkie karty zostały przekazane. ${bidderUsername} rozpoczyna pierwszą lewę (rozgrywkę).`);
      }

      emitRoomState(room);
      checkAndRunBotAction(room);
      return true;
    }

    // 6. Play card (and declare marriage)
    socket.on("game:play_card", ({ roomId, cardId, declareMarriage }: { roomId: string; cardId: string; declareMarriage?: boolean }) => {
      const room = rooms[roomId?.toUpperCase()];
      if (!room || !room.gameState || room.status !== "PLAYING") return;

      const gs = room.gameState;
      if (gs.currentTurn !== username) {
        socket.emit("room:error", "To nie jest twoja tura gry.");
        return;
      }

      const success = handlePlayCardAction(room, username, cardId, declareMarriage);
      if (!success) {
        socket.emit("room:error", "Nieprawidłowy ruch kartą. Musisz przestrzegać zasad koloru/trumfu.");
      }
    });

    function handlePlayCardAction(room: Room, playerUsername: string, cardId: string, declareMarriage?: boolean): boolean {
      const gs = room.gameState!;
      const hand = gs.hands[playerUsername];
      if (!hand) return false;
      const card = hand.find((c) => c.id === cardId);

      if (!card) return false;

      // Standard Trick Play Rules Validation
      if (gs.currentTrick.length > 0) {
        const validCards = getValidCardsToPlay(hand, gs.currentTrick, gs.trump);
        const isValid = validCards.some((c) => c.id === cardId);
        if (!isValid) {
          return false;
        }
      }

      // Check Marriage Declaration (Meldunek)
      // Marriage can only be declared if:
      // 1. It is the lead play of a trick (currentTrick.length === 0)
      // 2. The player has both King (K) and Queen (Q) of the same suit in their hand
      // 3. Either the King or Queen is played. We automatically declare the marriage if they lead the trick and have both partner cards!
      let marriageDeclared = false;
      let marriageSuit: Card["suit"] | null = null;

      if (gs.currentTrick.length === 0) {
        if (card.value === "K" || card.value === "Q") {
          const partnerValue = card.value === "K" ? "Q" : "K";
          const hasPartner = hand.some((c) => c.suit === card.suit && c.value === partnerValue);
          if (hasPartner) {
            marriageDeclared = true;
            marriageSuit = card.suit;
          }
        }
      }

      // Remove card from player hand
      const cardIdx = hand.findIndex((c) => c.id === cardId);
      hand.splice(cardIdx, 1);

      // Add to current trick
      gs.currentTrick.push({ username: playerUsername, card });

      if (marriageDeclared && marriageSuit) {
        gs.trump = marriageSuit;
        const pts = MARRIAGE_VALUES[marriageSuit];
        gs.roundMarriages[playerUsername].push(marriageSuit);
        gs.roundScores[playerUsername] = (gs.roundScores[playerUsername] || 0) + pts;

        let suitName = "";
        if (marriageSuit === "H") suitName = "Kier (Czerwień ♥)";
        if (marriageSuit === "D") suitName = "Karo (Dzwonek ♦)";
        if (marriageSuit === "C") suitName = "Trefl (Żołądź ♣)";
        if (marriageSuit === "S") suitName = "Pik (Wino ♠)";

        logToRoom(room.id, `👑 ${playerUsername} melduje parę król-dama w kolorze ${suitName}! Otrzymuje +${pts} pkt. Trumfem zostaje ${suitName}.`);
        io.to(room.id).emit("game:meld", { username: playerUsername, points: pts });
      }

      logToRoom(room.id, `${playerUsername} zagrywa: [${card.value} ${card.suit}]`);

      // Resolve trick or move turn
      if (gs.currentTrick.length === 3) {
        // Trick complete, resolve after small delay for UI readability
        gs.currentTurn = ""; // Disable input during trick resolution delay
        emitRoomState(room);

        setTimeout(() => {
          resolveTrick(room);
        }, 2000);
      } else {
        // Move turn to next player in room circle
        const currentIdx = room.players.findIndex((p) => p.username === playerUsername);
        const nextIdx = (currentIdx + 1) % 3;
        gs.currentTurn = room.players[nextIdx].username;

        emitRoomState(room);
        checkAndRunBotAction(room);
      }

      return true;
    }

    function resolveTrick(room: Room) {
      if (!room.gameState) return;
      const gs = room.gameState;

      const leadPlay = gs.currentTrick[0];
      const leadSuit = leadPlay.card.suit;

      let winningPlay = leadPlay;

      // Compare the 3 cards in the trick
      // Card ranks in Thousand: 9 (lowest) < J < Q < K < 10 < A (highest)
      const rankOrder: Record<Card["value"], number> = {
        "9": 1,
        "J": 2,
        "Q": 3,
        "K": 4,
        "10": 5,
        "A": 6,
      };

      for (let i = 1; i < 3; i++) {
        const play = gs.currentTrick[i];
        const isCurrentWinTrump = winningPlay.card.suit === gs.trump;
        const isNewTrump = play.card.suit === gs.trump;

        if (isNewTrump && !isCurrentWinTrump) {
          // If a new card is a trump and the winning card is not, the new card wins
          winningPlay = play;
        } else if (play.card.suit === winningPlay.card.suit) {
          // Same suit, compare rank values
          if (rankOrder[play.card.value] > rankOrder[winningPlay.card.value]) {
            winningPlay = play;
          }
        }
        // If play.card.suit is different and not trump, it cannot win
      }

      // Trick winner
      const winner = winningPlay.username;
      const trickPoints = gs.currentTrick.reduce((acc, curr) => acc + curr.card.points, 0);

      gs.roundScores[winner] = (gs.roundScores[winner] || 0) + trickPoints;
      gs.tricksCount += 1;

      logToRoom(room.id, `♠ Lewę wygrywa ${winner} i zdobywa +${trickPoints} pkt za karty.`);

      // Clear trick
      gs.currentTrick = [];
      gs.currentTurn = winner;

      // Check if round finished (8 tricks total)
      if (gs.tricksCount >= 8) {
        resolveRound(room);
      } else {
        emitRoomState(room);
        checkAndRunBotAction(room);
      }
    }

    async function handleBomba(room: Room, bidderName: string) {
      if (!room.gameState) return;
      const gs = room.gameState;

      if (!gs.hasUsedBomb) {
        gs.hasUsedBomb = {};
      }
      gs.hasUsedBomb[bidderName] = true;

      logToRoom(room.id, `--- BOMBA! ---`);
      logToRoom(room.id, `💣 ${bidderName} zdetonował Bombę! Przeciwnicy otrzymują po +60 pkt do tabeli, a ${bidderName} 0 pkt. Przejście do następnej rundy.`);

      room.players.forEach((p) => {
        if (gs.scores[p.username] === undefined) {
          gs.scores[p.username] = 0;
        }
        if (p.username !== bidderName) {
          gs.scores[p.username] += 60;
        }
      });

      // Check if match is finished (someone has 1000+ points)
      let matchWinner: string | null = null;
      for (const p of room.players) {
        if (gs.scores[p.username] >= 1000) {
          if (!matchWinner || gs.scores[p.username] > gs.scores[matchWinner]) {
            matchWinner = p.username;
          }
        }
      }

      if (matchWinner) {
        room.status = "FINISHED";
        room.winnerUsername = matchWinner;
        logToRoom(room.id, `🏆 KONIEC GRY! Zwycięzcą zostaje ${matchWinner} z wynikiem ${gs.scores[matchWinner]} punktów!`);

        try {
          const dbWinner = room.players.find((pl) => pl.username === matchWinner && !pl.isBot);
          const serializedScores = JSON.stringify(
            room.players.map((pl) => ({ username: pl.username, score: gs.scores[pl.username] }))
          );

          await prisma.matchHistory.create({
            data: {
              status: "COMPLETED",
              scores: serializedScores,
              winnerId: dbWinner ? dbWinner.id : null,
            },
          });
          console.log("Match history successfully saved to database (bomba).");

          if (room.restoredFromSavedGameId) {
            await prisma.savedGame.delete({
              where: { id: room.restoredFromSavedGameId }
            }).catch(e => console.error("Error deleting completed saved game:", e));
          }
        } catch (dbErr) {
          console.error("Error saving match history (bomba):", dbErr);
        }
      } else {
        // Prepare next round
        logToRoom(room.id, `Suma punktów po bombie: ${room.players.map((p) => `${p.username}: ${gs.scores[p.username]}`).join(", ")}`);
        setTimeout(() => {
          startRound(room);
        }, 3000);
      }

      emitRoomState(room);
    }

    async function resolveRound(room: Room) {
      if (!room.gameState) return;
      const gs = room.gameState;

      const bidder = gs.skatWinner!;
      const targetBid = gs.bidding.highestBid;

      logToRoom(room.id, `--- Podsumowanie Rundy ---`);

      // Final round score calculations
      room.players.forEach((p) => {
        const name = p.username;
        if (gs.scores[name] === undefined) gs.scores[name] = 0;
        if (gs.roundScores[name] === undefined) gs.roundScores[name] = 0;

        const scoreEarned = gs.roundScores[name];
        let finalEarned = roundScore(scoreEarned); // Standard 10-point rounding

        const had800Plus = gs.scores[name] >= 800;

        if (name === bidder) {
          // The bidder must reach their bid
          if (scoreEarned >= targetBid) {
            // Bid met! Bidder gets their actual scored points (rounded), but capped at declared bid (maksymalnie tyle ile zadeklarował)
            const earnedCapped = targetBid;
            gs.scores[name] += earnedCapped;
            logToRoom(room.id, `🎯 ${name} (Ugrał kontrakt): ugrał ${scoreEarned} pkt (deklarował ${targetBid}). Dodano +${earnedCapped} do konta (maksymalnie deklarowana stawka).`);
          } else {
            // Bid failed! Subtract bid amount from cumulative score
            gs.scores[name] -= targetBid;
            logToRoom(room.id, `🚨 ${name} (Wpadka!): zdobył tylko ${scoreEarned} pkt (deklarował ${targetBid}). Odrzucono -${targetBid} z konta.`);
          }
        } else {
          // Non-bidders get their actual rounded scores, unless they are on 800+ points
          if (had800Plus) {
            logToRoom(room.id, `🛡️ ${name} (Obrońca na beczce >=800 pkt): zdobył ${scoreEarned} pkt, ale nie doliczają się one do jego konta (musi wygrać licytację).`);
          } else {
            gs.scores[name] += finalEarned;
            logToRoom(room.id, `🛡️ ${name} (Obrońca): zdobył ${scoreEarned} pkt. Dodano +${finalEarned} do konta.`);
          }
        }
      });

      // Cap and safety check: Score can be negative but target is 1000.
      // Standard "barrel" (beczka) rules: 880 is the barrel. To make this game simple and highly playable without blocking,
      // first player to reach 1000 points wins the match.
      let matchWinner: string | null = null;
      for (const p of room.players) {
        if (gs.scores[p.username] >= 1000) {
          if (!matchWinner || gs.scores[p.username] > gs.scores[matchWinner]) {
            matchWinner = p.username;
          }
        }
      }

      if (matchWinner) {
        room.status = "FINISHED";
        room.winnerUsername = matchWinner;
        logToRoom(room.id, `🏆 KONIEC GRY! Zwycięzcą zostaje ${matchWinner} z wynikiem ${gs.scores[matchWinner]} punktów!`);

        // Save to Database
        try {
          // Find winner User ID if exists
          const dbWinner = room.players.find((pl) => pl.username === matchWinner && !pl.isBot);
          const serializedScores = JSON.stringify(
            room.players.map((pl) => ({ username: pl.username, score: gs.scores[pl.username] }))
          );

          await prisma.matchHistory.create({
            data: {
              status: "COMPLETED",
              scores: serializedScores,
              winnerId: dbWinner ? dbWinner.id : null,
            },
          });
          console.log("Match history successfully saved to database.");

          if (room.restoredFromSavedGameId) {
            await prisma.savedGame.delete({
              where: { id: room.restoredFromSavedGameId }
            }).catch(e => console.error("Error deleting completed saved game:", e));
          }
        } catch (dbErr) {
          console.error("Error saving match history:", dbErr);
        }
      } else {
        // Prepare next round
        logToRoom(room.id, `Suma punktów: ${room.players.map((p) => `${p.username}: ${gs.scores[p.username]}`).join(", ")}`);
        setTimeout(() => {
          startRound(room);
        }, 5000);
      }

      emitRoomState(room);
    }

    // BOT LOGIC TRIGGERS AND ACTIONS
    function checkAndRunBotAction(room: Room) {
      if (room.status === "FINISHED" || !room.gameState) return;

      const currentTurnUser = room.gameState.currentTurn;
      const activePlayer = room.players.find((p) => p.username === currentTurnUser);

      if (activePlayer && activePlayer.isBot) {
        // Run bot play action after a safe delay
        setTimeout(() => {
          executeBotTurn(room, activePlayer);
        }, 1500);
      }
    }

    function executeBotTurn(room: Room, bot: Player) {
      if (room.status === "FINISHED" || !room.gameState) return;
      const gs = room.gameState;

      // Concurrency & Race Condition Safety Guards:
      // A. Bot must exist and be in the room
      const isPlayer = room.players.some((p) => p.username === bot.username);
      if (!isPlayer) return;
      // B. Ensure it is currently this bot's turn to play/bid
      if (room.status === "PLAYING" && gs.currentTurn !== bot.username) return;
      if (room.status === "BIDDING") {
        const bidder = room.players[gs.bidding.currentBidderIndex];
        if (!bidder || bidder.username !== bot.username) return;
      }

      // Helper function to estimate hand strength in points (takes initial 7 cards or 10 cards)
      function estimateHandStrength(hand: Card[]): number {
        const suits: Card["suit"][] = ["H", "D", "C", "S"];
        let marriagePoints = 0;
        const marriages: Card["suit"][] = [];
        
        for (const suit of suits) {
          const hasK = hand.some((c) => c.suit === suit && c.value === "K");
          const hasQ = hand.some((c) => c.suit === suit && c.value === "Q");
          if (hasK && hasQ) {
            marriagePoints += MARRIAGE_VALUES[suit];
            marriages.push(suit);
          }
        }

        // Find our primary trump suit (highest value marriage)
        let primaryTrump: Card["suit"] | null = null;
        if (marriages.length > 0) {
          marriages.sort((a, b) => MARRIAGE_VALUES[b] - MARRIAGE_VALUES[a]);
          primaryTrump = marriages[0];
        }

        // Count suit distributions to find voids (only counting non-trump suits)
        const suitCounts: Record<Card["suit"], number> = {
          H: hand.filter((c) => c.suit === "H").length,
          D: hand.filter((c) => c.suit === "D").length,
          C: hand.filter((c) => c.suit === "C").length,
          S: hand.filter((c) => c.suit === "S").length,
        };

        let trickPoints = 0;
        const trumpsCount = primaryTrump ? suitCounts[primaryTrump] : 0;

        for (const suit of suits) {
          const isTrump = suit === primaryTrump;
          const suitCards = hand.filter((c) => c.suit === suit);

          // Calculate value of each card in this suit
          for (const c of suitCards) {
            if (c.value === "A") {
              trickPoints += isTrump ? 18 : 15; // Ace of trumps is even more valuable
            } else if (c.value === "10") {
              const hasAce = suitCards.some((x) => x.value === "A");
              if (hasAce) {
                trickPoints += isTrump ? 15 : 12; // Ten backed by Ace
              } else {
                trickPoints += isTrump ? 10 : 6;  // Ten without Ace
              }
            } else {
              // Lower cards: King, Queen, Jack, Nine
              if (isTrump) {
                // Trump lower cards are very useful for winning tricks or trumping
                if (c.value === "K") trickPoints += 9;
                else if (c.value === "Q") trickPoints += 8;
                else if (c.value === "J") trickPoints += 6;
                else if (c.value === "9") trickPoints += 4;
              } else {
                // Non-trump lower cards have almost zero value for winning tricks, but let's give a tiny score
                if (c.value === "K") trickPoints += 2;
                else if (c.value === "Q") trickPoints += 1;
              }
            }
          }

          // Void bonus: if we have a void in a non-trump suit, and we have trumps
          if (!isTrump && primaryTrump && suitCounts[suit] === 0 && trumpsCount > 0) {
            trickPoints += 15; // Void lets us win a trick by trumping
          }
        }

        // If we have multiple marriages, we can declare the second one!
        if (marriages.length >= 2) {
          trickPoints += 20; // Multi-marriage bonus
        }

        // Add a "musik bonus" if we are bidding (7 cards in hand)
        if (hand.length === 7) {
          // If no marriages, musik is less helpful for bidding high, as we still can't declare anything.
          trickPoints += marriages.length > 0 ? 15 : 5;
        }

        // Cap trick points at 120 (total card points in the game)
        const estimatedTricksValue = Math.min(120, trickPoints);

        return marriagePoints + estimatedTricksValue;
      }

      // 1. Bidding Phase
      if (room.status === "BIDDING") {
        const bidding = gs.bidding;
        const hand = gs.hands[bot.username] || [];

        // Calculate marriages
        const suitsWithMarriages = (["H", "D", "C", "S"] as Card["suit"][]).filter((suit) => {
          const hasK = hand.some((c) => c.suit === suit && c.value === "K");
          const hasQ = hand.some((c) => c.suit === suit && c.value === "Q");
          return hasK && hasQ;
        });

        const hasMarriages = suitsWithMarriages.length > 0;
        let maxSafeBid = Math.floor(estimateHandStrength(hand) / 10) * 10;

        // Cap at 300, or 100/110 if no marriages (very risky to go higher without a marriage!)
        if (!hasMarriages) {
          // If we have at least 3 Aces, we can try bidding up to 100 (which is music mandatory)
          const acesCount = hand.filter((c) => c.value === "A").length;
          maxSafeBid = Math.min(acesCount >= 3 ? 100 : 90, maxSafeBid);
        } else {
          maxSafeBid = Math.min(300, maxSafeBid);
        }

        if (bidding.minBid <= maxSafeBid) {
          handleBidAction(room, bot.username, bidding.minBid, false);
        } else {
          handleBidAction(room, bot.username, undefined, true);
        }
      }

      // 2. Distributing Phase (after winning bidding and taking skat)
      else if (room.status === "DISTRIBUTING" || room.status === "SKAT_REVEAL") {
        const hand = gs.hands[bot.username];
        if (!hand || hand.length < 9) return;

        const currentBid = gs.bidding.highestBid;
        const estimated = estimateHandStrength(hand);

        // A. Bomba Option: surrender if hand is terrible after taking skat
        // We only use Bomba if we bid at least 110, have a large deficit (at least 20 points), and haven't used the bomb yet
        if (currentBid >= 110 && estimated < currentBid - 20 && !(gs.hasUsedBomb && gs.hasUsedBomb[bot.username])) {
          logToRoom(room.id, `🤖 Bot ${bot.username} analizuje swoje 10 kart... szacowana siła: ${estimated} pkt przy kontrakcie ${currentBid}. Decyzja: BOMBA!`);
          handleBomba(room, bot.username);
          emitRoomState(room);
          return;
        }

        // B. Calculate marriages first to apply the 120 points limit rule if no marriages are present
        const suits: Card["suit"][] = ["H", "D", "C", "S"];
        const marriageSuits = suits.filter((suit) => {
          const hasK = hand.some((c) => c.suit === suit && c.value === "K");
          const hasQ = hand.some((c) => c.suit === suit && c.value === "Q");
          return hasK && hasQ;
        });

        // B. Increase Bid Option: raise contract if hand is exceptionally strong
        const hasMarriages = marriageSuits.length > 0;
        const maxAllowedBid = hasMarriages ? 300 : 120;
        const potentialMaxBid = Math.min(maxAllowedBid, Math.floor(estimated / 10) * 10);
        if (potentialMaxBid > currentBid && potentialMaxBid >= currentBid + 10) {
          gs.bidding.highestBid = potentialMaxBid;
          logToRoom(room.id, `📈 🤖 Bot ${bot.username} podniósł wartość kontraktu z ${currentBid} na ${potentialMaxBid} pkt (szacowana siła ręki: ${estimated} pkt)!`);
          emitRoomState(room);
        }

        // C. Distribute cards (distribute worst 2 cards, keeping marriages/Aces intact, and try to create voids)
        const suitCounts: Record<Card["suit"], number> = {
          H: hand.filter((c) => c.suit === "H").length,
          D: hand.filter((c) => c.suit === "D").length,
          C: hand.filter((c) => c.suit === "C").length,
          S: hand.filter((c) => c.suit === "S").length,
        };

        function getCardBadness(card: Card): number {
          const isPartOfMarriage = marriageSuits.includes(card.suit) && (card.value === "K" || card.value === "Q");
          
          // 1. NEVER distribute cards that are part of a marriage
          if (isPartOfMarriage) return 1;

          // 2. NEVER distribute Aces
          if (card.value === "A") return 2;

          // 3. Keep Tens if possible
          if (card.value === "10") {
            const hasAce = hand.some((c) => c.suit === card.suit && c.value === "A");
            return hasAce ? 3 : 4;
          }

          // 4. Primary marriage (our trump suit) is highly valuable. Keep trumps!
          const primaryTrumpSuit = marriageSuits.length > 0 
            ? [...marriageSuits].sort((a, b) => MARRIAGE_VALUES[b] - MARRIAGE_VALUES[a])[0] 
            : null;

          if (primaryTrumpSuit && card.suit === primaryTrumpSuit) {
            if (card.value === "K" || card.value === "Q") return 5;
            return 6; // J/9 of trump
          }

          // 5. Creating a VOID: If a suit has 1 or 2 cards, and we have a trump suit active,
          // discarding these card(s) can create a void, which is highly advantageous!
          const count = suitCounts[card.suit];
          let voidBonus = 0;
          if (marriageSuits.length > 0) { // Void is only useful if we have trumps to cut with!
            if (count === 1) {
              voidBonus = 40; // High bonus to discard lone card to create void
            } else if (count === 2) {
              voidBonus = 20; // Medium bonus to discard one of 2 cards
            }
          }

          // 6. Values based on card rank (Aces and Tens already handled above)
          let rankScore = 0;
          if (card.value === "9") rankScore = 50;      // 9 is worst
          else if (card.value === "J") rankScore = 40; // J is bad
          else if (card.value === "Q") rankScore = 20; // Q without partner
          else if (card.value === "K") rankScore = 15; // K without partner

          return rankScore + voidBonus;
        }

        const sortedByBadness = [...hand].sort((a, b) => getCardBadness(b) - getCardBadness(a));

        // Find targets
        const targets = room.players.filter((p) => p.username !== bot.username).map((p) => p.username);
        const firstTarget = targets[0];
        const secondTarget = targets[1];

        if (firstTarget && !gs.distributedTo.includes(firstTarget)) {
          handleDistributeAction(room, bot.username, sortedByBadness[0].id, firstTarget);
        } else if (secondTarget && !gs.distributedTo.includes(secondTarget)) {
          handleDistributeAction(room, bot.username, sortedByBadness[0].id, secondTarget);
        }
      }

      // 3. Play Card Phase
      else if (room.status === "PLAYING") {
        const hand = gs.hands[bot.username];
        if (!hand || hand.length === 0) return;

        let selectedCard: Card | null = null;
        let shouldMeld = false;

        const isCardInMarriage = (c: Card) => {
          const hasK = hand.some((x) => x.suit === c.suit && x.value === "K");
          const hasQ = hand.some((x) => x.suit === c.suit && x.value === "Q");
          return hasK && hasQ && (c.value === "K" || c.value === "Q");
        };

        // Peeking-free helper to check if card is the highest remaining of its suit.
        // It only inspects the bot's own hand, respecting players' privacy.
        const isHighestRemainingInSuit = (card: Card): boolean => {
          const valueRank = RANK_ORDER[card.value];
          
          // Determine which ranks are higher than this card
          const higherRanks = Object.keys(RANK_ORDER).filter(
            (val) => RANK_ORDER[val as Card["value"]] > valueRank
          ) as Card["value"][];

          // If the bot holds all remaining higher cards of this suit in its own hand,
          // then no opponent can hold a higher card of this suit.
          const botHoldsAllHigher = higherRanks.every((highVal) =>
            hand.some((c) => c.suit === card.suit && c.value === highVal)
          );

          return botHoldsAllHigher;
        };

        // If leading the trick
        if (gs.currentTrick.length === 0) {
          // Play marriage meldunek first if available
          const meldableSuits = (["H", "D", "C", "S"] as Card["suit"][]).filter((suit) => {
            const hasK = hand.some((c) => c.suit === suit && c.value === "K");
            const hasQ = hand.some((c) => c.suit === suit && c.value === "Q");
            return hasK && hasQ;
          });

          if (meldableSuits.length > 0) {
            meldableSuits.sort((a, b) => MARRIAGE_VALUES[b] - MARRIAGE_VALUES[a]);
            const targetSuit = meldableSuits[0];

            // If we have the Ace of this marriage suit, cash the Ace first to guarantee winning this trick,
            // then we can declare marriage on the next turn!
            const hasAceOfSuit = hand.some((c) => c.suit === targetSuit && c.value === "A");
            if (hasAceOfSuit) {
              selectedCard = hand.find((c) => c.suit === targetSuit && c.value === "A") || null;
            } else {
              // Play the Queen to declare the marriage
              selectedCard = hand.find((c) => c.suit === targetSuit && c.value === "Q") || null;
              if (!selectedCard) {
                selectedCard = hand.find((c) => c.suit === targetSuit && c.value === "K") || null;
              }
              shouldMeld = true;
            }
          }

          // If no marriage selected yet, and we are the bidder and trump is active, consider "odtrąbienie" (pulling trumps)
          if (!selectedCard && gs.bidding.highestBidder === bot.username && gs.trump) {
            const trumpsInHand = hand.filter((c) => c.suit === gs.trump);
            // If we have high trumps, lead one to clear opponents' trumps
            const highTrumps = trumpsInHand.filter((c) => c.value === "A" || c.value === "10" || c.value === "K");
            if (highTrumps.length > 0) {
              // Lead our highest trump to pull theirs
              highTrumps.sort((a, b) => RANK_ORDER[b.value] - RANK_ORDER[a.value]);
              selectedCard = highTrumps[0];
            } else if (trumpsInHand.length > 0 && gs.tricksCount < 5) {
              // Lead any trump early in the round to exhaust opponents
              selectedCard = trumpsInHand[0];
            }
          }

          // If no marriage/trump pulling, cash any cards that are guaranteed to win because no opponent holds a higher card
          if (!selectedCard) {
            const guaranteedWinners = hand.filter((c) => isHighestRemainingInSuit(c));
            if (guaranteedWinners.length > 0) {
              // Play the one with the highest rank/points (e.g. Ace, then 10, then King)
              guaranteedWinners.sort((a, b) => RANK_ORDER[b.value] - RANK_ORDER[a.value]);
              selectedCard = guaranteedWinners[0];
            }
          }

          // Fallback: play lowest point card that is NOT part of a marriage we want to declare,
          // and prefer leading low cards (9, J) rather than 10s or Kings without protection.
          if (!selectedCard) {
            const nonMarriageCards = hand.filter((c) => !isCardInMarriage(c));
            const candidates = nonMarriageCards.length > 0 ? nonMarriageCards : hand;
            
            // Sort candidates to find the safest card to lead (lowest points first, e.g., 9, J, Q, K, 10, A)
            // We want to avoid leading high points if we aren't guaranteed to win!
            candidates.sort((a, b) => {
              // Aces and Tens are precious, keep them if possible
              const aVal = a.value === "A" || a.value === "10" ? 100 + a.points : a.points;
              const bVal = b.value === "A" || b.value === "10" ? 100 + b.points : b.points;
              return aVal - bVal;
            });
            
            selectedCard = candidates[0];
          }
        } else {
          // Not leading, follow rules using the validator
          const allowedCards = getValidCardsToPlay(hand, gs.currentTrick, gs.trump);

          // Find current winning play to see what beats it
          const leadPlay = gs.currentTrick[0];
          let winningPlay = leadPlay;
          for (const play of gs.currentTrick) {
            const isWinnerTrump = winningPlay.card.suit === gs.trump;
            const isPlayTrump = play.card.suit === gs.trump;

            if (isPlayTrump && !isWinnerTrump) {
              winningPlay = play;
            } else if (play.card.suit === winningPlay.card.suit) {
              if (RANK_ORDER[play.card.value] > RANK_ORDER[winningPlay.card.value]) {
                winningPlay = play;
              }
            }
          }

          // Helper to check partnership
          const isBidderPlayer = (username: string) => username === gs.bidding.highestBidder;
          const arePlayersPartners = (p1: string, p2: string) => {
            return !isBidderPlayer(p1) && !isBidderPlayer(p2);
          };
          const isPartnerWinning = arePlayersPartners(bot.username, winningPlay.username);

          // We should only grease our partner if it is SAFE (i.e. the bidder has already played in this trick, OR we are the last player)
          const bidder = gs.bidding.highestBidder;
          const bidderHasPlayed = gs.currentTrick.some((play) => play.username === bidder);
          const isSafeToGrease = isPartnerWinning && (gs.currentTrick.length === 2 || bidderHasPlayed);

          // Find which of our allowed cards beat the winning play
          const beatingAllowedCards = allowedCards.filter((c) => {
            const isWinnerTrump = winningPlay.card.suit === gs.trump;
            const isCardTrump = c.suit === gs.trump;

            if (isCardTrump && !isWinnerTrump) {
              return true;
            } else if (c.suit === winningPlay.card.suit) {
              return RANK_ORDER[c.value] > RANK_ORDER[winningPlay.card.value];
            }
            return false;
          });

          if (isSafeToGrease) {
            // Partner is winning and it's safe! Let's grease (smarować) them with our highest point card
            // Avoid throwing marriage cards and Aces if possible
            const safeGreaseCandidates = allowedCards.filter((c) => !isCardInMarriage(c) && c.value !== "A");
            const candidates = safeGreaseCandidates.length > 0 ? safeGreaseCandidates : allowedCards;
            
            // Play highest point card
            selectedCard = candidates.reduce((prev, curr) => (curr.points > prev.points ? curr : prev));
          } else {
            // Either partner is not winning, or it's not safe to grease (bidder still to play)
            if (beatingAllowedCards.length > 0) {
              // We can beat it, let's play the lowest rank card that beats it (efficient win)
              selectedCard = beatingAllowedCards.reduce((prev, curr) => (RANK_ORDER[curr.value] < RANK_ORDER[prev.value] ? curr : prev));
            } else {
              // We can't beat it, let's play the lowest point card (discarding / zrzutka)
              // to minimize opponent's points
              const nonMarriageAllowed = allowedCards.filter((c) => !isCardInMarriage(c));
              const candidates = nonMarriageAllowed.length > 0 ? nonMarriageAllowed : allowedCards;
              selectedCard = candidates.reduce((prev, curr) => (curr.points < prev.points ? curr : prev));
            }
          }
        }

        if (selectedCard) {
          handlePlayCardAction(room, bot.username, selectedCard.id, shouldMeld);
        }
      }
    }

    // 7. Leave / Disconnect Room
    socket.on("room:leave", ({ roomId }: { roomId: string }) => {
      handleDisconnectOrLeave(roomId);
    });

    socket.on("disconnect", () => {
      // Find room user was in
      Object.keys(rooms).forEach((roomId) => {
        const room = rooms[roomId];
        const player = room.players.find((p) => p.username === username);
        if (player) {
          player.socketId = undefined;
          
          if (room.status === "LOBBY") {
            logToRoom(room.id, `🔌 Gracz ${username} wyszedł z poczekalni.`);
            const playerIdx = room.players.indexOf(player);
            if (playerIdx !== -1) {
              room.players.splice(playerIdx, 1);
            }
            if (room.players.every((p) => p.isBot)) {
              delete rooms[room.id];
            } else {
              emitRoomState(room);
            }
          } else {
            logToRoom(room.id, `🔌 Gracz ${username} utracił połączenie. Oczekiwanie na powrót (45s)...`);
            
            // Auto-vote yes for saving on behalf of the disconnected user
            if (!room.saveVotes) {
              room.saveVotes = {};
              room.players.forEach((p) => {
                room.saveVotes![p.username] = p.isBot ? true : false;
              });
            }
            room.saveVotes[username] = true;
            logToRoom(room.id, `⚙️ Uruchomiono automatyczny głos "TAK" dla ${username} w głosowaniu nad zapisaniem stanu gry.`);
            
            emitRoomState(room);

            // Check if this auto-vote completes the save requirement (e.g. if others already voted)
            const allVoted = room.players.every((p) => room.saveVotes?.[p.username]);
            if (allVoted) {
              triggerGameSave(room);
            }
            
            // Set 45s grace period for active games
            setTimeout(() => {
              const currentRoom = rooms[roomId];
              if (currentRoom) {
                const p = currentRoom.players.find((x) => x.username === username);
                if (p && !p.socketId) {
                  logToRoom(currentRoom.id, `⌛ Czas na ponowne połączenie gracza ${username} minął.`);
                  if (currentRoom.status !== "FINISHED") {
                    currentRoom.status = "FINISHED";
                    currentRoom.winnerUsername = currentRoom.players.find((x) => x.username !== username && !x.isBot)?.username || "Brak";
                    logToRoom(currentRoom.id, `Gra zakończona z powodu nieobecności ${username}.`);
                  }
                  
                  const pIdx = currentRoom.players.indexOf(p);
                  if (pIdx !== -1) {
                    currentRoom.players.splice(pIdx, 1);
                  }
                  
                  const humansRemaining = currentRoom.players.filter((x) => !x.isBot);
                  if (humansRemaining.length === 0) {
                    delete rooms[currentRoom.id];
                  } else {
                    emitRoomState(currentRoom);
                  }
                }
              }
            }, 45000);
          }
        }
      });

      // Clean up any active resume lobbies for the disconnected player
      Object.keys(resumeLobbies).forEach((savedGameId) => {
        const lobby = resumeLobbies[savedGameId];
        if (lobby && lobby.joinedPlayers.has(username)) {
          lobby.joinedPlayers.delete(username);
          delete lobby.sockets[username];
          
          const hasHumans = lobby.participants.some(pName => {
            const isBot = lobby.originalPlayers.find((p: any) => p.username === pName)?.isBot;
            return !isBot && lobby.joinedPlayers.has(pName);
          });
          
          if (!hasHumans) {
            delete resumeLobbies[savedGameId];
          } else {
            io.to(`resume_lobby_${savedGameId}`).emit("game:resume_lobby_state", {
              savedGameId,
              participants: lobby.participants,
              joinedPlayers: Array.from(lobby.joinedPlayers),
              mode: lobby.mode,
              status: lobby.status,
            });
          }
        }
      });
    });

    // 8. Save & Resume Game Handlers
    socket.on("game:save_vote", async ({ roomId }: { roomId: string }) => {
      const room = rooms[roomId?.toUpperCase()];
      if (!room || !room.gameState || room.status === "FINISHED") return;

      if (!room.saveVotes) {
        room.saveVotes = {};
        room.players.forEach((p) => {
          room.saveVotes![p.username] = p.isBot ? true : false;
        });
      }

      room.saveVotes[username] = true;
      logToRoom(room.id, `💾 ${username} zagłosował za zapisaniem gry.`);
      emitRoomState(room);

      // Check if all players have voted
      const allVoted = room.players.every((p) => room.saveVotes?.[p.username]);
      if (allVoted) {
        await triggerGameSave(room);
      }
    });

    socket.on("game:saved_list", async () => {
      try {
        const savedGames = await prisma.savedGame.findMany({
          orderBy: { createdAt: "desc" }
        });
        
        // Filter games where this user was a participant
        const userGames = savedGames.filter((g) => {
          try {
            const players = JSON.parse(g.players);
            return players.some((p: any) => p.username === username);
          } catch {
            return false;
          }
        });
        
        socket.emit("game:saved_list_response", userGames);
      } catch (err) {
        console.error("Error fetching saved games:", err);
        socket.emit("room:error", "Błąd pobierania listy zapisanych gier.");
      }
    });

    socket.on("game:resume_join", async ({ savedGameId }: { savedGameId: string }) => {
      try {
        let lobby = resumeLobbies[savedGameId];
        if (!lobby) {
          const dbGame = await prisma.savedGame.findUnique({
            where: { id: savedGameId }
          });
          if (!dbGame) {
            socket.emit("room:error", "Nie znaleziono takiej zapisanej gry.");
            return;
          }
          
          const originalPlayers = JSON.parse(dbGame.players);
          const participants = originalPlayers.map((p: any) => p.username);
          const joinedPlayers = new Set<string>();
          
          // Bots automatically join the lobby immediately
          originalPlayers.forEach((p: any) => {
            if (p.isBot) {
              joinedPlayers.add(p.username);
            }
          });
          
          lobby = {
            savedGameId,
            joinedPlayers,
            participants,
            sockets: {},
            originalPlayers,
            gameState: JSON.parse(dbGame.gameState),
            mode: dbGame.mode as any,
            status: dbGame.status as any
          };
          resumeLobbies[savedGameId] = lobby;
        }
        
        // Join the socket.io channel for this saved game's lobby
        socket.join(`resume_lobby_${savedGameId}`);
        
        // Add current player to joined list
        lobby.joinedPlayers.add(username);
        lobby.sockets[username] = socket.id;
        
        // Broadcast the lobby state to all subscribers
        const emitLobbyState = () => {
          io.to(`resume_lobby_${savedGameId}`).emit("game:resume_lobby_state", {
            savedGameId,
            participants: lobby.participants,
            joinedPlayers: Array.from(lobby.joinedPlayers),
            mode: lobby.mode,
            status: lobby.status,
          });
        };
        
        emitLobbyState();
        
        // Check if all players have joined
        const allJoined = lobby.participants.every((pName) => lobby.joinedPlayers.has(pName));
        if (allJoined) {
          const newRoomId = savedGameId.toUpperCase();
          
          // Re-create the Players list with active socket IDs
          const restoredPlayers = lobby.originalPlayers.map((p: any) => {
            if (p.isBot) {
              return {
                id: p.id,
                username: p.username,
                isBot: true,
                ready: true,
              };
            } else {
              return {
                id: p.id,
                username: p.username,
                isBot: false,
                socketId: lobby.sockets[p.username] || undefined,
                ready: true,
              };
            }
          });
          
          // Recreate the active room in memory
          const restoredRoom: Room = {
            id: newRoomId,
            mode: lobby.mode as any,
            status: lobby.status as any,
            players: restoredPlayers,
            gameState: lobby.gameState,
            winnerUsername: null,
            createdAt: new Date(),
            restoredFromSavedGameId: savedGameId,
            saveVotes: {}
          };

          // Defensive normalization of loaded game state
          if (restoredRoom.gameState) {
            const gs = restoredRoom.gameState;
            if (!gs.scores) gs.scores = {};
            if (!gs.roundScores) gs.roundScores = {};
            if (!gs.roundMarriages) gs.roundMarriages = {};
            if (!gs.hands) gs.hands = {};
            if (!gs.hasUsedBomb) gs.hasUsedBomb = {};

            restoredPlayers.forEach((p: any) => {
              if (gs.scores[p.username] === undefined) {
                gs.scores[p.username] = 0;
              } else {
                gs.scores[p.username] = Number(gs.scores[p.username]) || 0;
              }
              if (gs.roundScores[p.username] === undefined) {
                gs.roundScores[p.username] = 0;
              } else {
                gs.roundScores[p.username] = Number(gs.roundScores[p.username]) || 0;
              }
              if (gs.roundMarriages[p.username] === undefined) {
                gs.roundMarriages[p.username] = [];
              }
              if (gs.hands[p.username] === undefined) {
                gs.hands[p.username] = [];
              }
              if (gs.hasUsedBomb[p.username] === undefined) {
                gs.hasUsedBomb[p.username] = false;
              }
            });
          }
          
          // Initialize saveVotes such that bots have true, and humans have false
          restoredRoom.players.forEach((p) => {
            restoredRoom.saveVotes![p.username] = p.isBot ? true : false;
          });
          
          rooms[newRoomId] = restoredRoom;
          
          // Make all active human sockets in the lobby join the socket.io room for the restored game
          restoredPlayers.forEach((p) => {
            if (!p.isBot && p.socketId) {
              const activeSocket = io.sockets.sockets.get(p.socketId);
              if (activeSocket) {
                activeSocket.join(newRoomId);
              }
            }
          });
          
          // Notify lobby players that the game has been resumed and they should redirect/load the table
          io.to(`resume_lobby_${savedGameId}`).emit("game:resumed", { roomId: newRoomId });
          
          // Clean up the resume lobby from memory
          delete resumeLobbies[savedGameId];
          
          // Log start
          logToRoom(newRoomId, `🔄 Gra została pomyślnie wznowiona ze stanu zapisu!`);
          
          // Emit room state
          emitRoomState(restoredRoom);
          
          // Check if current turn is bot (e.g. if we resumed in the middle of a bot's turn)
          setTimeout(() => {
            checkAndRunBotAction(restoredRoom);
          }, 1500);
        }
      } catch (err) {
        console.error("Error joining resume lobby:", err);
        socket.emit("room:error", "Błąd dołączania do poczekalni wznowienia gry.");
      }
    });

    socket.on("game:resume_leave", ({ savedGameId }: { savedGameId: string }) => {
      socket.leave(`resume_lobby_${savedGameId}`);
      const lobby = resumeLobbies[savedGameId];
      if (lobby) {
        lobby.joinedPlayers.delete(username);
        delete lobby.sockets[username];
        
        const hasHumans = lobby.participants.some(pName => {
          const isBot = lobby.originalPlayers.find((p: any) => p.username === pName)?.isBot;
          return !isBot && lobby.joinedPlayers.has(pName);
        });
        
        if (!hasHumans) {
          delete resumeLobbies[savedGameId];
        } else {
          io.to(`resume_lobby_${savedGameId}`).emit("game:resume_lobby_state", {
            savedGameId,
            participants: lobby.participants,
            joinedPlayers: Array.from(lobby.joinedPlayers),
            mode: lobby.mode,
            status: lobby.status,
          });
        }
      }
    });

    function handleDisconnectOrLeave(roomId: string) {
      const room = rooms[roomId?.toUpperCase()];
      if (!room) return;

      const playerIdx = room.players.findIndex((p) => p.username === username);
      if (playerIdx !== -1) {
        logToRoom(room.id, `${username} opuścił stół.`);

        // Ensure player leaves socket.io room
        socket.leave(room.id);

        if (room.status === "LOBBY") {
          // Just remove
          room.players.splice(playerIdx, 1);
          if (room.players.every((p) => p.isBot)) {
            delete rooms[room.id];
          } else {
            emitRoomState(room);
          }
        } else {
          // If active match and not already finished, mark room as finished
          if (room.status !== "FINISHED") {
            room.status = "FINISHED";
            room.winnerUsername = room.players.find((p) => p.username !== username && !p.isBot)?.username || "Brak";
            logToRoom(room.id, `Gra przerwana z powodu rezygnacji/rozłączenia ${username}.`);

            // Clean up the saved game if this room was restored from one
            if (room.restoredFromSavedGameId) {
              prisma.savedGame.delete({
                where: { id: room.restoredFromSavedGameId }
              }).catch(e => console.error("Error deleting saved game on resignation/leave:", e));
            }
          }
          // Remove the player so they don't receive future state updates of this room
          room.players.splice(playerIdx, 1);

          const humansRemaining = room.players.filter((p) => !p.isBot);
          if (humansRemaining.length === 0) {
            delete rooms[room.id];
          } else {
            emitRoomState(room);
          }
        }
      }
    }
  });
}
