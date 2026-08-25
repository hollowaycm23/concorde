const socket = io();
let currentUser = null, currentServer = null, currentChannel = null;
let currentDM = null, dmMode = false;
let pendingFile = null;
let typingTimeout = null;

const $ = id => document.getElementById(id);
const modal = $('modal');
const modalContent = $('modal-content');

// AUTH
let pendingInvite = null;
$('btn-login').onclick = () => auth('login');
$('btn-register').onclick = () => auth('register');

async function joinByInvite(code) {
  const r = await (await fetch('/api/servers/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: currentUser.id, code })
  })).json();
  if (r.error) return alert(r.error);
  loadServers();
}

$('btn-join-invite').onclick = async () => {
  const code = await showPrompt('Entrar com convite', 'Código do convite');
  if (!code) return;
  if (currentUser) return joinByInvite(code);
  // sem login: guarda o código e aplica após entrar
  pendingInvite = code;
  $('auth-error').textContent = 'Entre ou crie uma conta — o convite será aplicado automaticamente.';
};

async function auth(action) {
  const res = await fetch('/api/' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: $('auth-username').value, password: $('auth-password').value })
  });
  const data = await res.json();
  if (data.error) return $('auth-error').textContent = data.error;
  login(data);
}

$('btn-logout').onclick = () => { localStorage.removeItem('user'); location.reload(); };
$('btn-theme').onclick = toggleTheme;

async function login(user) {
  currentUser = user;
  localStorage.setItem('user', JSON.stringify(user));
  socket.emit('user:login', user);
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('user-info').innerHTML = `
    <div class="avatar" style="background:${user.avatar_color}">${user.username[0].toUpperCase()}</div>
    <div style="flex:1">
      <div style="color:#fff;font-weight:600">${user.username}</div>
      <div style="color:#949ba4;font-size:11px">Online</div>
    </div>`;
  try { if (typeof initE2E === 'function') await initE2E(); } catch (e) { console.warn('E2E indisponível:', e); }
  if (pendingInvite) { const c = pendingInvite; pendingInvite = null; joinByInvite(c); }
  await loadServers();
  await loadDMs();
  registerPush();
}

// ===== DMs =====
async function loadDMs() {
  const peers = await (await fetch(`/api/dm/peers/${currentUser.id}`)).json();
  const list = $('dm-list');
  list.innerHTML = '';
  peers.forEach(p => {
    const d = document.createElement('div');
    d.className = 'dm-item' + (currentDM && currentDM.id === p.id ? ' active' : '');
    d.innerHTML = `
      <div class="avatar" style="background:${p.avatar_color}">${p.username[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="color:inherit">${p.username}</div>
        <div class="last">${(p.last_content || '').slice(0, 40)}</div>
      </div>`;
    d.onclick = () => selectDM(p);
    list.appendChild(d);
  });
}

async function selectDM(peer) {
  dmMode = true;
  currentDM = peer;
  if (currentChannel) socket.emit('channel:leave', currentChannel.id);
  currentChannel = null;
  document.querySelectorAll('.channel').forEach(e => e.classList.remove('active'));
  document.querySelectorAll('.dm-item').forEach(e => e.classList.remove('active'));
  event?.target?.closest?.('.dm-item')?.classList?.add('active');
  $('chat-header').firstChild.textContent = `👤 ${peer.username}`;
  $('encryption-badge').classList.add('hidden');
  $('msg-input').placeholder = `Mensagem para ${peer.username}`;
  const msgs = await (await fetch(`/api/dm/${peer.id}/messages?userId=${currentUser.id}`)).json();
  $('messages').innerHTML = '';
  for (const m of msgs) {
    const dec = await decryptIfNeeded(m);
    renderMessage(dec, true);
  }
  scrollBottom();
}

window.openDmModal = () => {
  showModal(`
    <h2>Nova mensagem direta</h2>
    <input id="dm-search" placeholder="Buscar usuário..." oninput="searchUsers()" />
    <div id="dm-search-results"></div>
    <button class="secondary" onclick="closeModal()">Fechar</button>
  `);
  $('btn-new-dm')?.blur();
};

