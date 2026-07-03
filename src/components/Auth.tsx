// src/components/Auth.tsx

import React, { useState } from "react";
import { Lock, User as UserIcon, LogIn, UserPlus } from "lucide-react";

interface AuthProps {
  onAuthSuccess: (token: string, user: { id: string; username: string }) => void;
}

export default function Auth({ onAuthSuccess }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const url = isLogin ? "/api/auth/login" : "/api/auth/register";

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Coś poszło nie tak. Spróbuj ponownie.");
      }

      // Success
      if (!isLogin) {
        localStorage.setItem("show_tysiac_tutorial", "true");
      }
      localStorage.setItem("tysiac_token", data.token);
      localStorage.setItem("tysiac_user", JSON.stringify(data.user));
      onAuthSuccess(data.token, data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-950 velvet-table">
      <div className="w-full max-w-md bg-gray-900/80 border border-teal-900/50 rounded-2xl p-8 backdrop-blur-md neon-border">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-emerald-500 rounded flex items-center justify-center font-bold text-gray-950 text-2xl mx-auto mb-4">T</div>
          <h1 className="text-3xl font-bold tracking-tight text-emerald-400 mint-glow uppercase">
            Tysiąc Online
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-teal-600 font-semibold mt-1">
            Professional Card League v2.4
          </p>
        </div>

        {/* Auth Toggle */}
        <div className="flex border-b border-teal-950/60 mb-6">
          <button
            onClick={() => {
              setIsLogin(true);
              setError(null);
            }}
            className={`flex-1 py-3 text-center font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
              isLogin
                ? "text-emerald-400 mint-glow border-b-2 border-emerald-400"
                : "text-teal-600 hover:text-slate-200 border-b border-transparent"
            }`}
          >
            Logowanie
          </button>
          <button
            onClick={() => {
              setIsLogin(false);
              setError(null);
            }}
            className={`flex-1 py-3 text-center font-bold text-xs uppercase tracking-wider transition-all duration-200 ${
              !isLogin
                ? "text-emerald-400 mint-glow border-b-2 border-emerald-400"
                : "text-teal-600 hover:text-slate-200 border-b border-transparent"
            }`}
          >
            Rejestracja
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/40 border border-red-500/20 text-red-200 text-xs rounded-lg text-center font-mono">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-teal-600 font-semibold mb-1.5">
              Nazwa gracza
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-teal-700">
                <UserIcon className="h-4 w-4" />
              </span>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Podaj pseudonim..."
                className="w-full pl-10 pr-4 py-3 bg-gray-950 border border-teal-900 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-emerald-500 placeholder:text-teal-950 font-sans"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-teal-600 font-semibold mb-1.5">
              Hasło
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-teal-700">
                <Lock className="h-4 w-4" />
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 bg-gray-950 border border-teal-900 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-emerald-500 placeholder:text-teal-950 font-sans"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer border border-emerald-400 hover:shadow-[0_0_15px_rgba(52,211,153,0.4)] active:scale-98 disabled:opacity-50 text-xs uppercase tracking-wider"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-gray-950 border-t-transparent rounded-full animate-spin"></span>
            ) : isLogin ? (
              <>
                <LogIn className="h-4 w-4" />
                Zaloguj do gry
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Stwórz konto
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
