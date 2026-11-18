"use strict";
// ============================================================================================
// STUB: the auth server (task #2). Spec: auth/README.md. nginx sends it /register, /login and
// /logout only. It already runs (so the stack starts after Phase 1) and answers 501 until the
// task is done. Keep the port (3000) and the file name.
// ============================================================================================
const express = require("express");
// const fs = require("fs");
// const path = require("path");
// const crypto = require("crypto");
// const bcrypt = require("bcryptjs");
// const jwt = require("jsonwebtoken");
// const { Pool } = require("pg");

const PORT = 3000;

// TODO (task #2): constants (key dirs, TOKEN_HOURS/TOKEN_SECONDS, USERNAME_RE, password limits)
// TODO (task #2): loadKeys() — RSA key pair on the volumes (auth/README.md, "1. Keys")
// TODO (task #2): the database (retry, users table + unique lower(username) index)
// TODO (task #2): helpers: escapeHtml, parseCookies, isHttps, cookie(), csrfFor(), csrfOk(), noStore()
// TODO (task #2): page() and authForm() exactly as in auth/README.md ("8. Page HTML")

async function main() {
  // TODO (task #2): const { privatePem } = loadKeys(); await initDb();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "8kb" }));

  // TODO (task #2): issue(req, res, username) → RS256 JWT in the HttpOnly "token" cookie
  // TODO (task #2): GET /login, GET /register, POST /register, POST /login, POST /logout, GET /logout
  const notYet = (req, res) => res.status(501).type("text").send("Accounts arrive with task #2.");
  app.get("/login", notYet);
  app.get("/register", notYet);

  app.use((req, res) => res.status(404).type("text").send("Not found"));
  app.listen(PORT, () => console.log(`auth: listening on ${PORT}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
