require('dotenv')?.config?.();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const webpush = require('web-push');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7
});

app.use(express.json({ limit: '10mb' }));
const UPLOADS_DIR = process.env.UPLOADS_PATH || 'uploads';
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));
// Public resolvido a partir do proprio modulo (funciona dentro do asar no Electron)
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// ===== CONFIGURAÇÕES =====
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'devsecret';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';

const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC || 'BImmoMQjxe9ZLHB0utz36FlgAGJLWAUtt87NCFAxA4l6UNPyXgfsuNVzf7L8iq_4WSKJblyvSkk1g3SjG8zYX2s',
  privateKey: process.env.VAPID_PRIVATE || 'AqJm0DJYPNXLE5Jwn258DHxZCrLlLsT9Rv6nAYJD5fY'
};
webpush.setVapidDetails('mailto:admin@concorde.app', vapidKeys.publicKey, vapidKeys.privateKey);

// ===== BANCO DE DADOS =====
const db = new Database(process.env.DB_PATH || 'concorde.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    avatar_color TEXT DEFAULT '#5865F2',
    bio TEXT DEFAULT '',
    status TEXT DEFAULT 'offline',
    custom_status TEXT DEFAULT '',
    public_key TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    endpoint TEXT UNIQUE,
    p256dh TEXT,
    auth TEXT
  );
  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    owner_id INTEGER,
    icon TEXT DEFAULT '',
    invite_code TEXT UNIQUE,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER,
    name TEXT,
    color TEXT DEFAULT '#99aab5',
    permissions INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER, server_id INTEGER, role_id INTEGER,
    PRIMARY KEY (user_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER,
    name TEXT,
    position INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER,
    category_id INTEGER,
    name TEXT,
    type TEXT DEFAULT 'text',
    position INTEGER DEFAULT 0,
    is_encrypted INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER,
    user_id INTEGER,
    content TEXT,
    encrypted TEXT,
    file_url TEXT,
    file_name TEXT,
    file_type TEXT,
    edited INTEGER DEFAULT 0,
    created_at INTEGER,
    edited_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER,
    user_id INTEGER,
    emoji TEXT,
    UNIQUE(message_id, user_id, emoji)
  );
  CREATE TABLE IF NOT EXISTS members (
    user_id INTEGER, server_id INTEGER,
    nickname TEXT,
    joined_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (user_id, server_id)
  );
  CREATE TABLE IF NOT EXISTS voice_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER,
    name TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
  CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER,
    to_id INTEGER,
    content TEXT,
    encrypted TEXT,
    file_url TEXT,
    file_name TEXT,
    file_type TEXT,
    edited INTEGER DEFAULT 0,
    created_at INTEGER,
    edited_at INTEGER
  );
