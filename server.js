require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DATABASE_FILE || path.join(__dirname, 'nova.db');
const db = new DatabaseSync(DB_FILE);

app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '18mb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.get(['/', '/nova.html'], (req, res) => res.sendFile(path.join(__dirname, 'nova.html')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/sw.js', (req, res) => res.sendFile(path.join(__dirname, 'sw.js')));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    password_hash TEXT, password_salt TEXT, bio TEXT NOT NULL DEFAULT '', avatar TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS follows (follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(follower_id, following_id));
  CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, image TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS likes (post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(post_id, user_id));
  CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS message_reactions (message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, emoji TEXT NOT NULL, PRIMARY KEY(message_id, user_id));
  CREATE TABLE IF NOT EXISTS stories (id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, image TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS saved_posts (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, post_id));
  CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, read_at INTEGER);
  CREATE TABLE IF NOT EXISTS highlights (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, cover TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS highlight_items (id TEXT PRIMARY KEY, highlight_id TEXT NOT NULL REFERENCES highlights(id) ON DELETE CASCADE, image TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS story_views (story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE, viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, viewed_at INTEGER NOT NULL, PRIMARY KEY(story_id, viewer_id));
  CREATE TABLE IF NOT EXISTS comment_likes (comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(comment_id, user_id));
`);
function addColumnIfMissing(table, column, definition) {
  const found = db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
  if (!found) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumnIfMissing('users', 'email', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL');
addColumnIfMissing('messages', 'reply_to', 'TEXT');
addColumnIfMissing('messages', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('messages', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('messages', 'forwarded', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('messages', 'read_at', 'INTEGER');
addColumnIfMissing('messages', 'image', 'TEXT');
addColumnIfMissing('messages', 'audio', 'TEXT');
addColumnIfMissing('users', 'is_instagram', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('posts', 'is_reel', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('posts', 'is_instagram', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('posts', 'platform', "TEXT NOT NULL DEFAULT 'nova'");
addColumnIfMissing('posts', 'external_url', 'TEXT');
addColumnIfMissing('posts', 'filter', "TEXT NOT NULL DEFAULT 'normal'");

const now = () => Date.now();
const id = () => crypto.randomUUID();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = value => String(value || '').trim();
const validUsername = value => /^[a-z0-9_.]{3,20}$/.test(value);
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPassword = value => /^\d{5}$/.test(value);
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}
function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(check, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const validImage = value => /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value) && Buffer.byteLength(value, 'utf8') <= 5 * 1024 * 1024;
const validVideo = value => (/^data:video\/(mp4|webm|quicktime|x-m4v);base64,/i.test(value) && Buffer.byteLength(value, 'utf8') <= 15 * 1024 * 1024) || /^https?:\/\/.+/i.test(value);
function publicUser(row, viewerId) {
  if (!row) return null;
  const followers = db.prepare('SELECT COUNT(*) count FROM follows WHERE following_id=?').get(row.id).count;
  const following = db.prepare('SELECT COUNT(*) count FROM follows WHERE follower_id=?').get(row.id).count;
  return { id: row.id, username: row.username, displayName: row.display_name, bio: row.bio, avatar: row.avatar, isInstagram: !!row.is_instagram, createdAt: row.created_at, followers, following, isFollowing: viewerId ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(viewerId, row.id) : false };
}
function auth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Login required.' });
  const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token), now());
  if (!session) return res.status(401).json({ error: 'Session expired. Please login again.' });
  req.user = db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id);
  if (!req.user) return res.status(401).json({ error: 'Login required.' });
  next();
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(digest(token), userId, now() + 30 * 86400000);
  return token;
}
function loginResponse(res, user) { return res.status(200).json({ token: createSession(user.id), user: publicUser(user, user.id) }); }
function notify(recipientId, actorId, type, postId = null) { if (recipientId !== actorId) db.prepare('INSERT INTO notifications (id,recipient_id,actor_id,type,post_id,created_at) VALUES (?,?,?,?,?,?)').run(id(), recipientId, actorId, type, postId, now()); }
function rateLimit(limit, windowMs) {
  const hits = new Map();
  return (req, res, next) => { const key = req.ip; const record = hits.get(key) || { n: 0, until: now() + windowMs }; if (record.until < now()) { record.n = 0; record.until = now() + windowMs; } record.n++; hits.set(key, record); if (record.n > limit) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' }); next(); };
}

const wsClients = new Map(); // userId -> Set<ws>
function wsSend(userId, payload) {
  const set = wsClients.get(userId);
  if (!set || !set.size) return;
  const data = JSON.stringify(payload);
  for (const socket of set) { if (socket.readyState === socket.OPEN) socket.send(data); }
}
function messageDto(m, viewerId) {
  const otherId = m.sender_id === viewerId ? m.recipient_id : m.sender_id;
  const other = db.prepare('SELECT username FROM users WHERE id=?').get(otherId);
  const reactionRows = db.prepare('SELECT emoji, COUNT(*) c FROM message_reactions WHERE message_id=? GROUP BY emoji').all(m.id);
  const mine = db.prepare('SELECT emoji FROM message_reactions WHERE message_id=? AND user_id=?').get(m.id, viewerId);
  let replyTo = null;
  if (m.reply_to) {
    const r = db.prepare('SELECT * FROM messages WHERE id=?').get(m.reply_to);
    if (r) replyTo = { id: r.id, text: r.deleted ? null : r.text };
  }
  let fileObj = null;
  if (m.file) { try { fileObj = JSON.parse(m.file); } catch(e) {} }
  return {
    id: m.id, text: m.deleted ? null : m.text, image: m.image || null, audio: m.audio || null, file: fileObj, createdAt: m.created_at,
    from: m.sender_id === viewerId ? 'me' : 'them', with: other ? other.username : null,
    replyTo, deleted: !!m.deleted, pinned: !!m.pinned, forwarded: !!m.forwarded, readAt: m.read_at,
    reactions: reactionRows.map(r => ({ emoji: r.emoji, count: r.c })), myReaction: mine ? mine.emoji : null
  };
}

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/unread-counts', auth, (req, res) => {
  const unreadNotifs = db.prepare('SELECT COUNT(*) c FROM notifications WHERE recipient_id=? AND read_at IS NULL').get(req.user.id).c;
  const unreadMsgs = db.prepare('SELECT COUNT(*) c FROM messages WHERE recipient_id=? AND read_at IS NULL AND deleted=0').get(req.user.id).c;
  res.json({ notifications: unreadNotifs, messages: unreadMsgs });
});
app.post('/api/auth/signup', rateLimit(10, 60000), (req, res) => {
  const username = clean(req.body.username).toLowerCase(); const displayName = clean(req.body.displayName) || username;
  const email = clean(req.body.email).toLowerCase(); const password = clean(req.body.password);
  if (!validUsername(username)) return res.status(400).json({ error: 'Username must be 3–20 lowercase letters, numbers, dots, or underscores.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid Gmail address.' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be exactly 5 digits.' });
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'This username is already taken.' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'This Gmail address already has an account.' });
  const { hash, salt } = hashPassword(password);
  const user = { id: id(), username, display_name: displayName.slice(0, 50), created_at: now(), email };
  db.prepare('INSERT INTO users (id,username,display_name,password_hash,password_salt,email,created_at) VALUES (?,?,?,?,?,?,?)').run(user.id,user.username,user.display_name,hash,salt,user.email,user.created_at);
  loginResponse(res, user);
});
app.post('/api/auth/login', rateLimit(15, 60000), (req, res) => {
  const email = clean(req.body.email).toLowerCase(); const password = clean(req.body.password);
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid Gmail address.' });
  if (!password) return res.status(400).json({ error: 'Enter your password.' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) return res.status(401).json({ error: 'Incorrect email or password.' });
  loginResponse(res, user);
});
app.post('/api/auth/logout', auth, (req, res) => { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest((req.get('authorization') || '').replace(/^Bearer\s+/i,''))); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user, req.user.id) }));
app.patch('/api/me', auth, (req, res) => { const displayName=clean(req.body.displayName); const bio=clean(req.body.bio); const avatar=req.body.avatar; if (avatar && !validImage(avatar)) return res.status(400).json({error:'Invalid avatar image.'}); db.prepare('UPDATE users SET display_name=?, bio=?, avatar=? WHERE id=?').run((displayName||req.user.display_name).slice(0,50),bio.slice(0,180),avatar || null,req.user.id); res.json({user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id),req.user.id)}); });

app.get('/api/users', auth, (req,res) => { const q=clean(req.query.q).toLowerCase(); const rows=q ? db.prepare("SELECT * FROM users WHERE id != ? AND (username LIKE ? OR lower(display_name) LIKE ?) LIMIT 30").all(req.user.id,`%${q}%`,`%${q}%`) : []; res.json({users:rows.map(row=>publicUser(row,req.user.id))}); });
app.get('/api/users/:username', auth, (req,res) => { const user=db.prepare('SELECT * FROM users WHERE username=?').get(req.params.username.toLowerCase()); if(!user)return res.status(404).json({error:'User not found.'}); const posts=db.prepare('SELECT id,image,is_reel,filter,caption,created_at FROM posts WHERE author_id=? ORDER BY created_at DESC').all(user.id).map(p=>({id:p.id,image:p.image,isReel:!!p.is_reel,filter:p.filter||'normal',caption:p.caption,createdAt:p.created_at})); const highlights=db.prepare('SELECT id,title,cover,created_at FROM highlights WHERE owner_id=? ORDER BY created_at ASC').all(user.id); res.json({user:publicUser(user,req.user.id),posts,highlights}); });
app.get('/api/users/:username/followers', auth, (req,res) => {
  const user = db.prepare('SELECT * FROM users WHERE lower(username)=?').get(req.params.username.toLowerCase());
  if(!user) return res.status(404).json({error:'User not found.'});
  const rows = db.prepare('SELECT u.* FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=?').all(user.id);
  res.json({ users: rows.map(u => publicUser(u, req.user.id)) });
});

app.get('/api/users/:username/following', auth, (req,res) => {
  const user = db.prepare('SELECT * FROM users WHERE lower(username)=?').get(req.params.username.toLowerCase());
  if(!user) return res.status(404).json({error:'User not found.'});
  const rows = db.prepare('SELECT u.* FROM follows f JOIN users u ON u.id=f.following_id WHERE f.follower_id=?').all(user.id);
  res.json({ users: rows.map(u => publicUser(u, req.user.id)) });
});

function postDto(post, viewerId) { const author=db.prepare('SELECT * FROM users WHERE id=?').get(post.author_id); return {id:post.id,image:post.image,isReel:!!post.is_reel,isInstagram:!!post.is_instagram,platform:post.platform||(post.is_instagram?'instagram':'nova'),externalUrl:post.external_url||'',filter:post.filter||'normal',caption:post.caption,createdAt:post.created_at,author:publicUser(author,viewerId),likes:db.prepare('SELECT COUNT(*) count FROM likes WHERE post_id=?').get(post.id).count,liked:!!db.prepare('SELECT 1 FROM likes WHERE post_id=? AND user_id=?').get(post.id,viewerId),saved:!!db.prepare('SELECT 1 FROM saved_posts WHERE post_id=? AND user_id=?').get(post.id,viewerId),comments:db.prepare('SELECT c.id,c.text,c.created_at,u.username,u.display_name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.created_at DESC LIMIT 3').all(post.id).reverse().map(c=>({id:c.id,text:c.text,createdAt:c.created_at,user:{username:c.username,displayName:c.display_name}}))}; }
app.get('/api/posts', auth, (req,res) => { const posts=db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 100').all(); res.json({posts:posts.map(p=>postDto(p,req.user.id))}); });
app.get('/api/reels', auth, (req,res) => { const posts=db.prepare('SELECT * FROM posts WHERE is_reel=1 ORDER BY created_at DESC LIMIT 100').all(); res.json({posts:posts.map(p=>postDto(p,req.user.id))}); });
app.post('/api/posts', auth, rateLimit(20, 60000), (req,res) => { const image=String(req.body.image||''); const caption=clean(req.body.caption); const isReel=req.body.isReel?1:0; const filter=clean(req.body.filter||'normal'); const valid = isReel ? validVideo(image) : validImage(image); if(!valid) return res.status(400).json({error: isReel ? 'Please choose an MP4 or WEBM video smaller than 12 MB.' : 'Please choose a JPG, PNG, WEBP, or GIF image smaller than 3.5 MB.'}); const post={id:id(),author_id:req.user.id,image,caption:caption.slice(0,1000),created_at:now(),is_reel:isReel,filter}; db.prepare('INSERT INTO posts (id,author_id,image,caption,created_at,is_reel,filter) VALUES (?,?,?,?,?,?,?)').run(post.id,post.author_id,post.image,post.caption,post.created_at,post.is_reel,post.filter); res.status(201).json({post:postDto(post,req.user.id)}); });
app.post('/api/posts/:id/like', auth, (req,res) => { const post=db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id); if(!post)return res.status(404).json({error:'Post not found.'}); if(post.is_instagram) return res.status(400).json({error:'Instagram posts cannot be liked.'}); const exists=db.prepare('SELECT 1 FROM likes WHERE post_id=? AND user_id=?').get(post.id,req.user.id); if(exists)db.prepare('DELETE FROM likes WHERE post_id=? AND user_id=?').run(post.id,req.user.id);else { db.prepare('INSERT INTO likes (post_id,user_id) VALUES (?,?)').run(post.id,req.user.id); notify(post.author_id,req.user.id,'like',post.id); }res.json({post:postDto(post,req.user.id)}); });
app.post('/api/posts/:id/save', auth, (req,res) => { const post=db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id); if(!post)return res.status(404).json({error:'Post not found.'}); const saved=db.prepare('SELECT 1 FROM saved_posts WHERE user_id=? AND post_id=?').get(req.user.id,post.id); if(saved)db.prepare('DELETE FROM saved_posts WHERE user_id=? AND post_id=?').run(req.user.id,post.id);else db.prepare('INSERT INTO saved_posts (user_id,post_id,created_at) VALUES (?,?,?)').run(req.user.id,post.id,now());res.json({post:postDto(post,req.user.id)}); });
app.get('/api/saved', auth, (req,res) => { const posts=db.prepare('SELECT p.* FROM saved_posts s JOIN posts p ON p.id=s.post_id WHERE s.user_id=? ORDER BY s.created_at DESC').all(req.user.id); res.json({posts:posts.map(post=>postDto(post,req.user.id))}); });
app.get('/api/music/search', auth, async (req, res) => {
  const q = clean(req.query.q || 'trending');
  try {
    const fetchRes = await fetch(`https://saavn.dev/api/search/songs?query=${encodeURIComponent(q)}&limit=30`);
    if (fetchRes.ok) {
      const data = await fetchRes.json();
      const results = (data.data && data.data.results) ? data.data.results : [];
      if (results.length > 0) {
        const songs = results.map(s => {
          const downloadUrl = (s.downloadUrl && s.downloadUrl.length) ? (s.downloadUrl[s.downloadUrl.length - 1].url || s.downloadUrl[0].url) : '';
          const image = (s.image && s.image.length) ? (s.image[s.image.length - 1].url || s.image[0].url) : '';
          const primaryArtists = s.primaryArtists || (s.artists && s.artists.primary ? s.artists.primary.map(a=>a.name).join(', ') : 'Artist');
          return {
            id: 'm_live_' + (s.id || crypto.randomUUID()),
            title: s.name || s.title || 'Song',
            artist: primaryArtists,
            duration: s.duration ? `${Math.floor(s.duration / 60)}:${String(s.duration % 60).padStart(2, '0')}` : '3:30',
            cover: image || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300',
            mp3: downloadUrl || 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
            mp4: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
          };
        });
        return res.json({ songs });
      }
    }
  } catch (e) {}
  res.json({ songs: [] });
});

