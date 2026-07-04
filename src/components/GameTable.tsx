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

export default function GameTable({ socket, roomId, user, onBackToLobby }: GameTableProps) {
  const [room, setRoom] = useState<Room | null>(null);
  const [logs, setLogs] = useState<{ message: string; timestamp: string }[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeMelds, setActiveMelds] = useState<Record<string, { points: number; id: string }>>({});

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

  // Distribute card action
  const handleDistribute = React.useCallback((targetUsername: string) => {
    if (!selectedCardId) return;
    socket.emit("game:distribute", { roomId, cardId: selectedCardId, targetUsername });
    setSelectedCardId(null);
  }, [socket, roomId, selectedCardId]);

  const handleIncreaseBid = React.useCallback((newBid: number) => {
    socket.emit("game:increase_bid", { roomId, newBid });
  }, [socket, roomId]);

  const handleBomba = React.useCallback(() => {
    socket.emit("game:bomba", { roomId });
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
              <div className="absolute text-center p-4 bg-gray-950 border border-teal-900 rounded-xl max-w-xs shadow-2xl z-20 neon-border">
                <Layers className="h-6 w-6 text-emerald-400 mx-auto mb-1" />
                <span className="text-[9px] font-mono text-teal-500 uppercase tracking-widest">Licytacja</span>
                <p className="text-xs font-bold text-white mb-3">Wysokość: <span className="text-yellow-400 font-mono">{gameState.bidding.highestBid} pkt</span></p>

                {isMyTurn ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleBid(gameState.bidding.minBid)}
                      className="flex-1 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-[10px] uppercase rounded-lg cursor-pointer"
                    >
                      Licytuj {gameState.bidding.minBid}
                    </button>
                    <button
                      onClick={handlePass}
                      className="flex-1 py-1.5 bg-gray-900 border border-red-500/20 text-red-400 text-[10px] uppercase rounded-lg cursor-pointer"
                    >
                      Pas
                    </button>
                  </div>
                ) : (
                  <span className="text-[9px] font-mono text-teal-600 animate-pulse">Ruch: {gameState.currentTurn}</span>
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
                <div className="absolute text-center p-4 bg-gray-950 border border-teal-900 rounded-xl z-20 neon-border max-w-xs">
                  <span className="text-[9px] font-mono text-yellow-400 uppercase tracking-widest block mb-1">Musik (Skat)</span>
                  <p className="text-[10px] text-slate-300 font-semibold mb-3">{gameState.skatWinner} zgarnia musik!</p>
                  <div className="flex gap-2 justify-center">
                    {isSkatHidden ? (
                      <>
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="w-[50px] h-[80px] bg-gradient-to-br from-teal-950 to-gray-900 border border-teal-500/30 rounded flex flex-col items-center justify-center shadow-md animate-pulse">
                            <span className="text-teal-500 text-lg">❓</span>
                          </div>
                        ))}
                      </>
                    ) : (
                      gameState.skat.map((c) => {
                        const suitInfo = getCardSuitDetails(c.suit);
                        return (
                          <div key={c.id} className="w-[50px] h-[80px] bg-gray-900 border border-yellow-500/40 rounded flex flex-col justify-between p-1 shadow-md">
                            <span className={`text-[11px] font-bold text-left self-start ${suitInfo?.color}`}>{c.value}</span>
                            <span className={`text-base text-center font-bold ${suitInfo?.color}`}>{suitInfo?.symbol}</span>
                            <span className={`text-[11px] font-bold text-right self-end ${suitInfo?.color}`}>{c.value}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {isSkatHidden && (
                    <p className="text-[9px] text-teal-500 mt-2 italic">Licytacja przymusowa – musik ukryty przed innymi</p>
                  )}
                </div>
              );
            })()}

            {/* DISTRIBUTING */}
            {room.status === "DISTRIBUTING" && gameState && (
              <div className="absolute text-center p-4 bg-gray-950 border border-teal-900 rounded-xl z-20 neon-border max-w-xs">
                <span className="text-[9px] font-mono text-teal-500 uppercase tracking-widest block mb-1">Oddaj Karty</span>
                <p className="text-[10px] text-slate-300 mb-3">
                  {gameState.skatWinner === user.username
                    ? "Zaznacz kartę i przekaż ją rywalom."
                    : `Licytator (${gameState.skatWinner}) rozdaje karty...`}
                </p>

                {gameState.skatWinner === user.username && (
                  <div className="space-y-3">
                    <div className="space-y-1 bg-teal-950/20 p-2 border border-teal-900/40 rounded-lg">
                      <span className="text-[9px] font-mono text-teal-500 uppercase tracking-widest block">Ugraj wyższy kontrakt</span>
                      <p className="text-[9px] text-teal-600">Dostosuj stawkę (min. {gameState.bidding.originalBid || 100} pkt):</p>
                      <div className="flex items-center justify-between mt-2 bg-gray-900 border border-teal-900/60 rounded-lg p-1 max-w-[180px] mx-auto shadow-inner">
                        <button
                          disabled={gameState.bidding.highestBid <= (gameState.bidding.originalBid || 100)}
                          onClick={() => handleIncreaseBid(gameState.bidding.highestBid - 10)}
                          className="w-8 h-8 flex items-center justify-center text-sm font-bold text-slate-300 hover:text-emerald-400 disabled:opacity-30 disabled:hover:text-slate-300 rounded transition-colors cursor-pointer select-none"
                          title="Obniż stawkę kontraktu o 10"
                        >
                          −
                        </button>
                        <span className="text-xs font-mono font-bold text-emerald-400 px-2 min-w-[70px] text-center">
                          {gameState.bidding.highestBid} pkt
                        </span>
                        <button
                          disabled={gameState.bidding.highestBid >= 300}
                          onClick={() => handleIncreaseBid(gameState.bidding.highestBid + 10)}
                          className="w-8 h-8 flex items-center justify-center text-sm font-bold text-slate-300 hover:text-emerald-400 disabled:opacity-30 disabled:hover:text-slate-300 rounded transition-colors cursor-pointer select-none"
                          title="Podnieś stawkę kontraktu o 10"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="text-[9px] font-mono text-teal-500 uppercase tracking-widest block border-t border-teal-900/20 pt-1.5">Oddaj karty rywalom</span>
                      {!selectedCardId ? (
                        <p className="text-[9px] text-yellow-500 font-bold">Wybierz kartę ze swojej ręki.</p>
                      ) : (
                        <div className="flex gap-1.5 justify-center">
                          {room.players
                            .filter((p) => p.username !== user.username)
                            .map((p) => {
                              const hasReceived = (gameState as any).distributedTo?.includes(p.username);
                              return (
                                <button
                                  key={p.username}
                                  disabled={hasReceived}
                                  onClick={() => handleDistribute(p.username)}
                                  className="px-2.5 py-1 bg-gray-900 border border-teal-900 text-[9px] font-bold text-slate-200 hover:border-emerald-400 rounded transition-all cursor-pointer disabled:opacity-30"
                                >
                                  {p.username}
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>
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
              <div className="absolute text-center p-4 bg-gray-950 border border-teal-900 rounded-xl z-20 neon-border max-w-xs">
                <Award className="h-6 w-6 text-yellow-500 mx-auto mb-1 animate-bounce" />
                <h3 className="font-bold text-xs text-white">Zwycięzca: {room.winnerUsername}</h3>
                <button
                  onClick={onBackToLobby}
                  className="mt-4 w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-[10px] uppercase rounded"
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
                gameState.hand.map((c) => {
                  const isSelected = selectedCardId === c.id;
                  const isValid = gameState?.validCardIds ? gameState.validCardIds.includes(c.id) : true;
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
                      isValid={isValid}
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
  isValid?: boolean;
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
  isValid = true,
}: PlayingCardButtonProps) {
  const suitInfo = getCardSuitDetails(card.suit);

  const handleInteraction = (e: React.MouseEvent) => {
    if (isLongPressRef.current && isLongPressRef.current[card.id]) {
      isLongPressRef.current[card.id] = false;
      return;
    }
    if (roomStatus === "DISTRIBUTING" && skatWinner === username) {
      setSelectedCardId(card.id);
    } else if (roomStatus === "PLAYING" && isMyTurn && isValid) {
      handlePlayCard(card.id, e.shiftKey || isShiftPressed);
    }
  };

  const isDisabled =
    (roomStatus === "PLAYING" && (!isMyTurn || !isValid)) ||
    (roomStatus !== "PLAYING" && roomStatus !== "DISTRIBUTING");

  let cardStyle = "";
  if (roomStatus === "PLAYING") {
    if (isMyTurn) {
      if (isValid) {
        cardStyle = "border-emerald-400 ring-2 ring-emerald-500/30 shadow-[0_0_12px_rgba(52,211,153,0.3)] scale-[1.02] z-10 hover:scale-[1.08] hover:-translate-y-2";
      } else {
        cardStyle = "opacity-35 border-slate-800 scale-95 pointer-events-none";
      }
    } else {
      cardStyle = "opacity-75 border-slate-700/60";
    }
  } else if (roomStatus === "DISTRIBUTING") {
    cardStyle = isSelected ? "active-player scale-[1.02] -translate-y-2" : "border-teal-600/60 hover:border-emerald-400";
  } else {
    cardStyle = "opacity-85 border-teal-600/40";
  }

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
      className={`playing-card relative transition-all duration-300 ${cardStyle}`}
    >
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
