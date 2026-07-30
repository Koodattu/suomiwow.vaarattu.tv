// Type augmentation for express-session to add custom session properties
import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

// Export empty object to make this a module
export {};
