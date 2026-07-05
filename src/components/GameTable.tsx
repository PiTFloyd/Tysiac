// src/components/GameTable.tsx

import React, { useState, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { Room, Card, Player } from "../types";
import { ArrowLeft, Send, Users, Shield, Award, Layers, AlertCircle, Sparkles, Maximize2, Minimize2 } from "lucide-react";

interface GameTableProps {
  socket: Socket;
  roomId: string;
  user: { id: string; username: string };
  onBackToLobby: () => void;
}

const VALUE_RANKS: Record<string, number> = {
  "A": 6,
  "10": 5,
  "K": 4,
  "Q": 3,
  "J": 2,
  "9": 1
};

const SUIT_RANKS: Record<string, number> = {
  "H": 4, // Kier (Hearts)
  "D": 3, // Karo (Diamonds)
  "C": 2, // Trefl (Clubs)
  "S": 1  // Pik (Spades)
};

export default function GameTable({ socket, roomId, user, onBackToLobby }: GameTableProps) {
  const [room, setRoom] = useState<Room | null>(null);
  const [logs, setLogs] = useState<{ message: string; timestamp: string }[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeMelds, setActiveMelds] = useState<Record<string, { points: number; id: string }>>({});
  const [cardSorting, setCardSorting] = useState<'default' | 'value_desc' | 'suit_desc'>('default');
  const [draftDistributions, setDraftDistributions] = useState<Record<string, Card>>({});
  const [isSubmittingDistribution, setIsSubmittingDistribution] = useState(false);

  useEffect(() => {
    if (room?.status !== "DISTRIBUTING") {
      setDraftDistributions({});
    }
  }, [room?.status]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error("Error attempting to enable fullscreen:", err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const touchTimerRef = useRef<Record<string, any>>({});
  const isLongPressRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    return () => {
      // Clean up touch timers on unmount
      Object.values(touchTimerRef.current).forEach((t: any) => clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setIsShiftPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setIsShiftPressed(false);
      }
    };

    const handleBlur = () => {
      setIsShiftPressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // Join room and register socket listeners
  useEffect(() => {
    // 1. Join room and register socket listeners
    socket.emit("room:join", { roomId });

    const handleRoomState = (updatedRoom: Room) => {
      setRoom(updatedRoom);
      setErrorMsg(null);
    };

    const handleRoomError = (error: string) => {
      setErrorMsg(error);
    };

    const handleGameMsg = (msg: { message: string; timestamp: string }) => {
      setLogs((prev) => [...prev, msg].slice(-100));
    };

    const handleGameMeld = ({ username, points }: { username: string; points: number }) => {
      const id = Math.random().toString(36).substring(2, 9);
      setActiveMelds((prev) => ({
        ...prev,
        [username]: { points, id },
      }));

      setTimeout(() => {
        setActiveMelds((prev) => {
          if (prev[username]?.id === id) {
            const copy = { ...prev };
            delete copy[username];
            return copy;
          }
          return prev;
        });
      }, 4500);
    };

    socket.on("room:state", handleRoomState);
    socket.on("room:error", handleRoomError);
    socket.on("game:msg", handleGameMsg);
    socket.on("game:meld", handleGameMeld);

    return () => {
      socket.off("room:state", handleRoomState);
      socket.off("room:error", handleRoomError);
      socket.off("game:msg", handleGameMsg);
      socket.off("game:meld", handleGameMeld);
    };
  }, [socket, roomId]);

  // Derived properties with optional chaining
  const isOwner = room?.players[0]?.username === user.username;
  const isReady = room?.players.find((p) => p.username === user.username)?.ready || false;
  const gameState = room?.gameState;
  const isMyTurn = gameState?.currentTurn === user.username;

  const getSortedHand = React.useCallback(() => {
    if (!gameState?.hand) return [];
    
    // Filter out any cards that are in draftDistributions values
    const assignedCardIds = Object.keys(draftDistributions).map((k) => draftDistributions[k]?.id).filter(Boolean);
    const handCopy = gameState.hand.filter((c) => !assignedCardIds.includes(c.id));
    
    if (cardSorting === 'default') {
      // Unsorted / raw random order as received from the server
      return handCopy;
    } else if (cardSorting === 'value_desc') {
      // Value DESC, Suit DESC
      return handCopy.sort((a, b) => {
        const valDiff = (VALUE_RANKS[b.value] || 0) - (VALUE_RANKS[a.value] || 0);
        if (valDiff !== 0) return valDiff;
        return (SUIT_RANKS[b.suit] || 0) - (SUIT_RANKS[a.suit] || 0);
      });
    } else if (cardSorting === 'suit_desc') {
      // Suit ASC, Value DESC
      return handCopy.sort((a, b) => {
        const suitDiff = (SUIT_RANKS[a.suit] || 0) - (SUIT_RANKS[b.suit] || 0);
        if (suitDiff !== 0) return suitDiff;
        return (VALUE_RANKS[b.value] || 0) - (VALUE_RANKS[a.value] || 0);
      });
    }
    return handCopy;
  }, [gameState?.hand, cardSorting, draftDistributions]);

  // Clear any stale long-press/touch flags when our turn changes or the trick advances
  useEffect(() => {
    isLongPressRef.current = {};
    Object.values(touchTimerRef.current).forEach((t: any) => clearTimeout(t));
    touchTimerRef.current = {};
  }, [isMyTurn, gameState?.currentTrick?.length]);

  // Find left and right opponents relative to current user
  const myIndex = room ? room.players.findIndex((p) => p.username === user.username) : -1;
  const leftOpponent = room && myIndex !== -1 ? room.players[(myIndex + 1) % 3] : null;
  const rightOpponent = room && myIndex !== -1 ? room.players[(myIndex + 2) % 3] : null;

  // Bid actions
  const handleBid = React.useCallback((amount: number) => {
    socket.emit("game:bid", { roomId, bid: amount });
  }, [socket, roomId]);

  const handlePass = React.useCallback(() => {
    socket.emit("game:bid", { roomId, pass: true });
  }, [socket, roomId]);

  // Ready action
  const handleReady = React.useCallback(() => {
    socket.emit("room:ready", { roomId });
  }, [socket, roomId]);

  // Start game action (for room owner)
  const handleStartGame = React.useCallback(() => {
    socket.emit("room:start", { roomId });
  }, [socket, roomId]);

  // Local distribution draft actions
  const handleAssignCardLocal = React.useCallback((targetUsername: string) => {
    if (!selectedCardId || !gameState?.hand) return;
    const card = gameState.hand.find((c) => c.id === selectedCardId);
    if (!card) return;

    // Check if already assigned
    const alreadyAssigned = Object.keys(draftDistributions).some((k) => draftDistributions[k]?.id === card.id);
    if (alreadyAssigned) return;

    setDraftDistributions((prev) => ({
      ...prev,
      [targetUsername]: card
    }));
    setSelectedCardId(null);
  }, [selectedCardId, gameState?.hand, draftDistributions]);

  const handleRemoveCardLocal = React.useCallback((targetUsername: string) => {
    setDraftDistributions((prev) => {
      const next = { ...prev };
      delete next[targetUsername];
      return next;
    });
  }, []);

  const handleConfirmDistribution = React.useCallback(() => {
    const otherPlayers = room?.players.filter((p) => p.username !== user.username) || [];
    if (otherPlayers.length < 2) return;

    const cardA = draftDistributions[otherPlayers[0].username];
    const cardB = draftDistributions[otherPlayers[1].username];

    if (!cardA || !cardB) return;

    setIsSubmittingDistribution(true);

    // Send both sequentially with a tiny delay to ensure proper state processing
    socket.emit("game:distribute", { roomId, cardId: cardA.id, targetUsername: otherPlayers[0].username });
    
    setTimeout(() => {
      socket.emit("game:distribute", { roomId, cardId: cardB.id, targetUsername: otherPlayers[1].username });
      setIsSubmittingDistribution(false);
    }, 80);
  }, [socket, roomId, room?.players, draftDistributions, user.username]);

  const handleIncreaseBid = React.useCallback((newBid: number) => {
    socket.emit("game:increase_bid", { roomId, newBid });
  }, [socket, roomId]);

  const handleBomba = React.useCallback(() => {
    socket.emit("game:bomba", { roomId });
  }, [socket, roomId]);

  const handleCloseSkat = React.useCallback(() => {
    socket.emit("game:take_skat", { roomId });
  }, [socket, roomId]);

  const handleSaveGame = React.useCallback(() => {
    socket.emit("game:save_vote", { roomId });
  }, [socket, roomId]);

  // Play card action
  const handlePlayCard = React.useCallback((cardId: string, wantsMeld: boolean = false) => {
    if (!room || room.status !== "PLAYING" || !isMyTurn) return;
    socket.emit("game:play_card", { roomId, cardId, declareMarriage: wantsMeld });
  }, [socket, roomId, room?.status, isMyTurn]);

  const cardBelongsToMeld = React.useCallback((card: Card) => {
    if (!gameState || !room || room.status !== "PLAYING" || !isMyTurn) return false;
    // Can only meld if we are leading the trick
    if (gameState.currentTrick.length > 0) return false;
    if (card.value !== "K" && card.value !== "Q") return false;

    const suit = card.suit;
    const hasK = gameState.hand.some((c) => c.suit === suit && c.value === "K");
    const hasQ = gameState.hand.some((c) => c.suit === suit && c.value === "Q");
    return hasK && hasQ;
  }, [gameState, room?.status, isMyTurn]);

  const handleTouchStart = React.useCallback((card: Card, e?: React.TouchEvent | React.MouseEvent) => {
    if (!cardBelongsToMeld(card)) return;

    if (e && e.type === "mousedown" && (e as React.MouseEvent).button !== 0) return;

    isLongPressRef.current[card.id] = false;

    if (touchTimerRef.current[card.id]) {
      clearTimeout(touchTimerRef.current[card.id]);
    }

    touchTimerRef.current[card.id] = setTimeout(() => {
      isLongPressRef.current[card.id] = true;
      handlePlayCard(card.id, true);
    }, 600);
  }, [cardBelongsToMeld, handlePlayCard]);

  const handleTouchEnd = React.useCallback((card: Card, e?: React.TouchEvent | React.MouseEvent) => {
    if (touchTimerRef.current[card.id]) {
      clearTimeout(touchTimerRef.current[card.id]);
      delete touchTimerRef.current[card.id];
    }
    if (isLongPressRef.current[card.id]) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, []);

  // Check if player has King and Queen of the same suit in hand (Meldunek check)
  const canMeldAny = React.useCallback(() => {
    if (!gameState || !room || room.status !== "PLAYING" || !isMyTurn) return false;
    // Can only meld if we are leading the trick
    if (gameState.currentTrick.length > 0) return false;

    const suits: Card["suit"][] = ["H", "D", "C", "S"];
    return suits.some((suit) => {
      const hasK = gameState.hand.some((c) => c.suit === suit && c.value === "K");
      const hasQ = gameState.hand.some((c) => c.suit === suit && c.value === "Q");
      return hasK && hasQ;
    });
  }, [gameState, room?.status, isMyTurn]);

  if (!room) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 font-sans text-gray-100 p-6">
        <div className="text-center space-y-4 max-w-sm">
          {errorMsg ? (
            <>
              <div className="w-12 h-12 bg-red-950/40 border border-red-500/40 text-red-400 rounded-full flex items-center justify-center mx-auto mb-2 shadow-lg animate-bounce">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h2 className="text-sm font-bold text-red-400 font-mono uppercase tracking-widest">Błąd połączenia</h2>
              <p className="text-xs text-slate-400 leading-relaxed">{errorMsg}</p>
              <button
                onClick={onBackToLobby}
                className="mt-4 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer shadow-lg hover:shadow-emerald-500/20"
              >
                Powrót do lobby
              </button>
            </>
          ) : (
            <>
              <div className="w-12 h-12 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-sm font-mono text-emerald-400 tracking-wider">Łączenie ze stołem karcianym {roomId}...</p>
              <button
                onClick={onBackToLobby}
                className="mt-4 px-4 py-2 bg-gray-900 border border-teal-900 hover:border-red-500/30 text-teal-500 hover:text-red-400 text-xs uppercase rounded-lg transition-all cursor-pointer"
              >
                Anuluj
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col font-sans text-slate-200 overflow-hidden select-none velvet-table relative">
      {/* Active turn bottom glow */}
      {isMyTurn && (
        <div 
          className="absolute bottom-0 left-0 right-0 w-full h-[200px] pointer-events-none z-0 animate-pulse"
          style={{ backgroundImage: "radial-gradient(ellipse at bottom, rgba(16, 185, 129, 0.22) 0%, rgba(16, 185, 129, 0) 70%)" }}
        />
      )}

      {/* Top Navigation Bar */}
      <nav className="h-16 flex items-center justify-between px-6 sm:px-8 bg-gray-900/80 border-b border-teal-900/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-500 rounded flex items-center justify-center font-bold text-gray-950 text-xl shrink-0">T</div>
          <div className="hidden sm:block">
            <h1 className="text-lg font-bold tracking-tight text-emerald-400 mint-glow uppercase">TYSIĄC ONLINE</h1>
            <p className="text-[10px] uppercase tracking-widest text-teal-600 font-semibold">Professional Card League v2.4</p>
          </div>
          <button
            onClick={onBackToLobby}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-950 hover:bg-red-950/40 border border-teal-900/40 hover:border-red-500/30 text-teal-500 hover:text-red-400 text-[10px] font-bold uppercase rounded-lg transition-all cursor-pointer shadow-md active:scale-95 shrink-0"
          >
            <ArrowLeft className="h-3 w-3" />
            Rezygnuj
          </button>
          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-950 hover:bg-teal-900/40 border border-teal-900/40 hover:border-emerald-500/30 text-teal-500 hover:text-emerald-400 text-[10px] font-bold uppercase rounded-lg transition-all cursor-pointer shadow-md active:scale-95 shrink-0"
            title={isFullscreen ? "Wyjdź z pełnego ekranu" : "Pełny ekran"}
          >
            {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            {isFullscreen ? "Okno" : "Pełny Ekran"}
          </button>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-teal-600 font-bold uppercase">Kod pokoju</span>
            <span className="text-sm font-mono text-emerald-400 font-bold">#{room.id}</span>
          </div>
          <div className="h-8 w-[1px] bg-teal-900/50"></div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs font-bold text-slate-200">{user.username}</p>
              <p className="text-[10px] text-teal-500 uppercase tracking-wider font-mono">ID: #{user.id.slice(0, 4)}</p>
            </div>
            <div className="w-10 h-10 rounded-full border-2 border-emerald-500 bg-gray-800 flex items-center justify-center font-bold text-xs">
              {user.username.slice(0, 2).toUpperCase()}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Game Layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 overflow-hidden relative z-10">
        {errorMsg && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-red-950/90 border border-red-500/40 text-red-200 text-xs rounded-xl flex items-center gap-2 shadow-xl animate-bounce">
            <AlertCircle className="h-4 w-4" /> {errorMsg}
          </div>
        )}

        {/* Left Sidebar: Scoreboard & Current Bid (span 3) */}
        <aside className="lg:col-span-3 flex flex-col gap-4">
          {/* Scoreboard */}
          <div className={`bg-gray-900/50 neon-border rounded-2xl p-4 flex flex-col transition-all duration-300 ${
            gameState && (room.status === "PLAYING" || room.status === "DISTRIBUTING" || room.status === "SKAT_REVEAL") && gameState.skatWinner === user.username
              ? "h-[310px]" 
              : "h-[250px]"
          }`}>
            <h2 className="text-[11px] uppercase tracking-widest text-teal-500 font-bold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-teal-500"></span> Wyniki meczu (Tabela)
            </h2>
            <div className="flex-1 overflow-y-auto pr-1">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-teal-600 text-[10px] uppercase font-bold border-b border-teal-900/40">
                    <th className="py-2">Gracz</th>
                    <th className="py-2 text-right">Razem</th>
                    <th className="py-2 text-right">Runda</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {room.players.map((p) => {
                    const totalScore = gameState?.scores[p.username] ?? 0;
                    const roundScore = gameState?.roundScores[p.username] ?? 0;
                    const isMe = p.username === user.username;
                    const isTurn = gameState?.currentTurn === p.username;

                    const dealerIndex = gameState?.dealer ? room.players.findIndex((pl) => pl.username === gameState.dealer) : -1;
                    const forcedBidderIndex = dealerIndex !== -1 ? (dealerIndex + 1) % 3 : -1;
                    const isForcedBidder = forcedBidderIndex !== -1 && room.players[forcedBidderIndex]?.username === p.username;

                    return (
                      <tr
                        key={p.username}
                        className={`score-row transition-all ${
                          isTurn ? "bg-teal-950/10" : ""
                        }`}
                      >
                        <td className={`py-2 px-1 flex items-center gap-1.5 ${isForcedBidder ? "text-emerald-400 font-bold" : "text-slate-300"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isTurn ? "bg-emerald-400 animate-pulse" : "bg-teal-900"}`}></span>
                          <span 
                            className="truncate max-w-[140px]"
                            title={isForcedBidder ? "Przymusowa licytacja 100 punktów w tej rundzie" : undefined}
                          >
                            {p.username.slice(0, 30)}
                          </span>
                          {gameState?.hasUsedBomb?.[p.username] && (
                            <span className="text-xs shrink-0 cursor-help" title="Bomba została już wykorzystana w tym meczu">💣</span>
                          )}
                        </td>
                        <td className="py-2 text-right font-bold text-emerald-400">{totalScore}</td>
                        <td className="py-2 text-right text-slate-500">+{roundScore}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {gameState && (
              room.status === "DISTRIBUTING" ||
              room.status === "SKAT_REVEAL" ||
              (room.status === "PLAYING" && (gameState.tricksCount ?? 0) === 0 && (gameState.currentTrick?.length ?? 0) === 0)
            ) && gameState.skatWinner === user.username && !gameState.hasUsedBomb?.[user.username] && (
              <button
                onClick={handleBomba}
                className="mt-3 w-full py-2 bg-red-950/40 hover:bg-red-900/40 border border-red-500/50 text-red-400 rounded-lg text-xs font-extrabold uppercase tracking-wider transition-all duration-200 cursor-pointer shadow-lg hover:shadow-red-500/10 flex items-center justify-center active:scale-[0.98]"
              >
                BOMBA
              </button>
            )}

            {gameState && room && room.status !== "FINISHED" && (
              <button
                onClick={handleSaveGame}
                disabled={room.saveVotes?.[user.username]}
                className={`mt-2 w-full py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer flex items-center justify-between px-3 border ${
                  room.saveVotes?.[user.username]
                    ? "bg-teal-950/20 border-teal-900/50 text-teal-600 cursor-not-allowed"
                    : "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 hover:border-emerald-500/50 text-emerald-400 active:scale-[0.98]"
                }`}
              >
                <span>{room.saveVotes?.[user.username] ? "✓ OCZEKIWANIE" : "💾 ZAPISZ GRĘ"}</span>
                <span className="text-[10px] font-mono font-bold opacity-90 bg-emerald-500/20 px-1.5 py-0.5 rounded text-emerald-300">
                  {Object.values(room.saveVotes || {}).filter(Boolean).length}/{room.players.length}
                </span>
              </button>
            )}
          </div>

          {/* Current Bid info */}
          <div className="h-28 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-4 flex flex-col justify-center">
            <p className="text-[10px] uppercase font-bold text-emerald-400 mb-1">Bieżąca Licytacja</p>
            <p className="text-2xl font-black text-white font-mono">
              {gameState?.bidding ? gameState.bidding.highestBid : 100}{" "}
              <span className="text-xs text-emerald-500 font-normal">
                od {gameState?.bidding.highestBidder || "wymuszone 100"}
              </span>
            </p>
            <p className="text-[10px] text-teal-600 mt-2 italic font-mono">
              {isMyTurn ? "» Twój ruch teraz!" : `» Ruch gracza: ${gameState?.currentTurn || "czekanie"}`}
            </p>
          </div>

        </aside>

        {/* Center: Game Table (span 6) */}
        <div className="lg:col-span-6 relative bg-gray-900/20 rounded-[80px] border border-teal-900/20 flex flex-col items-center justify-between py-8 px-4 min-h-[500px]">
          {/* Radial Table Green Glow Center */}
          <div className="absolute inset-0 bg-radial from-emerald-950/20 via-transparent to-transparent opacity-60 pointer-events-none"></div>

          {/* Top Opponents Row */}
          <div className="flex justify-around w-full max-w-lg z-10 gap-4">
            {/* Left opponent (Opponent A) */}
            {leftOpponent && (
              <div className={`p-3 bg-gray-950/95 border rounded-2xl flex flex-col items-center gap-1 text-center shadow-lg transition-all relative ${
                gameState?.currentTurn === leftOpponent.username ? "border-emerald-500/60 active-player" : "border-teal-900/30"
              }`}>
                {activeMelds[leftOpponent.username] && (
                  <div className="absolute top-full mt-3.5 left-1/2 -translate-x-1/2 z-30 bg-slate-950/95 border border-emerald-500/50 px-5 py-2.5 rounded-[18px] shadow-[0_0_18px_rgba(16,185,129,0.4)] text-[15px] font-mono font-bold text-emerald-400 uppercase tracking-wider whitespace-nowrap meld-bubble flex items-center gap-2">
                    <span>💬 Melduję {activeMelds[leftOpponent.username].points}</span>
                    <span className={activeMelds[leftOpponent.username].points === 100 ? "text-red-500 font-extrabold" : activeMelds[leftOpponent.username].points === 80 ? "text-orange-500 font-extrabold" : activeMelds[leftOpponent.username].points === 60 ? "text-emerald-400 font-extrabold" : "text-blue-400 font-extrabold"}>
                      {activeMelds[leftOpponent.username].points === 100 ? "♥" : activeMelds[leftOpponent.username].points === 80 ? "♦" : activeMelds[leftOpponent.username].points === 60 ? "♣" : "♠"}
                    </span>
                    <span>!</span>
                    {/* Tail pointing UP */}
                    <div className="absolute top-[-8px] left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-950 border-t border-l border-emerald-500/50 rotate-45" />
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  <span className="font-bold text-xs text-slate-200 truncate max-w-[90px]">{leftOpponent.username}</span>
                  {leftOpponent.isBot && <span className="text-[8px] bg-teal-950 border border-teal-900/40 text-teal-400 px-1 py-0.5 rounded font-mono">BOT</span>}
                  {gameState?.hasUsedBomb?.[leftOpponent.username] && (
                    <span className="text-[10px] select-none" title="Bomba została już wykorzystana w tym meczu">💣</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex gap-3">
                  <span>Karty: {leftOpponent.cardCount ?? 0}</span>
                  <span className="text-emerald-400">{gameState?.scores[leftOpponent.username] ?? 0} pkt</span>
                </div>
              </div>
            )}

            {/* Right opponent (Opponent B) */}
            {rightOpponent && (
              <div className={`p-3 bg-gray-950/95 border rounded-2xl flex flex-col items-center gap-1 text-center shadow-lg transition-all relative ${
                gameState?.currentTurn === rightOpponent.username ? "border-emerald-500/60 active-player" : "border-teal-900/30"
              }`}>
                {activeMelds[rightOpponent.username] && (
                  <div className="absolute top-full mt-3.5 left-1/2 -translate-x-1/2 z-30 bg-slate-950/95 border border-emerald-500/50 px-5 py-2.5 rounded-[18px] shadow-[0_0_18px_rgba(16,185,129,0.4)] text-[15px] font-mono font-bold text-emerald-400 uppercase tracking-wider whitespace-nowrap meld-bubble flex items-center gap-2">
                    <span>💬 Melduję {activeMelds[rightOpponent.username].points}</span>
                    <span className={activeMelds[rightOpponent.username].points === 100 ? "text-red-500 font-extrabold" : activeMelds[rightOpponent.username].points === 80 ? "text-orange-500 font-extrabold" : activeMelds[rightOpponent.username].points === 60 ? "text-emerald-400 font-extrabold" : "text-blue-400 font-extrabold"}>
                      {activeMelds[rightOpponent.username].points === 100 ? "♥" : activeMelds[rightOpponent.username].points === 80 ? "♦" : activeMelds[rightOpponent.username].points === 60 ? "♣" : "♠"}
                    </span>
                    <span>!</span>
                    {/* Tail pointing UP */}
                    <div className="absolute top-[-8px] left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-950 border-t border-l border-emerald-500/50 rotate-45" />
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                  <span className="font-bold text-xs text-slate-200 truncate max-w-[90px]">{rightOpponent.username}</span>
                  {rightOpponent.isBot && <span className="text-[8px] bg-teal-950 border border-teal-900/40 text-teal-400 px-1 py-0.5 rounded font-mono">BOT</span>}
                  {gameState?.hasUsedBomb?.[rightOpponent.username] && (
                    <span className="text-[10px] select-none" title="Bomba została już wykorzystana w tym meczu">💣</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 font-mono flex gap-3">
                  <span>Karty: {rightOpponent.cardCount ?? 0}</span>
                  <span className="text-emerald-400">{gameState?.scores[rightOpponent.username] ?? 0} pkt</span>
                </div>
              </div>
            )}
          </div>

          {/* Playing Area (Trick Circle) */}
          <div className="relative w-64 h-64 border border-teal-500/10 rounded-full flex items-center justify-center bg-teal-500/5 my-4">
            <div className="absolute text-[10px] font-bold text-teal-800 uppercase tracking-widest font-mono select-none">
              {room.status === "PLAYING" ? `Lewa #${(gameState?.currentTrick?.length || 0) + 1}` : "Tysiąc Arena"}
            </div>

            {/* LOBBY PHASE OVERLAY */}
            {room.status === "LOBBY" && (
              <div className="absolute text-center p-5 bg-gray-950 border border-teal-900 rounded-2xl w-[280px] sm:w-[320px] shadow-2xl z-20 neon-border flex flex-col gap-3.5">
                <div className="flex flex-col items-center gap-1 border-b border-teal-900/30 pb-2.5">
                  <Users className="h-5 w-5 text-emerald-400 mb-0.5" />
                  <h3 className="font-extrabold text-xs text-white uppercase tracking-wider">Poczekalnia gry</h3>
                  <span className="text-[9px] font-mono text-emerald-500/80 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    Pokój #{room.id}
                  </span>
                </div>

                <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                  {room.players.map((pl) => (
                    <div key={pl.username} className="flex items-center justify-between text-[11px] bg-gray-900/60 border border-teal-950/40 rounded-lg px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5 truncate max-w-[130px]">
                        <span className={`w-1.5 h-1.5 rounded-full ${pl.ready ? "bg-emerald-400" : "bg-gray-600 animate-pulse"}`}></span>
                        <span className="font-bold text-slate-200 truncate">{pl.username}</span>
                        {pl.isBot && <span className="text-[8px] bg-teal-950 border border-teal-900/40 text-teal-400 px-1 py-0.5 rounded font-mono shrink-0">BOT</span>}
                        {room.players[0]?.username === pl.username && <span className="text-[8px] bg-emerald-950 border border-emerald-900/40 text-emerald-400 px-1 py-0.5 rounded font-mono shrink-0">LIDER</span>}
                      </div>
                      <div>
                        {pl.ready ? (
                          <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wide">✓ Gotowy</span>
                        ) : (
                          <span className="text-[9px] font-mono text-slate-500 italic">Oczekuje</span>
                        )}
                      </div>
                    </div>
                  ))}

                  {room.players.length < 3 && Array.from({ length: 3 - room.players.length }).map((_, i) => (
                    <div key={`empty-${i}`} className="flex items-center justify-between text-[11px] bg-gray-900/20 border border-dashed border-teal-900/20 rounded-lg px-2.5 py-1.5">
                      <span className="text-[10px] font-mono text-teal-800/60 italic">Wolne miejsce...</span>
                      <span className="text-[8px] uppercase tracking-wider text-teal-800/40 animate-pulse">Czekanie</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 border-t border-teal-900/30 pt-2.5">
                  {isReady ? (
                    <div className="py-2 bg-emerald-950/40 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold font-mono uppercase rounded-lg tracking-wider">
                      ✓ Jesteś gotowy
                    </div>
                  ) : (
                    <button
                      onClick={handleReady}
                      className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-extrabold text-[10px] uppercase rounded-lg cursor-pointer transition-all active:scale-[0.98] shadow-md hover:shadow-emerald-500/10 tracking-wider"
                    >
                      Zgłoś Gotowość
                    </button>
                  )}

                  {isOwner && (
                    <button
                      onClick={handleStartGame}
                      className="w-full py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-gray-950 font-black text-[10px] uppercase rounded-lg cursor-pointer transition-all shadow-lg hover:shadow-emerald-500/20 flex items-center justify-center gap-1.5 tracking-wider active:scale-[0.98]"
                    >
                      Rozpocznij Grę {room.players.length < 3 && "z Botami"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* BIDDING OVERLAY */}
            {room.status === "BIDDING" && gameState && (
              <div className="absolute w-64 h-64 flex flex-col justify-center items-center p-5 bg-gray-950 border border-teal-900 rounded-2xl shadow-2xl z-20 neon-border text-center">
                <Layers className="h-9 w-9 text-emerald-400 mb-1 animate-bounce" />
                <span className="text-[10px] font-mono text-teal-500 uppercase tracking-widest block mb-0.5">Licytacja</span>
                <p className="text-xs font-bold text-white mb-4">
                  Wysokość: <span className="text-yellow-400 font-mono text-base font-black">{gameState.bidding.highestBid} pkt</span>
                </p>

                {isMyTurn ? (
                  <div className="flex gap-2 w-full mt-1">
                    <button
                      onClick={() => handleBid(gameState.bidding.minBid)}
                      className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-[11px] uppercase rounded-lg cursor-pointer transition-all active:scale-[0.97]"
                    >
                      Licytuj {gameState.bidding.minBid}
                    </button>
                    <button
                      onClick={handlePass}
                      className="flex-1 py-2 bg-gray-900 border border-red-500/25 text-red-400 hover:bg-red-950/20 text-[11px] uppercase rounded-lg cursor-pointer transition-all active:scale-[0.97]"
                    >
                      Pas
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] font-mono text-teal-600 animate-pulse bg-teal-950/20 px-3 py-1.5 border border-teal-950/40 rounded-lg">
                    Ruch: {gameState.currentTurn}
                  </span>
                )}
              </div>
            )}

            {/* SKAT REVEAL */}
            {room.status === "SKAT_REVEAL" && gameState && (() => {
              const dealerIdx = gameState?.dealer ? room.players.findIndex((pl) => pl.username === gameState.dealer) : -1;
              const forcedBidderIdx = dealerIdx !== -1 ? (dealerIdx + 1) % 3 : -1;
              const forcedBidderName = forcedBidderIdx !== -1 ? room.players[forcedBidderIdx]?.username : null;
              const isSkatWinnerForcedBidder = gameState.skatWinner === forcedBidderName;
              const isSkatHidden = isSkatWinnerForcedBidder && gameState.bidding.highestBid === 100 && gameState.skatWinner !== user.username;

              return (
                <div className="absolute w-[340px] min-h-[250px] flex flex-col justify-center items-center p-5 bg-gray-950 border border-teal-900 rounded-2xl shadow-2xl z-20 neon-border text-center relative">
                  {/* Close button 'x' available to the skat winner (or any player if skat winner is a bot) */}
                  {(() => {
                    const winner = room.players.find((p) => p.username === gameState.skatWinner);
                    const isWinnerBot = winner ? winner.isBot : false;
                    const canClose = gameState.skatWinner === user.username || isWinnerBot;
                    if (canClose) {
                      return (
                        <button
                          onClick={handleCloseSkat}
                          className="absolute top-2.5 right-2.5 w-6 h-6 flex items-center justify-center rounded-full bg-gray-900 border border-teal-900/60 hover:border-emerald-500 hover:text-emerald-400 text-slate-400 font-extrabold text-xs cursor-pointer transition-all active:scale-95"
                          title="Zamknij podgląd i pobierz musik"
                        >
                          ✕
                        </button>
                      );
                    }
                    return null;
                  })()}

                  <span className="text-[11px] font-mono text-yellow-400 uppercase tracking-widest block mb-1">Musik (Skat)</span>
                  <p className="text-xs text-slate-200 font-bold mb-4 leading-normal">
                    {gameState.skatWinner === user.username ? "Wygrałeś licytację i zgarniasz musik!" : `${gameState.skatWinner} zgarnia musik!`}
                  </p>
                  
                  <div className="flex gap-2.5 justify-center mb-1">
                    {isSkatHidden ? (
                      <>
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="w-[60px] h-[92px] bg-gradient-to-br from-teal-950 to-gray-900 border border-teal-500/30 rounded-xl flex flex-col items-center justify-center shadow-md animate-pulse">
                            <span className="text-teal-500 text-xl">❓</span>
                          </div>
                        ))}
                      </>
                    ) : (
                      gameState.skat.map((c) => {
                        const suitInfo = getCardSuitDetails(c.suit);
                        return (
                          <div key={c.id} className="w-[60px] h-[92px] bg-gray-900 border-2 border-emerald-500/30 rounded-xl flex flex-col justify-between p-1.5 shadow-md select-none">
                            <span className={`text-xs font-black text-left self-start leading-none ${suitInfo?.color}`}>{c.value}</span>
                            <span className={`text-xl text-center leading-none ${suitInfo?.color}`}>{suitInfo?.symbol}</span>
                            <span className={`text-xs font-black text-right self-end rotate-180 leading-none ${suitInfo?.color}`}>{c.value}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                  
                  {isSkatHidden && (
                    <p className="text-[9px] text-teal-500 mt-2 italic leading-tight">Licytacja przymusowa – musik ukryty przed innymi</p>
                  )}

                  <div className="w-full mt-3">
                    {gameState.skatWinner === user.username ? (
                      <button
                        onClick={handleCloseSkat}
                        className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-black text-xs uppercase rounded-xl cursor-pointer transition-all active:scale-[0.97] shadow-[0_0_15px_rgba(16,185,129,0.25)]"
                      >
                        Pobierz musik & Rozdaj karty
                      </button>
                    ) : (
                      <span className="text-[10px] font-mono text-teal-500 animate-pulse bg-teal-950/15 px-3 py-1.5 border border-teal-950/30 rounded-lg inline-block">
                        Czekaj na pobranie musika przez licytatora...
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* DISTRIBUTING */}
            {room.status === "DISTRIBUTING" && gameState && (
              <div className="absolute w-72 min-h-[320px] flex flex-col justify-between items-center p-4 bg-gray-950 border border-teal-900 rounded-2xl shadow-2xl z-20 neon-border text-center">
                <div className="w-full">
                  <span className="text-[10px] font-mono text-teal-500 uppercase tracking-widest block mb-0.5">Oddaj Karty</span>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {gameState.skatWinner === user.username
                      ? "Przypisz po jednej karcie każdemu z rywali."
                      : `Licytator (${gameState.skatWinner}) rozdaje karty...`}
                  </p>
                </div>

                {gameState.skatWinner === user.username ? (
                  <div className="w-full flex-1 flex flex-col justify-between gap-3 mt-3">
                    {/* Contract Box */}
                    <div className="bg-teal-950/20 p-2 border border-teal-900/40 rounded-xl">
                      <span className="text-[9px] font-mono text-teal-500 uppercase tracking-widest block text-center mb-1">Deklaracja kontraktu</span>
                      <div className="flex items-center justify-between bg-gray-900 border border-teal-900/60 rounded-lg p-0.5 max-w-[180px] mx-auto shadow-inner">
                        <button
                          disabled={gameState.bidding.highestBid <= (gameState.bidding.originalBid || 100)}
                          onClick={() => handleIncreaseBid(gameState.bidding.highestBid - 10)}
                          className="w-7 h-7 flex items-center justify-center text-xs font-bold text-slate-300 hover:text-emerald-400 disabled:opacity-30 disabled:hover:text-slate-300 rounded transition-colors cursor-pointer select-none"
                        >
                          −
                        </button>
                        <span className="text-xs font-mono font-bold text-emerald-400 px-1 min-w-[70px] text-center">
                          {gameState.bidding.highestBid} pkt
                        </span>
                        <button
                          disabled={gameState.bidding.highestBid >= 300}
                          onClick={() => handleIncreaseBid(gameState.bidding.highestBid + 10)}
                          className="w-7 h-7 flex items-center justify-center text-xs font-bold text-slate-300 hover:text-emerald-400 disabled:opacity-30 disabled:hover:text-slate-300 rounded transition-colors cursor-pointer select-none"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Opponent Assignments */}
                    <div className="flex flex-col gap-2 w-full text-left">
                      <span className="text-[9px] font-mono text-teal-500 uppercase tracking-widest block text-center border-t border-teal-900/20 pt-2 mb-1">
                        Rozdział kart
                      </span>
                      
                      <div className="flex flex-col gap-1.5 w-full">
                        {room.players
                          .filter((p) => p.username !== user.username)
                          .map((p) => {
                            const assignedCard = draftDistributions[p.username];
                            const suitInfo = assignedCard ? getCardSuitDetails(assignedCard.suit) : null;
                            
                            return (
                              <div key={p.username} className="w-full">
                                {assignedCard ? (
                                  <button
                                    onClick={() => handleRemoveCardLocal(p.username)}
                                    className="w-full flex items-center justify-between px-3 py-1.5 bg-teal-950/30 border border-amber-500/40 hover:border-amber-400 rounded-lg text-xs font-bold text-slate-200 cursor-pointer group transition-all"
                                    title="Kliknij, aby wycofać kartę"
                                  >
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className="text-slate-400 font-mono font-medium group-hover:text-amber-400 transition-colors">
                                        {p.username.slice(0, 8)}:
                                      </span>
                                      <span className={`font-black font-mono flex items-center gap-0.5 ${suitInfo?.color}`}>
                                        {assignedCard.value}{suitInfo?.symbol}
                                      </span>
                                    </span>
                                    <span className="text-[9px] text-amber-500 uppercase font-mono tracking-wider opacity-60 group-hover:opacity-100 transition-opacity">
                                      Cofnij
                                    </span>
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      if (selectedCardId) {
                                        handleAssignCardLocal(p.username);
                                      }
                                    }}
                                    disabled={!selectedCardId}
                                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                                      selectedCardId
                                        ? 'bg-gray-900 border-teal-500 hover:border-emerald-400 text-slate-200 cursor-pointer active:scale-[0.98]'
                                        : 'bg-gray-900/40 border-slate-800 text-slate-500 cursor-not-allowed'
                                    }`}
                                    title={selectedCardId ? "Przypisz zaznaczoną kartę" : "Najpierw zaznacz kartę ze swojej ręki"}
                                  >
                                    <span className="truncate text-slate-400">
                                      {p.username.slice(0, 8)}
                                    </span>
                                    <span className="text-[9px] font-mono uppercase tracking-wider text-teal-600 animate-pulse">
                                      {selectedCardId ? "Daj kartę" : "Wybierz kartę"}
                                    </span>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>

                    {/* Confirm Button / Selection Helper */}
                    <div className="w-full mt-1">
                      {Object.keys(draftDistributions).length === 2 ? (
                        <button
                          disabled={isSubmittingDistribution}
                          onClick={handleConfirmDistribution}
                          className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-800 disabled:text-slate-600 text-gray-950 font-black text-xs uppercase rounded-xl cursor-pointer transition-all active:scale-[0.97] shadow-[0_0_15px_rgba(16,185,129,0.25)] flex items-center justify-center gap-2"
                        >
                          {isSubmittingDistribution ? (
                            <span className="animate-spin w-3.5 h-3.5 border-2 border-gray-950 border-t-transparent rounded-full" />
                          ) : null}
                          Potwierdź rozdanie
                        </button>
                      ) : (
                        <p className="text-[9px] text-yellow-500 font-bold animate-pulse text-center">
                          {!selectedCardId 
                            ? "Zaznacz kartę na swojej ręce i przypisz ją rywalowi." 
                            : "Wybierz rywala, aby przypisać mu zaznaczoną kartę."}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center mt-4">
                    <span className="text-[10px] font-mono text-teal-600 animate-pulse bg-teal-950/10 px-3 py-1.5 border border-teal-950/20 rounded-lg">Czekaj na rozdanie...</span>
                  </div>
                )}
              </div>
            )}

            {/* ACTIVE PLAY TRICK CARD PLACEMENTS */}
            {room.status === "PLAYING" && gameState && (
              <>
                {gameState.currentTrick.map((play) => {
                  const suitInfo = getCardSuitDetails(play.card.suit);
                  // Dynamic placement
                  const playerPos = play.username === user.username
                    ? "absolute bottom-4 z-10 scale-105"
                    : play.username === leftOpponent?.username
                    ? "absolute left-4 rotate-12"
                    : "absolute right-4 -rotate-12";

                  return (
                    <div
                      key={play.card.id}
                      className={`${playerPos} playing-card`}
                      style={{ width: "65px", height: "100px", padding: "5px" }}
                    >
                      <div className="flex flex-col h-full justify-between select-none">
                        <span className={`text-[12px] font-mono font-bold leading-none text-left self-start ${suitInfo?.color}`}>{play.card.value}</span>
                        <span className={`text-xl text-center leading-none ${suitInfo?.color}`}>{suitInfo?.symbol}</span>
                        <span className={`text-[12px] font-mono font-bold text-right leading-none self-end ${suitInfo?.color}`}>{play.card.value}</span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* FINISHED SCREEN */}
            {room.status === "FINISHED" && (
              <div className="absolute w-64 h-64 flex flex-col justify-center items-center p-5 bg-gray-950 border border-teal-900 rounded-2xl shadow-2xl z-20 neon-border text-center">
                <Award className="h-10 w-10 text-yellow-500 mx-auto mb-2 animate-bounce" />
                <h3 className="font-bold text-sm text-white mb-4">Zwycięzca: {room.winnerUsername}</h3>
                <button
                  onClick={onBackToLobby}
                  className="mt-2 w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-xs uppercase rounded-lg cursor-pointer transition-all active:scale-[0.97]"
                >
                  Do lobby
                </button>
              </div>
            )}
          </div>

          {/* User's Hand Cards and Controls Area */}
          <div className="w-full flex flex-col items-center gap-3 relative">
            {/* Active Hand Container */}
            <div className="flex gap-1.5 -mb-6 justify-center flex-wrap max-w-full">
              {gameState?.hand && gameState.hand.length > 0 ? (
                getSortedHand().map((c) => {
                  const isSelected = selectedCardId === c.id;
                  const isFromSkat = room.status === "DISTRIBUTING" && (gameState.skatCardIds?.includes(c.id) || false);
                  return (
                    <PlayingCardButton
                      key={c.id}
                      card={c}
                      isSelected={isSelected}
                      isMyTurn={isMyTurn}
                      roomStatus={room.status}
                      isShiftPressed={isShiftPressed}
                      skatWinner={gameState.skatWinner}
                      username={user.username}
                      onTouchStart={handleTouchStart}
                      onTouchEnd={handleTouchEnd}
                      setSelectedCardId={setSelectedCardId}
                      handlePlayCard={handlePlayCard}
                      isLongPressRef={isLongPressRef}
                      isFromSkat={isFromSkat}
                    />
                  );
                })
              ) : (
                <div className="h-24 flex items-center justify-center text-slate-600 text-[10px] uppercase font-mono">
                  {room.status === "LOBBY" ? "Oczekiwanie na rozpoczęcie gry" : "Rozdawanie kart..."}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar: Logs & social/Trump (span 3) */}
        <aside className="lg:col-span-3 flex flex-col gap-4">
          {/* Game logs container */}
          <GameLogs logs={logs} roomId={room.id} />

          {/* Trump card suit display */}
          <div className="bg-gray-900/50 neon-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-teal-600 uppercase tracking-widest">Kolor Trumfu</span>
              <span className={`w-3.5 h-3.5 rounded-full ${gameState?.trump ? "bg-emerald-500 shadow-lg shadow-emerald-500/50" : "bg-gray-800"}`}></span>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <p className="text-xs text-slate-400">Trumf aktualny</p>
                <p className="text-sm font-bold text-emerald-400 uppercase">
                  {gameState?.trump ? `${getCardSuitDetails(gameState.trump)?.label} (${getCardSuitDetails(gameState.trump)?.symbol})` : "BRAK (MUSIK)"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-teal-600">Wartość meldunku</p>
                <p className="text-sm font-bold text-slate-200">
                  {gameState?.trump === "H" ? "100" : gameState?.trump === "D" ? "80" : gameState?.trump === "C" ? "60" : gameState?.trump === "S" ? "40" : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Card Sorting (Segregacja kart) Panel */}
          <div className="bg-gray-900/50 neon-border rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span> Segregacja kart
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => setCardSorting('default')}
                className={`py-1.5 text-[10px] font-bold uppercase rounded-lg border transition-all cursor-pointer ${
                  cardSorting === 'default'
                    ? 'bg-emerald-500 border-emerald-500 text-gray-950 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
                    : 'bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                }`}
                title="Losowy, nieposortowany układ kart w ręce"
              >
                Losowo
              </button>
              <button
                onClick={() => setCardSorting('value_desc')}
                className={`py-1.5 text-[10px] font-bold uppercase rounded-lg border transition-all cursor-pointer ${
                  cardSorting === 'value_desc'
                    ? 'bg-emerald-500 border-emerald-500 text-gray-950 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
                    : 'bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                }`}
                title="Układanie kart według ich siły/wartości (As, 10, Król...)"
              >
                Wartość
              </button>
              <button
                onClick={() => setCardSorting('suit_desc')}
                className={`py-1.5 text-[10px] font-bold uppercase rounded-lg border transition-all cursor-pointer ${
                  cardSorting === 'suit_desc'
                    ? 'bg-emerald-500 border-emerald-500 text-gray-950 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
                    : 'bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                }`}
                title="Układanie kart pogrupowanych odwróconymi kolorami (Pik, Trefl, Karo, Kier)"
              >
                Kolorami
              </button>
            </div>
          </div>
        </aside>
      </main>


    </div>
  );
}

// --------------------------------------------------------
// Optimized Sub-components and Helper Functions
// --------------------------------------------------------

// Helper to get card colors and localized Polish labels
export const getCardSuitDetails = (suit: Card["suit"]) => {
  switch (suit) {
    case "H":
      return { symbol: "♥", color: "text-red-500", label: "Kier" };
    case "D":
      return { symbol: "♦", color: "text-orange-500", label: "Karo" };
    case "C":
      return { symbol: "♣", color: "text-emerald-400", label: "Trefl" };
    case "S":
      return { symbol: "♠", color: "text-blue-400", label: "Pik" };
  }
};

interface PlayingCardButtonProps {
  card: Card;
  isSelected: boolean;
  isMyTurn: boolean;
  roomStatus: Room["status"];
  isShiftPressed: boolean;
  skatWinner: string | null;
  username: string;
  onTouchStart: (card: Card, e?: React.TouchEvent | React.MouseEvent) => void;
  onTouchEnd: (card: Card, e?: React.TouchEvent | React.MouseEvent) => void;
  setSelectedCardId: (id: string | null) => void;
  handlePlayCard: (id: string, declareMeld: boolean) => void;
  isLongPressRef: React.RefObject<Record<string, boolean>>;
  isFromSkat?: boolean;
}

// Memoized Card Component for zero-overhead hand updates
const PlayingCardButton = React.memo(function PlayingCardButton({
  card,
  isSelected,
  isMyTurn,
  roomStatus,
  isShiftPressed,
  skatWinner,
  username,
  onTouchStart,
  onTouchEnd,
  setSelectedCardId,
  handlePlayCard,
  isLongPressRef,
  isFromSkat = false,
}: PlayingCardButtonProps) {
  const suitInfo = getCardSuitDetails(card.suit);

  const handleInteraction = (e: React.MouseEvent) => {
    if (isLongPressRef.current && isLongPressRef.current[card.id]) {
      isLongPressRef.current[card.id] = false;
      return;
    }
    if (roomStatus === "DISTRIBUTING" && skatWinner === username) {
      setSelectedCardId(card.id);
    } else if (roomStatus === "PLAYING" && isMyTurn) {
      handlePlayCard(card.id, e.shiftKey || isShiftPressed);
    }
  };

  const isDisabled =
    (roomStatus === "PLAYING" && !isMyTurn) ||
    (roomStatus !== "PLAYING" && roomStatus !== "DISTRIBUTING");

  return (
    <button
      onTouchStart={(e) => onTouchStart(card, e)}
      onTouchEnd={(e) => onTouchEnd(card, e)}
      onTouchCancel={(e) => onTouchEnd(card, e)}
      onMouseDown={(e) => onTouchStart(card, e)}
      onMouseUp={(e) => onTouchEnd(card, e)}
      onMouseLeave={(e) => onTouchEnd(card, e)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={handleInteraction}
      disabled={isDisabled}
      className={`playing-card relative ${
        isSelected ? "active-player" : ""
      } ${isMyTurn && roomStatus === "PLAYING" ? "border-emerald-400" : "opacity-85"} ${
        isFromSkat ? "ring-2 ring-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.6)] border-amber-500/80 animate-pulse" : ""
      }`}
    >
      {isFromSkat && (
        <span className="absolute -top-1.5 -right-1.5 text-[7px] font-bold font-mono text-amber-400 bg-gray-950 px-1 py-0.5 rounded border border-amber-500/40 tracking-wider shadow-sm z-10 scale-90">
          MUSIK
        </span>
      )}
      <div className="flex flex-col h-full justify-between">
        <div className="flex justify-between items-start w-full">
          <span className={`text-[14px] font-bold font-mono leading-none text-left self-start ${suitInfo?.color}`}>
            {card.value}
          </span>
        </div>
        <div className={`text-center text-2xl leading-none ${suitInfo?.color}`}>{suitInfo?.symbol}</div>
        <span className={`text-[14px] font-bold font-mono leading-none text-right self-end rotate-180 ${suitInfo?.color}`}>
          {card.value}
        </span>
      </div>
    </button>
  );
});

interface GameLogsProps {
  logs: { message: string; timestamp: string }[];
  roomId: string;
}

// Self-scrolling isolated Logs component
const GameLogs = React.memo(function GameLogs({ logs, roomId }: GameLogsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-gray-900/50 neon-border rounded-2xl p-4 flex flex-col h-[250px] lg:h-[350px]">
      <h2 className="text-[11px] uppercase tracking-widest text-teal-500 font-bold mb-4">Logi gry</h2>
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto space-y-1.5 font-mono text-[10px] pr-1 min-h-0"
      >
        {logs.length === 0 ? (
          <p className="text-teal-900 italic">Dołączono do pokoju {roomId}...</p>
        ) : (
          logs.map((log, idx) => (
            <p key={idx} className="text-teal-600 leading-normal break-words whitespace-normal text-left flex items-start gap-1">
              <span className="text-slate-500 shrink-0">[{log.timestamp.slice(0, 5)}]</span>
              <span className="text-slate-300 break-all">{log.message}</span>
            </p>
          ))
        )}
      </div>
    </div>
  );
});
