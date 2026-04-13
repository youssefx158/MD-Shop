import crypto from "node:crypto";

export const config = {
  port: Number(process.env.PORT || 3000),

  // Change this before deploying.
  adminPassword: process.env.MD_ADMIN_PASSWORD || "change-me",

  // Used to sign session tokens in-memory (still keep it secret).
  sessionSecret:
    process.env.MD_SESSION_SECRET || crypto.randomBytes(32).toString("hex"),

  sessionIdleMinutes: 30,
  lockoutMinutes: 10,
  lockoutMaxAttempts: 3,

  paths: {
    publicDir: new URL("./public/", import.meta.url),
    dataDir: new URL("./data/", import.meta.url),
    uploadsDir: new URL("./uploads/", import.meta.url),
  },
};

