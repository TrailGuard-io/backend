import "express";

declare global {
  namespace Express {
    interface User {
      id: number;
      email: string;
      role: string;
      name?: string | null;
      avatarUrl?: string | null;
    }
  }
}

export {};