window.searchUsers = async () => {
  const q = $('dm-search').value.trim();
  if (!q) return $('dm-search-results').innerHTML = '';
  const users = await (await fetch(`/api/users/search?q=${encodeURIComponent(q)}&me=${currentUser.id}`)).json();
  $('dm-search-results').innerHTML = users.map(u => `
    <div class="dm-item" onclick="startDM(${u.id},'${u.username}','${u.avatar_color}')">
      <div class="avatar" style="background:${u.avatar_color}">${u.username[0].toUpperCase()}</div>
      <span>${u.username}</span>
    </div>`).join('');
};

window.startDM = async (id, username, color) => {
  closeModal();
  await selectDM({ id, username, avatar_color: color });
  loadDMs();
};

// Clique num membro → abrir DM
window.memberClick = (id, username, color) => {
  if (id === currentUser.id) return;
  startDM(id, username, color);
};

$('btn-new-dm').onclick = openDmModal;

$('btn-profile').onclick = async () => {
  const p = await (await fetch('/api/profile/' + currentUser.id)).json();
  showModal(`
    <h2>Editar perfil</h2>
    <label>Bio</label>
    <textarea id="p-bio" rows="3">${p.bio || ''}</textarea>
    <label>Status personalizado</label>
    <input id="p-status" value="${p.custom_status || ''}" />
    <label>Cor do avatar</label>
    <input type="color" id="p-color" value="${p.avatar_color}" />
    <button onclick="saveProfile()">Salvar</button>
    <button class="secondary" onclick="closeModal()">Cancelar</button>
  `);
};

window.saveProfile = async () => {
  await fetch('/api/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: currentUser.id,
      bio: $('p-bio').value,
      custom_status: $('p-status').value,
      avatar_color: $('p-color').value
    })
  });
  currentUser.avatar_color = $('p-color').value;
  localStorage.setItem('user', JSON.stringify(currentUser));
  closeModal();
  login(currentUser);
};

window.closeModal = () => modal.classList.add('hidden');
function showModal(html) { modalContent.innerHTML = html; modal.classList.remove('hidden'); }

// ===== Modais proprios: seletor de tipo de canal (Electron NAO suporta prompt/confirm) =====
window.showChannelModal = () => {
  return new Promise(resolve => {
    showModal(
      '<h2>Criar canal</h2>' +
      '<input id="modal-ch-name" placeholder="Nome do canal"' +
      ' style="width:100%;padding:10px;background:var(--bg-tertiary);border:none;border-radius:4px;color:#fff;margin-bottom:12px" />' +
      '<div style="display:flex;gap:8px;margin-bottom:12px">' +
      '<button id="modal-ch-text" style="flex:1"># Texto</button>' +
      '<button id="modal-ch-voice" style="flex:1">🔊 Voz</button>' +
      '</div>' +
      '<button class="secondary" id="modal-cancel" style="width:100%">Cancelar</button>'
    );
    const input = $('modal-ch-name');
    input.focus();
    const done = type => {
      const name = input.value.trim();
      closeModal();
      resolve(name ? { name: name, type: type } : null);
    };
    $('modal-ch-text').onclick = () => done('text');
    $('modal-ch-voice').onclick = () => done('voice');
    $('modal-cancel').onclick = () => { closeModal(); resolve(null); };
    input.onkeydown = e => {
      if (e.key === 'Enter') done('text');
      if (e.key === 'Escape') { closeModal(); resolve(null); }
    };
  });
};

