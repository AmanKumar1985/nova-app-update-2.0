# 🌌 Nova Social App

A modern, feature-rich, full-stack social media web application built with **Node.js**, **Express**, **SQLite**, and **WebSockets**. Nova features a sleek glassmorphic UI, real-time messaging, post feeds, reels, stories, music search, YouTube Shorts integration, and responsive multi-user interactions.

![Node.js](https://img.shields.io/badge/Node.js-v18+-green?logo=node.js)
![Express](https://img.shields.io/badge/Express-4.x-blue?logo=express)
![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?logo=sqlite)
![WebSocket](https://img.shields.io/badge/Realtime-WebSockets-orange?logo=websocket)
![License](https://img.shields.io/badge/License-MIT-purple)

---

## ✨ Features

- 🔐 **User Authentication & Security**
  - Secure Signup, Login, Password Reset, and Token-based Session management.
  - Rate limiting & request sanitization.

- 📸 **Posts & Media Feed**
  - Share image/video posts with custom filters and multi-image carousels.
  - Interactive Like, Comment, Bookmark/Save, and Delete functionality.
  - Instagram-style filter support and hashtag parsing.

- 🎬 **Reels & YouTube Shorts**
  - Continuous vertical video playback for Reels.
  - Integrated YouTube Shorts search & playback backend API.

- 🎧 **Music & Audio Integration**
  - Search audio tracks and attach background music/audio to posts and stories.

- 📖 **Stories & Highlights**
  - Upload ephemeral stories and curate profile highlights.

- 💬 **Real-time Messaging (WebSockets)**
  - Direct 1-on-1 private messaging powered by WebSockets (`ws`).
  - Unread notification badges and instant chat updates.

- 👤 **Profiles & Social Graph**
  - User profiles with followers/following counts, bio customization, and avatar uploads.
  - Follow/Unfollow users and user blocking controls.

- 🎨 **Modern Futuristic UI**
  - Glowing ambient background orbs, smooth glassmorphism, responsive tab transitions, micro-animations, and full mobile support.
  - Progressive Web App (PWA) ready with `manifest.json` and Service Worker (`sw.js`).

---

## 🛠 Tech Stack

### **Backend**
- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** SQLite (`nova.db`)
- **Real-Time Communication:** WebSockets (`ws`)
- **Image Processing:** Sharp
- **Environment Management:** dotenv

### **Frontend**
- **Core:** HTML5, Modern Vanilla JavaScript (ES6+)
- **Styling:** Custom Vanilla CSS3 (Gradients, Glassmorphism, Animations, Flexbox/Grid)
- **PWA:** Service Worker (`sw.js`), Web App Manifest (`manifest.json`)

---

## 🚀 Getting Started

### **Prerequisites**
- Node.js (v18.0.0 or higher recommended)
- npm or yarn

### **Installation**

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/nova-social-app.git
   cd nova-social-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Copy `.env.example` to `.env` (if applicable) and configure your port & secret keys:
   ```bash
   cp .env.example .env
   ```

4. **Start the application:**
   - **Development mode (with auto-reload):**
     ```bash
     npm run dev
     ```
   - **Production mode:**
     ```bash
     npm start
     ```

5. **Open in browser:**
   Navigate to `http://localhost:3000` (or your configured port).

---

## 📂 Project Structure

```
nova-social-app/
├── assets/             # Static assets, icons, and media
├── uploads/            # Uploaded post images, avatars & media files
├── server.js           # Main Express & WebSocket server logic
├── nova.html           # Single Page App frontend structure & styling
├── sw.js               # Service Worker for PWA support
├── manifest.json       # Web App Manifest
├── nova.db             # SQLite database file
├── package.json        # Node dependencies & npm scripts
└── README.md           # Project documentation
```

---

## 📡 Key API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/signup` | Register a new user account |
| `POST` | `/api/auth/login` | Log in to an existing account |
| `GET` | `/api/posts` | Fetch home feed posts |
| `POST` | `/api/posts` | Create a new post or reel |
| `POST` | `/api/posts/:id/like` | Like or unlike a post |
| `GET` | `/api/reels` | Fetch video reels |
| `GET` | `/api/youtube/shorts` | Search YouTube Shorts |
| `GET` | `/api/users/:username` | Get user profile details |
| `POST` | `/api/users/:username/follow` | Follow/Unfollow a user |
| `GET` | `/api/notifications` | Get user notifications |

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!  
Feel free to check out the [issues page](https://github.com/your-username/nova-social-app/issues).

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
