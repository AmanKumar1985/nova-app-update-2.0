# Nova

Nova is a full-stack, multi-user social application. Users can create secure accounts, publish photo posts, discover and follow people, like and comment on posts, edit their profile, and exchange direct messages.

## Run locally

Requirements: Node.js 22.5 or later (Node 24 recommended).

```powershell
Copy-Item .env.example .env
npm start
```

Open `http://localhost:3000`. The server serves the website and API together. Its SQLite database is created automatically at `nova.db`; it is excluded from source control.

## Production deployment

1. Use a Node host with a persistent disk/volume. Set `DATABASE_FILE` to a path on that persistent volume. Do not use ephemeral server storage.
2. Set `PORT` from your host. Deploy this folder and run `npm install --omit=dev` followed by `npm start`.
3. Attach your custom domain and force HTTPS at the host/proxy layer.
4. Set `CORS_ORIGIN` only if a separately hosted frontend must call this API. For the included app, serve it from the same URL and leave it empty.
5. Back up the SQLite database regularly. For multiple application instances or high traffic, migrate the database to managed PostgreSQL before scaling horizontally.

## YouTube features

Copy `.env.example` to `.env` and set `YOUTUBE_API_KEY` from [Google Cloud Console](https://console.cloud.google.com/) (YouTube Data API v3 enabled). Without it, the rest of the app still works; only YouTube search and Shorts stay disabled.

## Included security controls

- Passwords are hashed with scrypt and a per-user random salt; never stored in plain text.
- Browser sessions use random, server-stored tokens and expire after 30 days.
- Private API routes require authentication.
- Login, signup, and posting endpoints have basic rate limits.
- The SQLite database and `.env` are not served as static files.
- Image uploads are validated and size-limited.