// YouTube API Helper to format ISO 8601 duration (PT4M13S -> 4:13)
function formatIsoDuration(isoDuration) {
  if (!isoDuration) return '0:00';
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';
  const hours = parseInt(match[1] || 0, 10);
  const minutes = parseInt(match[2] || 0, 10);
  const seconds = parseInt(match[3] || 0, 10);
  const formattedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${formattedSeconds}`;
  }
  return `${minutes}:${formattedSeconds}`;
}

// Backend Route: YouTube Data API v3 Search (Secure Server-Side API Key execution)
app.get('/api/youtube/search', auth, async (req, res) => {
  const query = clean(req.query.q || 'trending');
  const pageToken = clean(req.query.pageToken || '');
  const apiKey = process.env.YOUTUBE_API_KEY || '';

  if (!apiKey) {
    return res.status(503).json({
      error: 'YOUTUBE_API_KEY is not set in server .env file. Please add YOUTUBE_API_KEY to your .env file to enable YouTube features.',
      videos: [],
      nextPageToken: '',
      prevPageToken: ''
    });
  }

  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(query)}&pageToken=${encodeURIComponent(pageToken)}&key=${apiKey}`;
    const searchRes = await fetch(searchUrl);

    if (!searchRes.ok) {
      const errData = await searchRes.json().catch(() => ({}));
      const msg = (errData.error && errData.error.message) ? errData.error.message : 'YouTube API request failed';
      return res.status(searchRes.status).json({ error: msg, videos: [] });
    }

    const searchData = await searchRes.json();
    const items = searchData.items || [];
    const videoIds = items.map(i => i.id.videoId).filter(Boolean);

    if (!videoIds.length) {
      return res.json({ videos: [], nextPageToken: '', prevPageToken: '' });
    }

    const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoIds.join(',')}&key=${apiKey}`;
    const detailsRes = await fetch(detailsUrl);
    let detailsMap = {};

    if (detailsRes.ok) {
      const detailsData = await detailsRes.json();
      (detailsData.items || []).forEach(item => {
        detailsMap[item.id] = item;
      });
    }

    const videos = items.map(item => {
      const vId = item.id.videoId;
      const detail = detailsMap[vId] || {};
      const snippet = detail.snippet || item.snippet || {};
      const contentDetails = detail.contentDetails || {};
      const statistics = detail.statistics || {};

      return {
        id: vId,
        title: snippet.title || 'YouTube Video',
        description: snippet.description || '',
        thumbnail: (snippet.thumbnails && snippet.thumbnails.high) ? snippet.thumbnails.high.url : `https://img.youtube.com/vi/${vId}/hqdefault.jpg`,
        channelTitle: snippet.channelTitle || 'YouTube Channel',
        publishedAt: snippet.publishedAt || new Date().toISOString(),
        duration: formatIsoDuration(contentDetails.duration),
        viewCount: statistics.viewCount ? Number(statistics.viewCount).toLocaleString() : '0'
      };
    });

    res.json({
      videos,
      nextPageToken: searchData.nextPageToken || '',
      prevPageToken: searchData.prevPageToken || ''
    });
  } catch (err) {
    console.error('YouTube Backend API Error:', err.message);
    res.status(500).json({ error: 'Failed to search YouTube videos', videos: [] });
  }
});
app.get('/api/notifications', auth, (req,res) => { const rows=db.prepare('SELECT n.*,u.username,u.display_name,u.avatar FROM notifications n JOIN users u ON u.id=n.actor_id WHERE n.recipient_id=? ORDER BY n.created_at DESC LIMIT 50').all(req.user.id); res.json({notifications:rows.map(row=>({id:row.id,type:row.type,postId:row.post_id,createdAt:row.created_at,read:!!row.read_at,actor:{username:row.username,displayName:row.display_name,avatar:row.avatar}}))}); });
app.post('/api/notifications/read', auth, (req,res) => { db.prepare('UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL').run(now(),req.user.id); res.json({ok:true}); });
app.get('/api/stories', auth, (req,res) => { const mine = req.query.mine==='1'; const rows= mine ? db.prepare('SELECT s.*,u.username,u.display_name,u.avatar FROM stories s JOIN users u ON u.id=s.author_id WHERE s.created_at>? AND s.author_id=? ORDER BY s.created_at DESC').all(now()-24*3600000, req.user.id) : db.prepare('SELECT s.*,u.username,u.display_name,u.avatar FROM stories s JOIN users u ON u.id=s.author_id WHERE s.created_at>? ORDER BY s.created_at DESC').all(now()-24*3600000); res.json({stories:rows.map(row=>({id:row.id,image:row.image,createdAt:row.created_at,author:{username:row.username,displayName:row.display_name,avatar:row.avatar}}))}); });
app.post('/api/stories', auth, rateLimit(10,60000), (req,res) => { const image=String(req.body.image||''); if(!validImage(image))return res.status(400).json({error:'Please choose a valid image.'}); const story={id:id(),author_id:req.user.id,image,created_at:now()}; db.prepare('INSERT INTO stories (id,author_id,image,created_at) VALUES (?,?,?,?)').run(story.id,story.author_id,story.image,story.created_at); res.status(201).json({story}); });
app.post('/api/stories/:id/view', auth, (req,res) => { const s=db.prepare('SELECT * FROM stories WHERE id=?').get(req.params.id); if(!s) return res.status(404).json({error:'Story not found.'}); db.prepare('INSERT OR IGNORE INTO story_views (story_id,viewer_id,viewed_at) VALUES (?,?,?)').run(s.id, req.user.id, now()); res.json({ok:true}); });
app.get('/api/stories/:id/views', auth, (req,res) => { const s=db.prepare('SELECT * FROM stories WHERE id=?').get(req.params.id); if(!s) return res.status(404).json({error:'Story not found.'}); if(s.author_id!==req.user.id) return res.status(403).json({error:'Forbidden.'}); const rows=db.prepare('SELECT v.viewed_at,u.username,u.display_name,u.avatar FROM story_views v JOIN users u ON u.id=v.viewer_id WHERE v.story_id=? ORDER BY v.viewed_at DESC').all(s.id); res.json({views:rows.map(r=>({username:r.username,displayName:r.display_name,avatar:r.avatar,viewedAt:r.viewed_at}))}); });

