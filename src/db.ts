// src/db.ts

import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";

// Prevent multiple instances of Prisma Client in development/HMR
declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

/**
 * Checks the database connection gracefully and ensures migrations are pushed.
 * This allows the application to start even if the database is not yet fully configured/migrated.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    // Automatically push/ensure database schema is up-to-date
    console.log("=========================================");
    console.log("Synchronizing SQLite database schema...");
    try {
      execSync("npx prisma db push --accept-data-loss", { stdio: "inherit" });
      console.log("✅ SQLite database schema synchronized successfully.");
    } catch (pushErr) {
      console.error("⚠️ Warning: Prisma db push failed, trying to continue anyway:", pushErr);
    }

    // Enable WAL mode and busy timeout for SQLite stability and crash/corruption prevention
    try {
      await prisma.$queryRawUnsafe(`PRAGMA journal_mode=WAL;`);
      await prisma.$queryRawUnsafe(`PRAGMA busy_timeout=5000;`);
      console.log("SQLite WAL mode and busy_timeout configured successfully.");
    } catch (pragmaError) {
      // Ignore if database provider is not SQLite
    }

    // Basic query to check if DB is accessible
    await prisma.$queryRaw`SELECT 1`;
    console.log("=========================================");
    console.log("✅ Database connection verified successfully.");
    console.log("=========================================");
    return true;
  } catch (error) {
    console.log("=========================================");
    console.log("⚠️  WARNING: Database is not ready or migrated.");
    console.log("Please run database setup (e.g., npm run db:setup)");
    console.log("=========================================");
    return false;
  }
}

