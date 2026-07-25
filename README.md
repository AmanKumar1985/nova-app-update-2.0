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

## Android app

The Android Expo app is in [`android/`](./android). It has been validated with `expo-doctor` and exported successfully for Android.

```powershell
cd android
Copy-Item .env.example .env
# Set EXPO_PUBLIC_API_URL in .env to your deployed HTTPS backend URL.
npm run android
```

For a Play Store AAB or shareable APK, an Expo account is required for the EAS cloud build. The build profiles are already defined in `android/eas.json`.

## OTP email setup

All account verification and login uses a six-digit OTP sent to the Gmail address entered by the user. For Railway, use Resend's HTTPS email API rather than Gmail SMTP. Add these values to Railway Variables or `.env`; never commit real values to git.

- `RESEND_API_KEY` — create one at Resend after verifying your sender domain.
- `RESEND_FROM` — verified sender, for example `Nova <otp@yourdomain.com>`.

Gmail remains available as a fallback with `GMAIL_USER` and `GMAIL_APP_PASSWORD`, but SMTP can time out on hosting providers.

## Included security controls

- Gmail OTPs expire after five minutes and can only be attempted five times.
- Browser sessions use random, server-stored tokens and expire after 30 days.
- Private API routes require authentication.
- Login, signup, OTP, and posting endpoints have basic rate limits.
- The SQLite database and `.env` are not served as static files.
- Image uploads are validated and size-limited.
"# nova-app-update-2.0" 
