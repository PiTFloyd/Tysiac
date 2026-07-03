// src/components/Lobby.tsx

import React, { useState, useEffect } from "react";
import { User } from "../types";
import { PlusCircle, Play, Trophy, Users, Shield, Keyboard, LogOut, Cpu, Maximize2, Minimize2 } from "lucide-react";

interface LobbyProps {
  token: string;
  user: { id: string; username: string };
  socket: any;
  onLogOut: () => void;
  onCreateRoom: (mode: "solo" | "duo" | "multi") => void;
  onJoinRoom: (roomId: string) => void;
}

interface LeaderboardUser {
  id: string;
  username: string;
  wins: number;
}

export default function Lobby({ token, user, socket, onLogOut, onCreateRoom, onJoinRoom }: LobbyProps) {
  const [roomCode, setRoomCode] = useState("");
  const [profile, setProfile] = useState<{ winsCount: number; createdAt: string } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [savedGames, setSavedGames] = useState<any[]>([]);
  const [activeResumeLobby, setActiveResumeLobby] = useState<{
    savedGameId: string;
    participants: string[];
    joinedPlayers: string[];
    mode: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    if (!socket) return;

    socket.emit("game:saved_list");

    socket.on("game:saved_list_response", (list: any[]) => {
      setSavedGames(list);
    });

    socket.on("game:resume_lobby_state", (state: any) => {
      setActiveResumeLobby(state);
    });

    socket.on("game:resumed", ({ roomId }: { roomId: string }) => {
      setActiveResumeLobby(null);
      onJoinRoom(roomId);
    });

    return () => {
      socket.off("game:saved_list_response");
      socket.off("game:resume_lobby_state");
      socket.off("game:resumed");
    };
  }, [socket]);

  const handleRefreshSavedGames = () => {
    if (socket) {
      socket.emit("game:saved_list");
    }
  };

  const handleResumeGame = (savedGameId: string) => {
    if (socket) {
      socket.emit("game:resume_join", { savedGameId });
    }
  };

  const handleLeaveResumeLobby = () => {
    if (socket && activeResumeLobby) {
      socket.emit("game:resume_leave", { savedGameId: activeResumeLobby.savedGameId });
      setActiveResumeLobby(null);
    }
  };

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

  // Check for first-time login tutorial
  useEffect(() => {
    if (localStorage.getItem("show_tysiac_tutorial") === "true") {
      setShowWelcome(true);
      localStorage.removeItem("show_tysiac_tutorial");
    }
  }, []);

  // Load user profile and leaderboard on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch current user details
        const profileRes = await fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          setProfile(profileData);
        }

        // Fetch leaderboard
        const leadersRes = await fetch("/api/auth/leaderboard");
        if (leadersRes.ok) {
          const leadersData = await leadersRes.json();
          setLeaderboard(leadersData);
        }
      } catch (err) {
        console.error("Error loading lobby data:", err);
      }
    };

    fetchData();
  }, [token]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;
    onJoinRoom(roomCode.trim().toUpperCase());
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col font-sans text-slate-200">
      {/* Top Navigation Bar */}
      <nav className="h-16 flex items-center justify-between px-6 sm:px-8 bg-gray-900/80 border-b border-teal-900/50 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-500 rounded flex items-center justify-center font-bold text-gray-950 text-xl">T</div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-emerald-400 mint-glow uppercase">TYSIĄC ONLINE</h1>
            <p className="text-[10px] uppercase tracking-widest text-teal-600 font-semibold">Professional Card League v2.4</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-teal-600 font-bold uppercase">Twój Status</span>
            <span className="text-xs font-mono text-emerald-400 font-bold">Zwycięstw: {profile?.winsCount ?? 0}</span>
          </div>
          <div className="h-8 w-[1px] bg-teal-900/50"></div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-bold text-slate-200">{user.username}</p>
              <p className="text-[10px] text-teal-500 font-mono">ID: #{user.id.slice(0, 6)}</p>
            </div>
            <button
              onClick={toggleFullscreen}
              className="p-2 bg-gray-800 border border-teal-900/40 hover:border-emerald-500/50 hover:text-emerald-400 rounded-lg transition-all cursor-pointer"
              title={isFullscreen ? "Wyjdź z pełnego ekranu" : "Pełny ekran"}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              onClick={onLogOut}
              className="p-2 bg-gray-800 border border-teal-900/40 hover:border-red-500/50 hover:text-red-400 rounded-lg transition-all cursor-pointer"
              title="Wyloguj się"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Game Layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto">
        
        {/* Left Column: Game Launchers */}
        <div className="lg:col-span-7 space-y-6 flex flex-col">
          {/* Create room panel */}
          <div className="bg-gray-900/50 neon-border rounded-2xl p-6 flex flex-col">
            <h2 className="text-xs uppercase tracking-widest text-teal-500 font-bold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-teal-500"></span> Rozpocznij nową grę
            </h2>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              Utwórz nowy stół gier do klasycznego Tysiąca. Brakujące miejsca w pokojach jedno- lub dwuosobowych zostaną natychmiastowo obsadzone przez inteligentne boty.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Solo mode */}
              <button
                onClick={() => onCreateRoom("solo")}
                className="bg-gray-950 border border-teal-900/50 hover:border-emerald-400 hover:bg-emerald-950/10 group p-5 rounded-xl text-left transition-all duration-200 cursor-pointer flex flex-col justify-between h-36"
              >
                <div className="bg-emerald-500/10 p-2 rounded-lg text-emerald-400 group-hover:bg-emerald-500/20 w-8 h-8 flex items-center justify-center">
                  <Cpu className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-200 group-hover:text-emerald-400 transition-colors">Solo vs Bot</h3>
                  <p className="text-[10px] text-teal-700 mt-1">Graj samemu na 2 boty</p>
                </div>
              </button>

              {/* Duo mode */}
              <button
                onClick={() => onCreateRoom("duo")}
                className="bg-gray-950 border border-teal-900/50 hover:border-teal-400 hover:bg-teal-950/10 group p-5 rounded-xl text-left transition-all duration-200 cursor-pointer flex flex-col justify-between h-36"
              >
                <div className="bg-teal-500/10 p-2 rounded-lg text-teal-400 group-hover:bg-teal-500/20 w-8 h-8 flex items-center justify-center">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-200 group-hover:text-teal-400 transition-colors">Duo + Bot</h3>
                  <p className="text-[10px] text-teal-700 mt-1">2 Graczy + 1 Bot</p>
                </div>
              </button>

              {/* Multi mode */}
              <button
                onClick={() => onCreateRoom("multi")}
                className="bg-gray-950 border border-teal-900/50 hover:border-indigo-400 hover:bg-indigo-950/10 group p-5 rounded-xl text-left transition-all duration-200 cursor-pointer flex flex-col justify-between h-36"
              >
                <div className="bg-indigo-500/10 p-2 rounded-lg text-indigo-400 group-hover:bg-indigo-500/20 w-8 h-8 flex items-center justify-center">
                  <Play className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-200 group-hover:text-indigo-400 transition-colors">Multiplayer</h3>
                  <p className="text-[10px] text-teal-700 mt-1">3 Graczy w sieci</p>
                </div>
              </button>
            </div>
          </div>

          {/* Join room code panel */}
          <div className="bg-gray-900/50 neon-border rounded-2xl p-6">
            <h2 className="text-xs uppercase tracking-widest text-teal-500 font-bold mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-teal-500"></span> Dołącz do stołu
            </h2>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">
              Posiadasz unikalny 5-literowy identyfikator pokoju od znajomego? Wpisz go poniżej, aby natychmiast zająć miejsce przy jego stole.
            </p>

            <form onSubmit={handleJoin} className="flex gap-3">
              <input
                type="text"
                maxLength={5}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="KOD POKOJU"
                className="flex-1 px-4 py-2.5 bg-gray-950 border border-teal-900 rounded-lg text-sm text-center font-mono font-bold tracking-widest text-emerald-400 focus:outline-none focus:border-emerald-500 uppercase placeholder:text-teal-950"
              />
              <button
                type="submit"
                className="px-6 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-xs uppercase tracking-wider rounded-lg transition-all hover:shadow-[0_0_12px_rgba(52,211,153,0.3)] active:scale-98 cursor-pointer flex items-center gap-2"
              >
                Dołącz <Play className="h-3 w-3 fill-current" />
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Leaderboard */}
        <div className="lg:col-span-5 space-y-6 flex flex-col">
          {/* Quick Info / Welcome Box */}
          <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-4 flex justify-between items-center">
            <div>
              <p className="text-[10px] uppercase font-bold text-emerald-400 mb-1">Sezon Karciany</p>
              <p className="text-lg font-bold text-slate-100">Liga Tysiąca</p>
              <p className="text-[10px] text-teal-600 mt-1 italic">Rozegraj mecz i udowodnij swoje mistrzostwo!</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Rejestracja</p>
              <p className="text-xs font-mono font-bold text-emerald-400">
                {profile ? new Date(profile.createdAt).toLocaleDateString("pl-PL") : "..."}
              </p>
            </div>
          </div>

          {/* Zapisane gry / Saved Games */}
          <div className="bg-gray-900/50 neon-border rounded-2xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs uppercase tracking-widest text-teal-500 font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Zapisane gry ({savedGames.length})
              </h2>
              <button 
                onClick={handleRefreshSavedGames}
                className="text-[10px] uppercase font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 px-2 py-1 rounded transition-colors cursor-pointer"
              >
                Odśwież
              </button>
            </div>
            
            {savedGames.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-4 text-center">Brak zapisanych gier.</p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {savedGames.map((game) => {
                  let playersList: any[] = [];
                  try {
                    playersList = JSON.parse(game.players);
                  } catch {}
                  const playersNames = playersList.map(p => p.username).join(", ");
                  const dateStr = new Date(game.createdAt).toLocaleString("pl-PL", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  });
                  return (
                    <button
                      key={game.id}
                      onClick={() => handleResumeGame(game.id)}
                      className="w-full text-left bg-gray-950 hover:bg-teal-950/20 border border-teal-900/40 hover:border-emerald-500/40 p-3 rounded-xl transition-all cursor-pointer flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className="text-emerald-400 font-bold uppercase tracking-wider">
                          Tryb: {game.mode === "solo" ? "Solo vs Bot" : game.mode === "duo" ? "Duo + Bot" : "Multiplayer"}
                        </span>
                        <span className="text-slate-500 font-mono">{dateStr}</span>
                      </div>
                      <p className="text-xs text-slate-300 truncate">
                        Gracze: <strong className="text-slate-200">{playersNames}</strong>
                      </p>
                      <div className="flex items-center justify-between mt-2 text-[10px] text-teal-600 font-medium">
                        <span>Stan: {game.status}</span>
                        <span className="text-emerald-400 font-bold">Wznów grę &rarr;</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Leaderboard table */}
          <div className="bg-gray-900/50 neon-border rounded-2xl p-4 flex-1 flex flex-col">
            <h2 className="text-xs uppercase tracking-widest text-teal-500 font-bold mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-teal-500"></span> Ranking Graczy (Top 10)
            </h2>
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-teal-600 text-[10px] uppercase font-bold border-b border-teal-900/40 pb-2">
                    <th className="py-2.5 px-2">Poz</th>
                    <th className="py-2.5 px-2">Gracz</th>
                    <th className="py-2.5 px-2 text-right">Zwycięstwa</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {leaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-teal-700 text-[10px] uppercase">
                        Brak zapisanych rozgrywek.
                      </td>
                    </tr>
                  ) : (
                    leaderboard.map((leader, idx) => {
                      const isCurrentUser = leader.username === user.username;
                      return (
                        <tr
                          key={leader.id}
                          className="score-row hover:bg-teal-950/10 transition-colors"
                        >
                          <td className="py-2.5 px-2 text-emerald-400/80">
                            {idx + 1 === 1 ? "🏆 1" : idx + 1 === 2 ? "🥈 2" : idx + 1 === 3 ? "🥉 3" : `${idx + 1}`}
                          </td>
                          <td className={`py-2.5 px-2 ${isCurrentUser ? "text-emerald-400 font-bold" : "text-slate-300"}`}>
                            {leader.username} {isCurrentUser && <span className="text-[9px] text-teal-600">(Ty)</span>}
                          </td>
                          <td className="py-2.5 px-2 text-right text-emerald-400 font-bold">
                            {leader.wins}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Controls / Footer */}
      <footer className="h-12 bg-gray-950 px-8 border-t border-teal-900/50 flex items-center justify-between">
        <div className="flex gap-4">
          <span className="text-[10px] font-bold text-teal-500 uppercase cursor-pointer hover:text-emerald-400">Pomoc i Zasady</span>
          <span className="text-[10px] font-bold text-teal-500 uppercase cursor-pointer hover:text-emerald-400">Społeczność</span>
        </div>
        <div className="text-[10px] text-teal-900">
          Professional Arena Server | Status: <span className="text-emerald-500">Online</span>
        </div>
      </footer>

      {/* Welcome / Tutorial Modal */}
      {showWelcome && (
        <div className="fixed inset-0 bg-gray-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg bg-gray-900 border border-emerald-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
            {/* Top green laser light overlay */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_10px_rgba(52,211,153,0.5)]"></div>
            
            <div className="text-center mb-6">
              <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center text-emerald-400 mx-auto mb-4 animate-bounce">
                <Trophy className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold tracking-tight text-emerald-400 mint-glow uppercase">
                Witaj w grze Tysiąc!
              </h3>
              <div className="h-[1px] w-32 bg-teal-900/40 mx-auto mt-2"></div>
            </div>

            <div className="space-y-4 text-xs text-slate-300 mb-8 leading-relaxed font-sans">
              <p className="text-slate-200 text-center text-sm font-medium">
                Walcz o karty i zbieraj punkty aby zebrać tysiąca punktów!
              </p>

              <div className="bg-gray-950/50 border border-teal-950 p-4 rounded-xl space-y-3">
                <div className="flex gap-3 items-start">
                  <div className="bg-teal-500/10 p-1.5 rounded-lg text-teal-400 shrink-0">
                    <Keyboard className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-bold text-teal-400 uppercase tracking-wider text-[10px]">Komputery / Laptop</p>
                    <p className="text-slate-300 mt-0.5">
                      Melduj pary za pomocą klawisza <span className="px-1.5 py-0.5 bg-teal-950 border border-teal-800 text-emerald-400 rounded font-mono font-bold text-[10px]">SHIFT</span> + kliknięciu na kartę którą chcesz zagrać.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 items-start">
                  <div className="bg-emerald-500/10 p-1.5 rounded-lg text-emerald-400 shrink-0">
                    <span className="text-xs font-mono font-black">📱</span>
                  </div>
                  <div>
                    <p className="font-bold text-emerald-400 uppercase tracking-wider text-[10px]">Urządzenia dotykowe</p>
                    <p className="text-slate-300 mt-0.5">
                      Jeśli grasz na urządzeniu z ekranem dotykowym, zamiast tego <span className="text-emerald-400 font-bold">przytrzymaj kartę przez dłuższą chwilę (ok. 1 sekundę)</span>.
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-center font-bold text-emerald-400 text-sm tracking-wide uppercase mt-6 animate-pulse">
                Powodzenia!
              </p>
            </div>

            <button
              onClick={() => setShowWelcome(false)}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold rounded-xl transition-all duration-200 cursor-pointer text-xs uppercase tracking-wider border border-emerald-400 hover:shadow-[0_0_15px_rgba(52,211,153,0.4)] active:scale-98"
            >
              Zacznij grać
            </button>
          </div>
        </div>
      )}

      {/* Poczekalnia Wznowienia / Resume Lobby Modal */}
      {activeResumeLobby && (
        <div className="fixed inset-0 bg-gray-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md bg-gray-900 border border-emerald-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
            {/* Top green laser light overlay */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_10px_rgba(52,211,153,0.5)]"></div>
            
            <div className="text-center mb-6">
              <span className="text-[10px] uppercase font-mono tracking-widest text-emerald-400">Poczekalnia</span>
              <h3 className="text-xl font-bold tracking-tight text-emerald-400 mint-glow uppercase mt-1">
                Wznowienie gry
              </h3>
              <div className="h-[1px] w-32 bg-teal-900/40 mx-auto mt-2"></div>
            </div>

            <div className="space-y-4 text-xs text-slate-300 mb-8 font-sans">
              <p className="text-slate-300 text-center text-xs">
                Oczekiwanie na dołączenie wszystkich uczestników zapisanej gry...
              </p>

              <div className="bg-gray-950 border border-teal-950 p-4 rounded-xl space-y-3">
                <p className="font-bold text-teal-400 uppercase tracking-wider text-[10px] mb-2 border-b border-teal-950 pb-1">Uczestnicy:</p>
                {activeResumeLobby.participants.map((username) => {
                  const isJoined = activeResumeLobby.joinedPlayers.includes(username);
                  return (
                    <div key={username} className="flex items-center justify-between py-1 font-mono text-xs">
                      <span className={username === user.username ? "text-emerald-400 font-bold" : "text-slate-300"}>
                        {username} {username === user.username && <span className="text-[9px] text-teal-600">(Ty)</span>}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        isJoined 
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                          : "bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse"
                      }`}>
                        {isJoined ? "GOTOWY" : "OCZEKIWANIE"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              onClick={handleLeaveResumeLobby}
              className="w-full py-3 bg-gray-950 hover:bg-gray-900 border border-red-500/30 hover:border-red-500/50 text-red-400 font-bold rounded-xl transition-all duration-200 cursor-pointer text-xs uppercase tracking-wider"
            >
              Wyjdź z poczekalni
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
