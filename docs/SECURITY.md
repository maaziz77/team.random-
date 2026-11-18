# Security rules

The handout says a single security risk sets **all four objectives to 0**. Every item here is
required.

1. **Database not reachable from outside.** No `ports:` on `db` in docker-compose.yml. Only nginx
   publishes a port (8080).
2. **No secrets in the repo.** RSA keys are generated inside the auth container at startup and
   stored on volumes. `.gitignore` covers `.env` and `*.pem`. Never commit `node_modules`.
3. **Passwords:** bcrypt cost 12; max 72 bytes; never logged; never sent back.
4. **SQL injection:** only parameterised queries (`pool.query(text, [values])`).
5. **HTML injection:** usernames are restricted to `[A-Za-z0-9_]{3,16}` at registration *and*
   escaped (`escapeHtml`) everywhere the server puts any value into HTML (auth pages, home
   page). The provided frontend escapes/uses `textContent` on its side. Bot names contain `-`,
   which real usernames can't, and are only ever created by the server.
6. **XSRF:** every state-changing form (register, login, logout) uses the double-submit token
   (auth/README.md). Cookies are `SameSite=Strict`. The game itself changes state only over
   the WebSocket.
7. **Cross-site WebSocket hijacking:** the handshake requires `Origin`'s host to equal the
   `Host` header (403 otherwise).
8. **JWT:** RS256 only (`algorithms: ["RS256"]` when verifying), so `alg: none` and HS256 tokens
   are refused; the token must have a numeric `exp` and a `sub` matching the username regex;
   tokens over 4096 characters are refused. The app verifies with the public key only.
9. **Cookies:** `token` is HttpOnly; all cookies are SameSite=Strict, Path=/, and get `Secure`
   when `X-Forwarded-Proto` is `https`.
10. **Identity:** the server uses the username from the verified token for everything a
    connection does. Clients never send a name. One live connection per user (a new one
    replaces the old with `err: elsewhere`).
11. **Input validation on the socket:** 4 KB max frame, 120 msgs/s rate limit, inputs clamped,
    integers checked (`Number.isInteger`), host-only actions checked against the session's host.
12. **Headers:** `X-Content-Type-Options: nosniff` on every response (nginx);
    `x-powered-by` disabled; `Cache-Control: no-store` on auth responses and logged-in pages.
13. **Path traversal:** only `express.static` serves files; game pages are fixed files.