`);

// Seed inicial
if (db.prepare('SELECT COUNT(*) as c FROM servers').get().c === 0) {
  db.prepare('INSERT INTO servers (name, owner_id, invite_code) VALUES (?,?,?)')
    .run('Servidor Geral', 1, 'geral-0001');
  db.prepare('INSERT INTO channels (server_id, name) VALUES (?,?)').run(1, 'geral');
  db.prepare('INSERT INTO channels (server_id, name, is_encrypted) VALUES (?,?,?)').run(1, 'privado', 1);
}

// ===== UPLOAD =====
const storage = multer.diskStorage({
  destination: UPLOADS_DIR + '/',
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// ===== ROTAS DE AUTH =====
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Campos obrigatórios' });
  if (username.length < 3) return res.status(400).json({ error: 'Usuário muito curto' });

  const hash = bcrypt.hashSync(password, 10);
  const colors = ['#5865F2', '#EB459E', '#57F287', '#FEE75C', '#ED4245', '#F47B67', '#9B59B6'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  try {
    const r = db.prepare('INSERT INTO users (username, password, avatar_color) VALUES (?,?,?)')
      .run(username, hash, color);
    const id = r.lastInsertRowid;
    db.prepare('INSERT OR IGNORE INTO members (user_id, server_id) VALUES (?,?)').run(id, 1);
    res.json({ id, username, avatar_color: color });
  } catch (e) {
    res.status(400).json({ error: 'Usuário já existe' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }
  res.json({
    id: user.id,
    username: user.username,
    avatar_color: user.avatar_color,
    public_key: user.public_key
  });
});

// ===== PERFIL =====
app.get('/api/profile/:id', (req, res) => {
  const u = db.prepare('SELECT id, username, avatar_color, bio, custom_status, public_key FROM users WHERE id=?')
    .get(req.params.id);
  res.json(u || {});
});

app.put('/api/profile', (req, res) => {
  const { user_id, bio, custom_status, avatar_color, public_key } = req.body;
  db.prepare('UPDATE users SET bio=?, custom_status=?, avatar_color=?, public_key=? WHERE id=?')
    .run(bio || '', custom_status || '', avatar_color, public_key || null, user_id);
  res.json({ ok: true });
});

// ===== SERVIDORES =====
app.get('/api/servers/:userId', (req, res) => {
  const servers = db.prepare(`
    SELECT s.* FROM servers s JOIN members m ON m.server_id = s.id
    WHERE m.user_id = ? ORDER BY s.created_at DESC
  `).all(req.params.userId);
  res.json(servers);
});

app.post('/api/servers', (req, res) => {
  const { name, owner_id } = req.body;
  const code = uuidv4().slice(0, 8);
  const r = db.prepare('INSERT INTO servers (name, owner_id, invite_code) VALUES (?,?,?)')
    .run(name, owner_id, code);
  const id = r.lastInsertRowid;
  db.prepare('INSERT INTO members (user_id, server_id) VALUES (?,?)').run(owner_id, id);
  db.prepare('INSERT INTO roles (server_id, name, color, permissions) VALUES (?,?,?,?)')
    .run(id, '@everyone', '#99aab5', 0);
  db.prepare('INSERT INTO channels (server_id, name) VALUES (?,?)').run(id, 'geral');
  db.prepare('INSERT INTO channels (server_id, name, type) VALUES (?,?,?)').run(id, 'Geral', 'voice');
  res.json({ id, name, invite_code: code });
});

app.post('/api/servers/join', (req, res) => {
  const { user_id, code } = req.body;
  const s = db.prepare('SELECT * FROM servers WHERE invite_code = ?').get(code);
  if (!s) return res.status(404).json({ error: 'Convite inválido' });
  db.prepare('INSERT OR IGNORE INTO members (user_id, server_id) VALUES (?,?)').run(user_id, s.id);
  res.json(s);
});

// Sair de um servidor (o dono não pode sair do próprio)
app.post('/api/servers/:id/leave', (req, res) => {
  const { user_id } = req.body;
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Servidor não existe' });
  if (s.owner_id === user_id) return res.status(400).json({ error: 'Você é o dono deste servidor — não é possível sair' });
  db.prepare('DELETE FROM members WHERE user_id=? AND server_id=?').run(user_id, s.id);
  res.json({ ok: true });
});

app.get('/api/servers/:id/invite', (req, res) => {
  const s = db.prepare('SELECT invite_code FROM servers WHERE id=?').get(req.params.id);
  res.json(s || {});
});

// Deletar servidor (apenas o dono; apaga canais, mensagens, cargos e membros)
app.delete('/api/servers/:id', (req, res) => {
  const { user_id } = req.body || {};
  const s = db.prepare('SELECT * FROM servers WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Servidor não existe' });
  if (s.owner_id !== user_id) return res.status(403).json({ error: 'Apenas o dono pode deletar o servidor' });
  db.prepare('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id IN (SELECT id FROM channels WHERE server_id=?))').run(s.id);
  db.prepare('DELETE FROM messages WHERE channel_id IN (SELECT id FROM channels WHERE server_id=?)').run(s.id);
  db.prepare('DELETE FROM channels WHERE server_id=?').run(s.id);
  db.prepare('DELETE FROM user_roles WHERE server_id=?').run(s.id);
  db.prepare('DELETE FROM roles WHERE server_id=?').run(s.id);
  db.prepare('DELETE FROM categories WHERE server_id=?').run(s.id);
  db.prepare('DELETE FROM members WHERE server_id=?').run(s.id);
  db.prepare('DELETE FROM servers WHERE id=?').run(s.id);
  res.json({ ok: true });
});

// ===== CANAIS =====
app.post('/api/categories', (req, res) => {
  const { server_id, name } = req.body;
  const r = db.prepare('INSERT INTO categories (server_id, name) VALUES (?,?)').run(server_id, name);
  res.json({ id: r.lastInsertRowid, name });
});

app.get('/api/channels/:serverId', (req, res) => {
  const channels = db.prepare(`
    SELECT c.*, cat.name as category_name FROM channels c
    LEFT JOIN categories cat ON cat.id = c.category_id
    WHERE c.server_id = ? ORDER BY c.position
  `).all(req.params.serverId);
  res.json(channels);
});

app.post('/api/channels', (req, res) => {
  const { server_id, name, category_id, is_encrypted, type } = req.body;
  const r = db.prepare('INSERT INTO channels (server_id, name, category_id, is_encrypted, type) VALUES (?,?,?,?,?)')
    .run(server_id, name, category_id || null, is_encrypted ? 1 : 0, type === 'voice' ? 'voice' : 'text');
  res.json({ id: r.lastInsertRowid, name, is_encrypted, type: type === 'voice' ? 'voice' : 'text' });
});

// Apagar canal (mensagens e reações junto)
app.delete('/api/channels/:id', (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id=?)').run(id);
  db.prepare('DELETE FROM messages WHERE channel_id=?').run(id);
  db.prepare('DELETE FROM channels WHERE id=?').run(id);
  res.json({ ok: true });
});

// ===== ROLES =====
app.get('/api/roles/:serverId', (req, res) => {
  res.json(db.prepare('SELECT * FROM roles WHERE server_id=?').all(req.params.serverId));
});

app.post('/api/roles', (req, res) => {
  const { server_id, name, color } = req.body;
  const r = db.prepare('INSERT INTO roles (server_id, name, color) VALUES (?,?,?)')
    .run(server_id, name, color || '#99aab5');
  res.json({ id: r.lastInsertRowid, name, color });
});

app.post('/api/roles/assign', (req, res) => {
  const { user_id, server_id, role_id } = req.body;
  db.prepare('INSERT OR IGNORE INTO user_roles VALUES (?,?,?)').run(user_id, server_id, role_id);
  res.json({ ok: true });
});

// ===== MENSAGENS =====
app.get('/api/messages/:channelId', (req, res) => {
  const msgs = db.prepare(`
    SELECT m.*, u.username, u.avatar_color FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.channel_id = ? ORDER BY m.created_at ASC LIMIT 200
  `).all(req.params.channelId);

  msgs.forEach(m => {
    m.reactions = db.prepare(`
      SELECT emoji, COUNT(*) as count,
        MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) as me
      FROM reactions WHERE message_id=? GROUP BY emoji
    `).all(req.query.userId || 0, m.id);
  });
  res.json(msgs);
});

// ===== MEMBROS =====
app.get('/api/members/:serverId', (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.username, u.avatar_color, u.status, u.custom_status, m.nickname
    FROM users u JOIN members m ON m.user_id = u.id
    WHERE m.server_id = ?
  `).all(req.params.serverId);
  res.json(members);
});

