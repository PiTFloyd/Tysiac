// src/App.tsx

import React, { useState, useEffect } from "react";
import Auth from "./components/Auth";
import Lobby from "./components/Lobby";
import GameTable from "./components/GameTable";
import { io, Socket } from "socket.io-client";

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem("tysiac_token"));
  const [user, setUser] = useState<{ id: string; username: string } | null>(() => {
    try {
      const stored = localStorage.getItem("tysiac_user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [view, setView] = useState<"AUTH" | "LOBBY" | "GAME">("AUTH");
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  // Synchronize socket connection with authentication state
  useEffect(() => {
    if (!token) {
      setView("AUTH");
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    setView("LOBBY");

    // Connect to the socket server (it runs on the same port 3000)
    const newSocket = io("/", {
      auth: { token },
      autoConnect: true,
      reconnection: true,
    });

    // Automatically transition to the active game view when the server shares room updates
    newSocket.on("room:state", (roomState: any) => {
      setActiveRoomId(roomState.id);
      setView("GAME");
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [token]);

  const handleAuthSuccess = (newToken: string, newUser: { id: string; username: string }) => {
    setUser(newUser);
    setToken(newToken);
  };

  const handleLogOut = () => {
    localStorage.removeItem("tysiac_token");
    localStorage.removeItem("tysiac_user");
    setToken(null);
    setUser(null);
    setView("AUTH");
  };

  const handleCreateRoom = (mode: "solo" | "duo" | "multi") => {
    if (!socket) return;
    socket.emit("room:create", { mode });
  };

  const handleJoinRoom = (roomId: string) => {
    if (!socket) return;
    setActiveRoomId(roomId);
    setView("GAME");
  };

  const handleBackToLobby = () => {
    if (socket && activeRoomId) {
      socket.emit("room:leave", { roomId: activeRoomId });
    }
    setActiveRoomId(null);
    setView("LOBBY");
  };

  // Render correct view
  if (view === "AUTH" || !user) {
    return <Auth onAuthSuccess={handleAuthSuccess} />;
  }

  if (view === "GAME" && activeRoomId && socket) {
    return (
      <GameTable
        socket={socket}
        roomId={activeRoomId}
        user={user}
        onBackToLobby={handleBackToLobby}
      />
    );
  }

  return (
    <Lobby
      token={token || ""}
      user={user}
      socket={socket}
      onLogOut={handleLogOut}
      onCreateRoom={handleCreateRoom}
      onJoinRoom={handleJoinRoom}
    />
  );
}