app.get('/api/highlights/:id', auth, (req,res) => { const h=db.prepare('SELECT * FROM highlights WHERE id=?').get(req.params.id); if(!h)return res.status(404).json({error:'Highlight not found.'}); const items=db.prepare('SELECT id,image FROM highlight_items WHERE highlight_id=? ORDER BY position ASC').all(h.id); res.json({highlight:{id:h.id,title:h.title,cover:h.cover,createdAt:h.created_at},items}); });
app.post('/api/highlights', auth, rateLimit(10,60000), (req,res) => {
  const title = clean(req.body.title).slice(0,30) || 'Highlight';
  const storyIds = Array.isArray(req.body.storyIds) ? req.body.storyIds.slice(0,50) : [];
  if (!storyIds.length) return res.status(400).json({error:'Select at least one story.'});
  const rows = storyIds.map(sid => db.prepare('SELECT * FROM stories WHERE id=? AND author_id=?').get(sid, req.user.id)).filter(Boolean);
  if (!rows.length) return res.status(400).json({error:'No valid stories selected.'});
  const hId = id();
  db.prepare('INSERT INTO highlights (id,owner_id,title,cover,created_at) VALUES (?,?,?,?,?)').run(hId, req.user.id, title, rows[0].image, now());
  rows.forEach((r,i) => db.prepare('INSERT INTO highlight_items (id,highlight_id,image,position) VALUES (?,?,?,?)').run(id(), hId, r.image, i));
  res.status(201).json({ highlight: { id:hId, title, cover: rows[0].image, createdAt: now() } });
});
app.delete('/api/highlights/:id', auth, (req,res) => { const h=db.prepare('SELECT * FROM highlights WHERE id=?').get(req.params.id); if(!h||h.owner_id!==req.user.id)return res.status(404).json({error:'Highlight not found.'}); db.prepare('DELETE FROM highlights WHERE id=?').run(h.id); res.json({ok:true}); });