// ===== DMs (mensagens diretas) =====
// Lista de conversas do usuário (peers com última mensagem)
app.get('/api/dm/peers/:userId', (req, res) => {
  const uid = req.params.userId;
  const rows = db.prepare(`
    SELECT u.id, u.username, u.avatar_color, u.custom_status,
      (SELECT content FROM dm_messages WHERE (from_id = ? AND to_id = u.id) OR (to_id = ? AND from_id = u.id)
       ORDER BY created_at DESC LIMIT 1) AS last_content,
      (SELECT MAX(created_at) FROM dm_messages WHERE (from_id = ? AND to_id = u.id) OR (to_id = ? AND from_id = u.id)) AS last_at
    FROM users u
    WHERE u.id IN (SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END FROM dm_messages WHERE from_id = ? OR to_id = ?)
    ORDER BY last_at DESC
  `).all(uid, uid, uid, uid, uid, uid, uid);
  res.json(rows);
});

// Histórico entre dois usuários
app.get('/api/dm/:peerId/messages', (req, res) => {
  const me = req.query.userId, peer = req.params.peerId;
  const msgs = db.prepare(`
    SELECT m.*, u.username, u.avatar_color FROM dm_messages m
    JOIN users u ON u.id = m.from_id
    WHERE (m.from_id = ? AND m.to_id = ?) OR (m.from_id = ? AND m.to_id = ?)
    ORDER BY m.created_at ASC LIMIT 200
  `).all(me, peer, peer, me);
  res.json(msgs);
});