// prompt() nao existe no Electron — modais proprios
function showPrompt(title, placeholder = '', value = '') {
  return new Promise((resolve) => {
    modalContent.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      <input id="prompt-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value || '')}"
        style="width:100%;padding:10px;background:var(--bg-tertiary);border:none;border-radius:4px;color:#fff;margin-bottom:10px" />
      <button id="prompt-ok">OK</button>
      <button class="secondary" id="prompt-cancel">Cancelar</button>`;
    modal.classList.remove('hidden');
    const input = $('prompt-input');
    input.focus();
    input.select();
    const done = (v) => { modal.classList.add('hidden'); resolve(v); };
    $('prompt-ok').onclick = () => done(input.value.trim());
    $('prompt-cancel').onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim());
      if (e.key === 'Escape') done(null);
    };
  });
}

function showConfirm(msg, okLabel = 'OK', cancelLabel = 'Cancelar') {
  return new Promise((resolve) => {
    modalContent.innerHTML = `
      <h2 style="font-size:16px">${escapeHtml(msg)}</h2>
      <button id="c-ok">${okLabel}</button>
      <button class="secondary" id="c-no">${cancelLabel}</button>`;
    modal.classList.remove('hidden');
    $('c-ok').onclick = () => { modal.classList.add('hidden'); resolve(true); };
    $('c-no').onclick = () => { modal.classList.add('hidden'); resolve(false); };
  });
}

// SERVIDORES
async function loadServers() {
  const servers = await (await fetch(`/api/servers/${currentUser.id}`)).json();
  const list = $('server-list');
  list.innerHTML = '';
  servers.forEach(s => {
    const div = document.createElement('div');
    div.className = 'server-icon';
    div.textContent = s.name[0].toUpperCase();
    div.title = s.name + (s.owner_id === currentUser.id ? ' (você é o dono — clique direito para deletar)' : ' (clique direito para sair)');
    div.onclick = () => selectServer(s, div);
    div.oncontextmenu = (e) => { e.preventDefault(); serverAction(s); };
    list.appendChild(div);
  });
  const add = document.createElement('div');
  add.className = 'server-icon add';
  add.textContent = '+';
  add.onclick = async () => {
    const name = await showPrompt('Novo servidor', 'Nome do servidor');
    if (!name) return;
    await fetch('/api/servers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, owner_id: currentUser.id })
    });
    loadServers();
  };
  list.appendChild(add);
  if (servers.length) selectServer(servers[0], list.firstChild);
}

async function selectServer(server, el) {
  currentServer = server;
  document.querySelectorAll('.server-icon').forEach(e => e.classList.remove('active'));
  el?.classList?.add('active');
  $('server-name').firstChild.textContent = server.name;
  const channels = await (await fetch(`/api/channels/${server.id}`)).json();

  const list = $('channel-list');
  list.innerHTML = '';
  const grouped = {};
  channels.forEach(c => {
    const cat = c.category_name || 'Sem categoria';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(c);
  });
  Object.entries(grouped).forEach(([cat, chs]) => {
    const h = document.createElement('div');
    h.className = 'category-header';
    h.innerHTML = `<span>▼ ${cat}</span><span onclick="addChannel(${server.id}, ${chs[0].category_id || 'null'})">+</span>`;
    list.appendChild(h);
    chs.forEach(c => {
      const d = document.createElement('div');
      d.className = 'channel' + (c.type === 'voice' ? ' voice' : '');
      d.innerHTML = `${c.type === 'voice' ? '🔊' : '#'} ${c.name}${c.is_encrypted ? ' 🔒' : ''}`;
      const x = document.createElement('span');
      x.className = 'ch-del';
      x.textContent = '✕';
      x.title = 'Apagar canal';
      x.onclick = async (ev) => {
        ev.stopPropagation();
        if (!(await showConfirm(`Apagar o canal "${c.name}"? As mensagens dele serão perdidas.`, 'Apagar'))) return;
        if (currentVoiceChannel && currentVoiceChannel.id === c.id) leaveVoice();
        if (currentChannel && currentChannel.id === c.id) { currentChannel = null; $('messages').innerHTML = ''; }
        await fetch('/api/channels/' + c.id, { method: 'DELETE' });
        selectServer(currentServer);
      };
      d.appendChild(x);
      d.onclick = () => selectChannel(c, d);
      list.appendChild(d);
      if (c.type === 'voice') {
        const vu = document.createElement('div');
        vu.className = 'voice-channel-users';
        vu.dataset.channel = c.id;
        list.appendChild(vu);
      }
    });
  });
  if (channels.length) selectChannel(channels[0], list.querySelector('.channel'));
  loadMembers();
}

window.addChannel = async (serverId, catId) => {
  const res = await showChannelModal();
  if (!res) return;
  await fetch('/api/channels', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server_id: serverId, name: res.name, category_id: catId, type: res.type })
  });
  selectServer(currentServer);
};

$('btn-invite').onclick = async () => {
  const { invite_code } = await (await fetch(`/api/servers/${currentServer.id}/invite`)).json();
  navigator.clipboard.writeText(invite_code);
  alert('Código copiado: ' + invite_code);
};

// Sair (membro) ou deletar (dono) servidor
async function serverAction(s) {
  const isOwner = s.owner_id === currentUser.id;
  if (isOwner) {
    if (!(await showConfirm(`Deletar o servidor "${s.name}"? Todos os canais e mensagens serão perdidos para todos.`, 'Deletar'))) return;
    if (currentVoiceChannel) leaveVoice();
    await fetch('/api/servers/' + s.id, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id })
    });
  } else {
    if (!(await showConfirm(`Sair do servidor "${s.name}"?`, 'Sair'))) return;
    if (currentVoiceChannel) leaveVoice();
    await fetch('/api/servers/' + s.id + '/leave', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id })
    });
  }
  if (currentServer && currentServer.id === s.id) {
    currentServer = null; currentChannel = null;
    $('messages').innerHTML = '';
    $('chat-header').firstChild.textContent = '# —';
  }
  loadServers();
}
window.serverAction = serverAction;

$('btn-leave-server').onclick = () => {
  if (currentServer) serverAction(currentServer);
};

$('btn-roles').onclick = async () => {
  const roles = await (await fetch(`/api/roles/${currentServer.id}`)).json();
  showModal(`
    <h2>Cargos de ${currentServer.name}</h2>
    ${roles.map(r => `<div><span class="role-badge" style="background:${r.color}33;color:${r.color}">${r.name}</span></div>`).join('')}
    <hr style="margin:12px 0;border-color:#3f4147">
    <input id="new-role-name" placeholder="Novo cargo" />
    <input type="color" id="new-role-color" value="#5865F2" />
    <button onclick="createRole()">Criar</button>
    <button class="secondary" onclick="closeModal()">Fechar</button>
  `);
};

window.createRole = async () => {
  await fetch('/api/roles', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      server_id: currentServer.id,
      name: $('new-role-name').value,
      color: $('new-role-color').value
    })
  });
  $('btn-roles').click();
};

// CANAIS
async function selectChannel(channel, el) {
  // Canal de voz: entra na voz e mantém o chat atual
  if (channel.type === 'voice') {
    joinVoiceChannel(channel);
    return;
  }
  dmMode = false;
  currentDM = null;
  if (currentChannel) socket.emit('channel:leave', currentChannel.id);
  currentChannel = channel;
  document.querySelectorAll('.channel').forEach(e => e.classList.remove('active'));
  el?.classList?.add('active');
  $('chat-header').firstChild.textContent = `# ${channel.name}`;
  $('encryption-badge').classList.toggle('hidden', !channel.is_encrypted);
  $('msg-input').placeholder = `Conversar em #${channel.name}`;
  socket.emit('channel:join', channel.id);
  const msgs = await (await fetch(`/api/messages/${channel.id}?userId=${currentUser.id}`)).json();
  $('messages').innerHTML = '';
  for (const m of msgs) {
    const decrypted = await decryptIfNeeded(m);
    renderMessage(decrypted);
  }
  scrollBottom();
}

function renderMessage(m, isDM = false) {
  const div = document.createElement('div');
  div.className = 'message' + (m.edited ? ' edited' : '');
  div.dataset.id = m.id;
  const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  let content = escapeHtml(m.content || '').replace(/@(\w+)/g,
    '<span style="background:#5865f233;color:#c9cdfb;padding:0 2px;border-radius:3px">@$1</span>');

  let fileHtml = '';
  if (m.file_url) {
    if (m.file_type?.startsWith('image/')) {
      fileHtml = `<div class="file-attachment"><img src="${m.file_url}" alt="${m.file_name}"></div>`;
    } else {
      fileHtml = `<div class="file-attachment">📄 <a href="${m.file_url}" target="_blank">${m.file_name}</a></div>`;
    }
  }

  const actions = isDM
    ? (m.user_id === currentUser.id || m.from_id === currentUser.id ? `
      <button onclick="editDM(${m.id})">✏️</button>
      <button onclick="deleteDM(${m.id})">🗑️</button>` : '')
    : `
      <button onclick="addReaction(${m.id})">😀</button>
      ${m.user_id === currentUser.id ? `
        <button onclick="editMessage(${m.id})">✏️</button>
        <button onclick="deleteMessage(${m.id})">🗑️</button>` : ''}`;

  div.innerHTML = `
    <div class="avatar" style="background:${m.avatar_color}">${m.username[0].toUpperCase()}</div>
    <div class="message-body" style="flex:1">
      <span class="username" style="color:${m.avatar_color}">${m.username}</span>
      <span class="time">${time}</span>
      <div class="content">${content}</div>
      ${fileHtml}
      ${isDM ? '' : `<div class="reactions" data-msg="${m.id}"></div>`}
    </div>
    <div class="msg-actions">${actions}</div>`;
  $('messages').appendChild(div);
  if (!isDM) renderReactions(m.id, m.reactions || []);
}

window.editDM = async (msgId) => {
  const el = document.querySelector(`.message[data-id="${msgId}"] .content`);
  const current = el.textContent.replace(' (editado)', '');
  const newContent = await showPrompt('Editar mensagem', 'Mensagem', current);
  if (newContent && newContent !== current) {
    socket.emit('dm:edit', { message_id: msgId, content: newContent, peerId: currentDM.id });
  }
};

window.deleteDM = async (msgId) => {
  if (await showConfirm('Deletar mensagem?', 'Deletar')) {
    socket.emit('dm:delete', { message_id: msgId, peerId: currentDM.id });
  }
};

function renderReactions(msgId, reactions) {
  const container = document.querySelector(`.reactions[data-msg="${msgId}"]`);
  if (!container) return;
  container.innerHTML = '';
  reactions.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'reaction' + (r.me ? ' me' : '');
    btn.textContent = `${r.emoji} ${r.count}`;
    btn.onclick = () => toggleReaction(msgId, r.emoji);
    container.appendChild(btn);
  });
}

