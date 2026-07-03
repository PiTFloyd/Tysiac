// auth/authController.ts

import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../src/db";

export const JWT_SECRET = process.env.JWT_SECRET || "tysiac-secret-key-1000";

const RegisterSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(20, "Username must be at most 20 characters").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain alphanumeric characters and underscores"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const LoginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const authRouter = Router();

// Register Handler
authRouter.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = RegisterSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { username: body.username },
    });

    if (existingUser) {
      res.status(400).json({ error: "Username already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const user = await prisma.user.create({
      data: {
        username: body.username,
        passwordHash,
      },
    });

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: { id: user.id, username: user.username },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error("Registration error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login Handler
authRouter.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = LoginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { username: body.username },
    });

    if (!user) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const isValid = await bcrypt.compare(body.password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: { id: user.id, username: user.username },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Middleware to authenticate JWT
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    username: string;
  };
}

export function authenticateJWT(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: Missing token" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      username: string;
    };
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: "Forbidden: Invalid or expired token" });
  }
}

// Get Current User Profile and Statistics
authRouter.get("/me", authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        createdAt: true,
        _count: {
          select: { matchesWon: true },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      winsCount: user._count.matchesWon,
    });
  } catch (err) {
    console.error("Get me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get Match History / Leaderboard
authRouter.get("/leaderboard", async (req: Request, res: Response): Promise<void> => {
  try {
    const leaders = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        _count: {
          select: { matchesWon: true },
        },
      },
      orderBy: {
        matchesWon: {
          _count: "desc",
        },
      },
      take: 10,
    });

    res.json(
      leaders.map((l) => ({
        id: l.id,
        username: l.username,
        wins: l._count.matchesWon,
      }))
    );
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