app.get('/api/posts/:id/comments', auth, (req,res) => {
  const post=db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if(!post) return res.status(404).json({error:'Post not found.'});
  const comments=db.prepare('SELECT c.id,c.text,c.created_at,u.username,u.display_name,u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.created_at ASC').all(post.id);
  const list = comments.map(c => {
    const likesCount = db.prepare('SELECT COUNT(*) c FROM comment_likes WHERE comment_id=?').get(c.id).c;
    const liked = !!db.prepare('SELECT 1 FROM comment_likes WHERE comment_id=? AND user_id=?').get(c.id, req.user.id);
    return { id: c.id, text: c.text, createdAt: c.created_at, user: { username: c.username, displayName: c.display_name, avatar: c.avatar }, likesCount, liked };
  });
  res.json({ comments: list });
});
app.post('/api/comments/:id/like', auth, (req,res) => {
  const c=db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
  if(!c) return res.status(404).json({error:'Comment not found.'});
  const exists = db.prepare('SELECT 1 FROM comment_likes WHERE comment_id=? AND user_id=?').get(c.id, req.user.id);
  if(exists) db.prepare('DELETE FROM comment_likes WHERE comment_id=? AND user_id=?').run(c.id, req.user.id);
  else db.prepare('INSERT INTO comment_likes (comment_id,user_id) VALUES (?,?)').run(c.id, req.user.id);
  const likesCount = db.prepare('SELECT COUNT(*) c FROM comment_likes WHERE comment_id=?').get(c.id).c;
  const liked = !exists;
  res.json({ liked, likesCount });
});
app.post('/api/posts/:id/comments', auth, (req,res) => { const text=clean(req.body.text); const post=db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id); if(!post)return res.status(404).json({error:'Post not found.'});if(!text||text.length>500)return res.status(400).json({error:'Comment must be 1–500 characters.'});db.prepare('INSERT INTO comments (id,post_id,user_id,text,created_at) VALUES (?,?,?,?,?)').run(id(),post.id,req.user.id,text,now());res.json({post:postDto(post,req.user.id)}); });