window.addReaction = async (msgId) => {
  const emoji = await showPrompt('Reagir', 'Emoji (ex: 👍 ❤️ 🔥)');
  if (emoji) toggleReaction(msgId, emoji.trim());
};

function toggleReaction(msgId, emoji) {
  socket.emit('reaction:toggle', {
    message_id: msgId, emoji, channel_id: currentChannel.id, user: currentUser
  });
}

window.editMessage = async (msgId) => {
  const msg = document.querySelector(`.message[data-id="${msgId}"] .content`);
  const current = msg.textContent.replace(' (editado)', '');
  const newContent = await showPrompt('Editar mensagem', 'Mensagem', current);
  if (newContent && newContent !== current) {
    socket.emit('message:edit', { message_id: msgId, content: newContent, channel_id: currentChannel.id });
  }
};

window.deleteMessage = async (msgId) => {
  if (await showConfirm('Deletar mensagem?', 'Deletar')) {
    socket.emit('message:delete', { message_id: msgId, channel_id: currentChannel.id });
  }
};

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function scrollBottom() { const m = $('messages'); m.scrollTop = m.scrollHeight; }

// INPUT
$('btn-attach').onclick = () => $('file-input').click();
$('file-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  pendingFile = await res.json();
  $('msg-input').placeholder = `Enviando: ${pendingFile.name} (pressione Enter)`;
};