// Buscar usuário por nome (para iniciar DM)
app.get('/api/users/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(db.prepare(`
    SELECT id, username, avatar_color, custom_status FROM users
    WHERE username LIKE ? AND id != ? LIMIT 10
  `).all('%' + q + '%', req.query.me || 0));
});

// ===== PUSH =====
app.post('/api/push/subscribe', (req, res) => {
  const { user_id, subscription } = req.body;
  db.prepare(`INSERT OR REPLACE INTO push_subscriptions
    (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)`)
    .run(user_id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
  res.json({ ok: true });
});

// ===== UPLOAD =====
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sem arquivo' });
  res.json({
    url: '/uploads/' + req.file.filename,
    name: req.file.originalname,
    type: req.file.mimetype,
    size: req.file.size
  });
});

// ===== VÍDEO (LIVEKIT) =====
app.post('/api/video/token', (req, res) => {
  const { room_name, user_id, username } = req.body;

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user_id.toString(),
      name: username,
      ttl: '1h'
    });

    at.addGrant({
      roomJoin: true,
      room: room_name,
      canPublish: true,
      canSubscribe: true
    });

    res.json({
      token: at.toJwt(),
      url: LIVEKIT_URL
    });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao gerar token', details: e.message });
  }
});

// ===== SOCKET.IO =====
const onlineUsers = new Map();
const typingUsers = new Map();

io.on('connection', (socket) => {
  console.log('✅ Usuário conectado:', socket.id);

  socket.on('user:login', (user) => {
    onlineUsers.set(socket.id, user);
    socket.data.user = user;
    db.prepare('UPDATE users SET status=? WHERE id=?').run('online', user.id);
    socket.join('user:' + user.id); // sala pessoal p/ DMs
    io.emit('users:online', Array.from(onlineUsers.values()));
    io.emit('presence:update', { id: user.id, status: 'online' });
  });

  // Mensagem
  socket.on('message:send', (data) => {
    const { channel_id, content, encrypted, file, user } = data;

    const r = db.prepare(`INSERT INTO messages
      (channel_id, user_id, content, encrypted, file_url, file_name, file_type, created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(channel_id, user.id, content || '',
        encrypted ? JSON.stringify(encrypted) : null,
        file?.url || null, file?.name || null, file?.type || null, Date.now());

    const msg = {
      id: r.lastInsertRowid, channel_id, user_id: user.id,
      username: user.username, avatar_color: user.avatar_color,
      content, encrypted, file_url: file?.url, file_name: file?.name, file_type: file?.type,
      created_at: Date.now(), reactions: []
    };
    io.to('channel:' + channel_id).emit('message:new', msg);

    // Notifica menções
    const mentions = [...(content || '').matchAll(/@(\w+)/g)].map(m => m[1]);
    if (mentions.length) {
      const mentioned = db.prepare(
        `SELECT id, username FROM users WHERE username IN (${mentions.map(() => '?').join(',')})`
      ).all(...mentions);
      mentioned.forEach(u => {
        if (u.id !== user.id) {
          sendPush(u.id, `${user.username} mencionou você`, content);
        }
      });
    }
  });

  // Editar
  socket.on('message:edit', ({ message_id, content, channel_id }) => {
    db.prepare('UPDATE messages SET content=?, edited=1, edited_at=? WHERE id=? AND user_id=?')
      .run(content, Date.now(), message_id, socket.data.user?.id);
    io.to('channel:' + channel_id).emit('message:edited', { message_id, content });
  });

  // Deletar
  socket.on('message:delete', ({ message_id, channel_id }) => {
    db.prepare('DELETE FROM messages WHERE id=? AND user_id=?')
      .run(message_id, socket.data.user?.id);
    io.to('channel:' + channel_id).emit('message:deleted', { message_id });
  });

  // Reações
  socket.on('reaction:toggle', ({ message_id, emoji, channel_id, user }) => {
    const existing = db.prepare('SELECT id FROM reactions WHERE message_id=? AND user_id=? AND emoji=?')
      .get(message_id, user.id, emoji);
    if (existing) {
      db.prepare('DELETE FROM reactions WHERE id=?').run(existing.id);
    } else {
      db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)')
        .run(message_id, user.id, emoji);
    }
    io.to('channel:' + channel_id).emit('reaction:update', { message_id });
  });

  // Digitando
  socket.on('typing:start', ({ channel_id, user }) => {
    if (!typingUsers.has(channel_id)) typingUsers.set(channel_id, new Map());
    typingUsers.get(channel_id).set(user.id, user.username);
    io.to('channel:' + channel_id).emit('typing:update',
      Array.from(typingUsers.get(channel_id).values()));
  });

  socket.on('typing:stop', ({ channel_id, user }) => {
    typingUsers.get(channel_id)?.delete(user.id);
    io.to('channel:' + channel_id).emit('typing:update',
      Array.from(typingUsers.get(channel_id)?.values() || []));
  });

  // Canais
  socket.on('channel:join', (channelId) => socket.join('channel:' + channelId));
  socket.on('channel:leave', (channelId) => socket.leave('channel:' + channelId));

  // ===== DMs =====
  socket.on('dm:send', (data) => {
    const { toId, content, encrypted, file } = data;
    const me = socket.data.user;
    if (!me || !toId) return;
    const r = db.prepare(`INSERT INTO dm_messages
      (from_id, to_id, content, encrypted, file_url, file_name, file_type, created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(me.id, toId, content || '',
        encrypted ? JSON.stringify(encrypted) : null,
        file?.url || null, file?.name || null, file?.type || null, Date.now());
    const msg = {
      id: r.lastInsertRowid, from_id: me.id, to_id: Number(toId),
      username: me.username, avatar_color: me.avatar_color,
      content, encrypted, file_url: file?.url, file_name: file?.name, file_type: file?.type,
      created_at: Date.now()
    };
    io.to('user:' + toId).emit('dm:new', msg);
    socket.emit('dm:new', msg); // eco p/ o remetente
    if (content) sendPush(Number(toId), `${me.username} (mensagem direta)`, content);
  });

  socket.on('dm:typing', ({ toId, typing }) => {
    const me = socket.data.user;
    if (!me || !toId) return;
    socket.to('user:' + toId).emit('dm:typing', { from: me.id, username: me.username, typing: !!typing });
  });

  socket.on('dm:edit', ({ message_id, content }) => {
    const me = socket.data.user;
    if (!me) return;
    db.prepare('UPDATE dm_messages SET content=?, edited=1, edited_at=? WHERE id=? AND from_id=?')
      .run(content, Date.now(), message_id, me.id);
    const row = db.prepare('SELECT to_id FROM dm_messages WHERE id=?').get(message_id);
    const evt = { message_id, content };
    socket.emit('dm:edited', evt);
    if (row) io.to('user:' + row.to_id).emit('dm:edited', evt);
  });

  socket.on('dm:delete', ({ message_id }) => {
    const me = socket.data.user;
    if (!me) return;
    const row = db.prepare('SELECT to_id FROM dm_messages WHERE id=? AND from_id=?').get(message_id, me.id);
    if (!row) return;
    db.prepare('DELETE FROM dm_messages WHERE id=? AND from_id=?').run(message_id, me.id);
    const evt = { message_id };
    socket.emit('dm:deleted', evt);
    io.to('user:' + row.to_id).emit('dm:deleted', evt);
  });

  // ===== VOZ POR CANAL =====
  socket.on('voice:join', ({ channel_id, user, peerId }) => {
    // sai de salas de voz anteriores
    for (const [cid, m] of voiceUsers) {
      if (m.has(socket.id)) {
        m.delete(socket.id);
        socket.leave('voice:' + cid);
        socket.to('voice:' + cid).emit('voice:user-left', { userId: user?.id });
        broadcastVoice(cid);
      }
    }
    if (!voiceUsers.has(channel_id)) voiceUsers.set(channel_id, new Map());
    voiceUsers.get(channel_id).set(socket.id, { user, peerId });
    socket.join('voice:' + channel_id);
    // notifica os presentes p/ chamarem o novo
    socket.to('voice:' + channel_id).emit('voice:user-joined', { user, peerId });
    broadcastVoice(channel_id);
  });

  socket.on('voice:leave', ({ channel_id }) => {
    const m = voiceUsers.get(channel_id);
    if (m && m.has(socket.id)) {
      m.delete(socket.id);
      broadcastVoice(channel_id);
    }
    socket.leave('voice:' + channel_id);
    socket.to('voice:' + channel_id).emit('voice:user-left', { userId: socket.data.user?.id });
  });

  // quem está no canal (p/ o compartilhador enviar a tela a todos)
  socket.on('voice:who', ({ channel_id }) => {
    const m = voiceUsers.get(channel_id);
    const users = m ? Array.from(m.values()).map(v => v.user) : [];
    socket.emit('voice:who', { channel_id: Number(channel_id), users });
  });

  // indicador de compartilhamento de tela no canal
  socket.on('screen:state', ({ channel_id, sharing }) => {
    const me = socket.data.user;
    if (!me) return;
    socket.to('voice:' + channel_id).emit('screen:state', { channel_id, user_id: me.id, username: me.username, sharing: !!sharing });
  });

  // indicador de câmera ligada no canal
  socket.on('camera:state', ({ channel_id, sharing }) => {
    const me = socket.data.user;
    if (!me) return;
    socket.to('voice:' + channel_id).emit('camera:state', { channel_id, user_id: me.id, username: me.username, sharing: !!sharing });
  });

  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    // remove de todas as salas de voz
    for (const [cid, m] of voiceUsers) {
      if (m.has(socket.id)) {
        m.delete(socket.id);
        broadcastVoice(cid);
        socket.to('voice:' + cid).emit('voice:user-left', { userId: user?.id });
      }
    }
    if (user) {
      db.prepare('UPDATE users SET status=? WHERE id=?').run('offline', user.id);
      io.emit('presence:update', { id: user.id, status: 'offline' });
    }
    onlineUsers.delete(socket.id);
    io.emit('users:online', Array.from(onlineUsers.values()));
  });
});

// Estado de voz: quem está em cada canal (p/ sidebar)
const voiceUsers = new Map(); // channelId -> Map(socketId -> {user, peerId})
function broadcastVoice(channelId) {
  const m = voiceUsers.get(channelId);
  const users = m ? Array.from(m.values()).map(v => v.user) : [];
  io.emit('voice:state', { channel_id: Number(channelId), users });
}

function sendPush(userId, title, body) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').all(userId);
  subs.forEach(s => {
    webpush.sendNotification({
      endpoint: s.endpoint,
      keys: { p256dh: s.p256dh, auth: s.auth }
    }, JSON.stringify({ title, body })).catch(() => {});
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Concorde v3 rodando em http://localhost:${PORT}`);
  console.log('📦 Módulos ativos: Auth, Chat, Voz, Vídeo, E2E, Temas, Push');
});