app.get('/api/messages/:username', auth, (req,res) => {
  const targetStr = clean(req.params.username).toLowerCase();
  const partner=db.prepare('SELECT * FROM users WHERE lower(username)=? OR lower(display_name)=? OR id=?').get(targetStr, targetStr, targetStr);
  if(!partner) return res.status(404).json({error:'User not found.'});
  const unreadIds = db.prepare('SELECT id FROM messages WHERE recipient_id=? AND sender_id=? AND read_at IS NULL').all(req.user.id, partner.id);
  if (unreadIds.length) {
    db.prepare('UPDATE messages SET read_at=? WHERE recipient_id=? AND sender_id=? AND read_at IS NULL').run(now(), req.user.id, partner.id);
    wsSend(partner.id, { type:'read', from: req.user.username, at: now() });
  }
  const messages=db.prepare('SELECT * FROM messages WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND (deleted IS NULL OR deleted=0) ORDER BY created_at ASC').all(req.user.id,partner.id,partner.id,req.user.id);
  res.json({partner:publicUser(partner,req.user.id), messages: messages.map(m => messageDto(m, req.user.id))});
});
app.get('/api/messages', auth, (req,res) => {
  const rows = db.prepare(`SELECT m.* FROM messages m
    INNER JOIN (SELECT CASE WHEN sender_id=? THEN recipient_id ELSE sender_id END AS partner_id, MAX(created_at) AS latest
      FROM messages WHERE (sender_id=? OR recipient_id=?) AND (deleted IS NULL OR deleted=0) GROUP BY partner_id) latest
    ON m.created_at=latest.latest AND (m.sender_id=latest.partner_id OR m.recipient_id=latest.partner_id)
    WHERE (m.deleted IS NULL OR m.deleted=0)
    ORDER BY m.created_at DESC`).all(req.user.id, req.user.id, req.user.id);
  const seen = new Set();
  const conversations = rows.map(m => {
    const partnerId = m.sender_id === req.user.id ? m.recipient_id : m.sender_id;
    if (seen.has(partnerId)) return null;
    seen.add(partnerId);
    let fObj = null; if (m.file) { try { fObj = JSON.parse(m.file); } catch(e){} }
    const textPreview = fObj ? (fObj.isAudio ? '🎵 ' + fObj.name : '📁 ' + fObj.name) : (m.audio ? '🎙️ Voice note' : (m.image ? '📷 Photo' : m.text));
    return { partner: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(partnerId), req.user.id), text: textPreview, createdAt: m.created_at };
  }).filter(Boolean);
  res.json({ conversations });
});
app.post('/api/messages/:username', auth, rateLimit(120, 60000), (req,res) => {
  const targetStr = clean(req.params.username).toLowerCase();
  const partner=db.prepare('SELECT * FROM users WHERE lower(username)=? OR lower(display_name)=? OR id=?').get(targetStr, targetStr, targetStr);
  const text=clean(req.body.text);
  const img=req.body.image ? String(req.body.image) : null;
  const audio=req.body.audio ? String(req.body.audio) : null;
  const fileData=req.body.file ? JSON.stringify(req.body.file) : null;
  const replyTo = req.body.replyTo ? String(req.body.replyTo) : null;
  const forwarded = req.body.forwarded ? 1 : 0;
  if(!partner) return res.status(404).json({error:'User not found.'});
  if(!text && !img && !audio && !fileData) return res.status(400).json({error:'Message cannot be empty.'});
  if(text && text.length>1000) return res.status(400).json({error:'Message too long.'});
  if (img && !validImage(img)) return res.status(400).json({error:'Invalid image attachment.'});
  if (replyTo && !db.prepare('SELECT 1 FROM messages WHERE id=? AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))').get(replyTo, req.user.id, partner.id, partner.id, req.user.id)) return res.status(400).json({error:'Invalid reply.'});
  const msgId = id();
  db.prepare('INSERT INTO messages (id,sender_id,recipient_id,text,created_at,reply_to,forwarded,image,audio,file) VALUES (?,?,?,?,?,?,?,?,?,?)').run(msgId,req.user.id,partner.id,text||'',now(),replyTo,forwarded,img,audio,fileData);
  const row = db.prepare('SELECT * FROM messages WHERE id=?').get(msgId);
  wsSend(partner.id, { type:'message', message: messageDto(row, partner.id) });
  wsSend(req.user.id, { type:'message', message: messageDto(row, req.user.id), self:true });
  res.status(201).json({ message: messageDto(row, req.user.id) });
});
app.delete('/api/messages/:id', auth, (req,res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!m || m.sender_id !== req.user.id) return res.status(404).json({error:'Message not found.'});
  db.prepare('DELETE FROM messages WHERE id=?').run(m.id);
  wsSend(m.recipient_id, { type:'unsend', id:m.id });
  wsSend(m.sender_id, { type:'unsend', id:m.id, self:true });
  res.json({ ok:true });
});
app.post('/api/messages/:id/pin', auth, (req,res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!m || (m.sender_id !== req.user.id && m.recipient_id !== req.user.id)) return res.status(404).json({error:'Message not found.'});
  const pinned = m.pinned ? 0 : 1;
  db.prepare('UPDATE messages SET pinned=? WHERE id=?').run(pinned, m.id);
  const otherId = m.sender_id === req.user.id ? m.recipient_id : m.sender_id;
  wsSend(otherId, { type:'pin', id:m.id, pinned:!!pinned });
  res.json({ ok:true, pinned:!!pinned });
});
app.post('/api/messages/:id/react', auth, (req,res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!m || (m.sender_id !== req.user.id && m.recipient_id !== req.user.id)) return res.status(404).json({error:'Message not found.'});
  const emoji = clean(req.body.emoji).slice(0,8);
  const existing = db.prepare('SELECT emoji FROM message_reactions WHERE message_id=? AND user_id=?').get(m.id, req.user.id);
  db.prepare('DELETE FROM message_reactions WHERE message_id=? AND user_id=?').run(m.id, req.user.id);
  if (emoji && !(existing && existing.emoji === emoji)) db.prepare('INSERT INTO message_reactions (message_id,user_id,emoji) VALUES (?,?,?)').run(m.id, req.user.id, emoji);
  const otherId = m.sender_id === req.user.id ? m.recipient_id : m.sender_id;
  const fresh = db.prepare('SELECT * FROM messages WHERE id=?').get(m.id);
  wsSend(otherId, { type:'reaction', id:m.id, reactions: messageDto(fresh, otherId).reactions });
  res.json({ reactions: messageDto(fresh, req.user.id).reactions, myReaction: messageDto(fresh, req.user.id).myReaction });
});