async function sendMessage() {
  const input = $('msg-input');
  const content = input.value.trim();
  if (!content && !pendingFile) return;

  if (dmMode && currentDM) {
    const { content: finalContent, encrypted } = await encryptIfNeeded(
      'dm:' + currentDM.id, content, false
    );
    socket.emit('dm:send', {
      toId: currentDM.id,
      content: finalContent,
      encrypted,
      file: pendingFile
    });
    input.value = '';
    pendingFile = null;
    socket.emit('dm:typing', { toId: currentDM.id, typing: false });
    return;
  }

  if (!currentChannel) return;

  const { content: finalContent, encrypted } = await encryptIfNeeded(
    currentChannel.id, content, currentChannel.is_encrypted
  );

  socket.emit('message:send', {
    channel_id: currentChannel.id,
    content: finalContent,
    encrypted,
    file: pendingFile,
    user: currentUser
  });
  input.value = '';
  pendingFile = null;
  $('msg-input').placeholder = `Conversar em #${currentChannel.name}`;
  socket.emit('typing:stop', { channel_id: currentChannel.id, user: currentUser });
}

$('btn-send').onclick = sendMessage;
$('msg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

$('msg-input').addEventListener('input', () => {
  if (dmMode && currentDM) {
    socket.emit('dm:typing', { toId: currentDM.id, typing: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('dm:typing', { toId: currentDM.id, typing: false });
    }, 2000);
    return;
  }
  if (!currentChannel) return;
  socket.emit('typing:start', { channel_id: currentChannel.id, user: currentUser });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing:stop', { channel_id: currentChannel.id, user: currentUser });
  }, 2000);
});

