# Tests (PROVIDED, do not edit)

Run against the running stack (`docker compose up --build` in the project root):

```
cd tests && npm install
node e2e.js          # acceptance test: security, bots, lobby → maze → floor 2 (must end with "all passed")
node load.js NEW 40  # 40 simulated players host and play a whole round (load test)
node load.js CODE 7  # 7 simulated players join an existing session
```
`client.js` is the shared helper (register/login with CSRF, open the WebSocket with the cookie).