app.get('*', (req,res) => {
  if (path.extname(req.path)) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname,'nova.html'));
});
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket, req) => {
  let userId = null;
  try {
    const url = new URL(req.url, 'http://internal');
    const token = url.searchParams.get('token') || '';
    const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token), now());
    if (!session) { socket.close(4001, 'Unauthorized'); return; }
    userId = session.user_id;
  } catch (e) { socket.close(); return; }
  if (!wsClients.has(userId)) wsClients.set(userId, new Set());
  wsClients.get(userId).add(socket);
  socket.on('close', () => { const set = wsClients.get(userId); if (set) { set.delete(socket); if (!set.size) wsClients.delete(userId); } });
  socket.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'typing') {
      const target = db.prepare('SELECT id FROM users WHERE username=?').get(clean(msg.to).toLowerCase());
      const me = db.prepare('SELECT username FROM users WHERE id=?').get(userId);
      if (target && me) wsSend(target.id, { type:'typing', from: me.username });
      return;
    }
    if (msg.type.startsWith('call:')) {
      const target = db.prepare('SELECT * FROM users WHERE username=?').get(clean(msg.to).toLowerCase());
      if (!target) return;
      const me = db.prepare('SELECT username,display_name,avatar FROM users WHERE id=?').get(userId);
      wsSend(target.id, { ...msg, from: me.username, fromName: me.display_name, fromAvatar: me.avatar });
    }
  });
});
function seedReelsIfEmpty() {
  try {
    db.prepare("DELETE FROM posts WHERE is_reel=1").run();
    
    const creatorNames = [
      { username: 'viral_reels', displayName: '🔥 Instagram Viral', bio: 'Official Instagram Trending Reels ⚡', isIg: 1 },
      { username: 'yt_shorts_master', displayName: '🔴 YouTube Shorts', bio: 'Trending YouTube Shorts Clips 🚀', isIg: 0 },
      { username: 'cyberpunk_vibe', displayName: '⚡ Neon IG Cyber', bio: 'Official Instagram Futuristic Clips 🌆', isIg: 1 },
      { username: 'yt_speed_drives', displayName: '🏎️ YouTube Joyrides', bio: 'YouTube Shorts Supercars & Roads 💨', isIg: 0 }
    ];

    const userIds = creatorNames.map(c => {
      let u = db.prepare('SELECT * FROM users WHERE username=?').get(c.username);
      if (!u) {
        const uId = id();
        const { hash, salt } = hashPassword('12345');
        db.prepare('INSERT INTO users (id,username,display_name,password_hash,password_salt,bio,created_at,is_instagram) VALUES (?,?,?,?,?,?,?,?)')
          .run(uId, c.username, c.displayName, hash, salt, c.bio, now(), c.isIg);
        return uId;
      }
      return u.id;
    });

    const sampleReels = [
      { authorId: userIds[0], image: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', caption: '✨ High Speed Drive 🏎️ #reels #instagram #viral', platform: 'instagram', externalUrl: 'https://www.instagram.com/reels/', isIg: 1 },
      { authorId: userIds[1], image: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', caption: '🌊 Escape to Nature 🍃 #shorts #youtube #trending', platform: 'youtube', externalUrl: 'https://www.youtube.com/shorts/3Z78y1k3W5Y', isIg: 0 },
      { authorId: userIds[2], image: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', caption: '🔥 Epic Moments ⚡ #instagram #cyberpunk', platform: 'instagram', externalUrl: 'https://www.instagram.com/reels/', isIg: 1 },
      { authorId: userIds[3], image: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', caption: '🚗 Scenic Highway Joyride 🏁 #shorts #youtube #speed', platform: 'youtube', externalUrl: 'https://www.youtube.com/shorts/5qap5aO4i9A', isIg: 0 }
    ];

    sampleReels.forEach((r, i) => {
      db.prepare('INSERT INTO posts (id,author_id,image,caption,created_at,is_reel,is_instagram,platform,external_url,filter) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id(), r.authorId, r.image, r.caption, now() - (i * 3600000), 1, r.isIg, r.platform, r.externalUrl, 'normal');
    });
  } catch(e) {}
}
seedReelsIfEmpty();

server.listen(PORT, () => console.log(`Nova is running at http://localhost:${PORT}`));