socket.on('dm:typing', ({ from, username, typing }) => {
  if (dmMode && currentDM && currentDM.id === from) {
    $('dm-typing').textContent = typing ? `${username} está digitando...` : '';
  }
});

socket.on('dm:new', async (m) => {
  // render se a DM aberta é a conversa da mensagem
  const peerId = dmMode && currentDM ? currentDM.id : null;
  if (peerId && (m.from_id === peerId || m.to_id === peerId)) {
    const dec = await decryptIfNeeded(m);
    renderMessage(dec, true);
    scrollBottom();
  }
  loadDMs();
});

socket.on('typing:update', (users) => {
  const filtered = users.filter(u => u !== currentUser.username);
  $('typing-indicator').textContent = filtered.length
    ? `${filtered.join(', ')} está digitando...`
    : '';
});

socket.on('message:new', async (m) => {
  if (currentChannel && m.channel_id === currentChannel.id) {
    const decrypted = await decryptIfNeeded(m);
    renderMessage(decrypted);
    scrollBottom();
  }
});
socket.on('message:edited', ({ message_id, content }) => {
  const el = document.querySelector(`.message[data-id="${message_id}"] .content`);
  if (el) { el.textContent = content; el.parentElement.parentElement.classList.add('edited'); }
});
socket.on('message:deleted', ({ message_id }) => {
  document.querySelector(`.message[data-id="${message_id}"]`)?.remove();
});
socket.on('dm:edited', ({ message_id, content }) => {
  const el = document.querySelector(`.message[data-id="${message_id}"] .content`);
  if (el) { el.textContent = content; el.parentElement.parentElement.classList.add('edited'); }
});
socket.on('dm:deleted', ({ message_id }) => {
  document.querySelector(`.message[data-id="${message_id}"]`)?.remove();
  loadDMs();
});
socket.on('reaction:update', async ({ message_id }) => {
  const msgs = await (await fetch(`/api/messages/${currentChannel.id}?userId=${currentUser.id}`)).json();
  const m = msgs.find(x => x.id === message_id);
  if (m) renderReactions(message_id, m.reactions);
});

// MEMBROS
async function loadMembers() {
  const members = await (await fetch(`/api/members/${currentServer.id}`)).json();
  const list = $('members-list');
  list.innerHTML = '';
  members.forEach(m => {
    const d = document.createElement('div');
    d.className = 'member';
    d.dataset.id = m.id;
    d.innerHTML = `
      <div class="avatar" style="background:${m.avatar_color}">${m.username[0].toUpperCase()}</div>
      <div>
        <div style="color:#fff">${m.nickname || m.username}</div>
        ${m.custom_status ? `<div style="font-size:11px;color:#949ba4">${m.custom_status}</div>` : ''}
      </div>`;
    d.onclick = () => memberClick(m.id, m.nickname || m.username, m.avatar_color);
    d.title = 'Clique para enviar mensagem direta';
    list.appendChild(d);
  });
}

socket.on('users:online', (users) => $('online-count').textContent = users.length);
socket.on('presence:update', ({ id, status }) => {
  const el = document.querySelector(`.member[data-id="${id}"]`);
  if (el) el.querySelector('.avatar').style.opacity = status === 'online' ? '1' : '0.5';
});

// PUSH
async function registerPush() {
  if (!('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: 'BImmoMQjxe9ZLHB0utz36FlgAGJLWAUtt87NCFAxA4l6UNPyXgfsuNVzf7L8iq_4WSKJblyvSkk1g3SjG8zYX2s'
    });
    await fetch('/api/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id, subscription: sub.toJSON() })
    });
  } catch (e) { console.log('Push não disponível', e); }
}

// AUTO-LOGIN
const saved = localStorage.getItem('user');
if (saved) login(JSON.parse(saved));