# nginx

Create `nginx/nginx.conf` with exactly this content. It is mounted over the image's main config
(see docker-compose.yml).

Things that matter (don't change them):
- `/register`, `/login`, `/logout` are **exact-match** locations to the auth server, so the app
  never sees authentication requests.
- `/ws` passes the WebSocket upgrade. **A location that sets any `proxy_set_header` loses the
  server-level ones**, so `/ws` repeats `Host`, `X-Real-IP`, `X-Forwarded-For` and
  `X-Forwarded-Proto`. Without `Host $http_host` the app's Origin check rejects every socket
  (403).
- `X-Forwarded-Proto` tells the backends whether the user is on HTTPS (cookies get `Secure`).
  On the live server HTTPS ends at the **server's own nginx** (docs/DEPLOY.md), which then talks
  plain http to this container. So this config keeps an incoming `X-Forwarded-Proto: https` and
  otherwise uses its own scheme (the `$forwarded_proto` map). Locally nothing sends that header,
  so it's `http`.
- `X-Content-Type-Options: nosniff` on every response (only here, not in Express).

```nginx
worker_processes auto;
events { worker_connections 4096; }

http {
  include /etc/nginx/mime.types;
  sendfile on;
  server_tokens off;
  client_max_body_size 64k;

  # WebSocket upgrade: only send "Connection: upgrade" when the client asked for it
  map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
  }

  # HTTPS ends at the server's own nginx in production, which says so in X-Forwarded-Proto;
  # keep that, otherwise use the scheme of this request (http locally)
  map $http_x_forwarded_proto $forwarded_proto {
    default $scheme;
    https   https;
  }

  upstream app  { server app:8000; }
  upstream auth { server auth:3000; }

  server {
    listen 80;

    # sent on every response, including errors
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "same-origin" always;

    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # https on the live site (set by the server's nginx), which turns on Secure cookies
    proxy_set_header X-Forwarded-Proto $forwarded_proto;

    # Authentication goes to the auth server only. The app never sees these requests.
    location = /register { proxy_pass http://auth; }
    location = /login    { proxy_pass http://auth; }
    location = /logout   { proxy_pass http://auth; }

    # the game's WebSocket (ws:// locally, wss:// once nginx has TLS)
    location = /ws {
      proxy_pass http://app;
      # (a location that sets any proxy_set_header loses the server-level ones, so repeat them)
      proxy_set_header Host $http_host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $forwarded_proto;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_read_timeout 120s;
    }

    location / { proxy_pass http://app; }
  }
}
```
