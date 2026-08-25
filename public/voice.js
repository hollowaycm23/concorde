// Voz por canal: mesh PeerJS (áudio) + compartilhamento de tela entre os participantes
let peer = null;
let localStream = null;
let currentVoiceChannel = null;
let screenStream = null;
const voiceConnections = new Map(); // userId -> { call, audio }
const screenCalls = new Map();      // userId -> call (minha tela -> ele)

async function joinVoiceChannel(channel) {
  if (currentVoiceChannel && currentVoiceChannel.id === channel.id) return;
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (!peer) {
      peer = new Peer('user-' + currentUser.id, { debug: 0 });
      peer.on('call', onIncomingCall);
      await new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); });
    }
    currentVoiceChannel = channel;
    socket.emit('voice:join', {
      channel_id: channel.id,
      user: currentUser,
      peerId: peer.id
    });
    $('voice-panel').classList.remove('hidden');
    $('voice-panel').querySelector('.voice-header').textContent = '🔊 Voz — ' + channel.name;
    const nameEl = $('voice-channel-name');
    if (nameEl) nameEl.textContent = 'Canal: ' + channel.name;
    $('voice-users').innerHTML = '';
  } catch (e) {
    alert('Erro no microfone: ' + e.message);
    leaveVoice();
  }
}

function leaveVoice() {
  stopScreenShare(true);
  if (currentVoiceChannel) {
    socket.emit('voice:leave', { channel_id: currentVoiceChannel.id });
  }
  currentVoiceChannel = null;
  voiceConnections.forEach(c => { try { c.call.close(); } catch (e) {} c.audio.remove(); });
  voiceConnections.clear();
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
  peer?.destroy();
  peer = null;
  $('voice-panel').classList.add('hidden');
  $('voice-users').innerHTML = '';
}

// ===== CHAMADAS ENTRANTES: voz ou tela =====
function onIncomingCall(call) {
  const meta = call.metadata || {};
  if (meta.type === 'screen') {
    call.answer(); // recebe somente a tela
    call.on('stream', remote => {
      showScreenTile(meta.userId, meta.username || ('Usuário ' + meta.userId), remote);
      // limpa o tile quando o emissor parar de compartilhar
      remote.getVideoTracks().forEach(t => t.addEventListener('ended', () => removeScreenTile(meta.userId)));
      remote.addEventListener('removetrack', () => {
        if (!remote.getVideoTracks().length) removeScreenTile(meta.userId);
      });
    });
    call.on('close', () => removeScreenTile(meta.userId));
    return;
  }
  call.answer(localStream);
  handleCall(call, call.metadata?.userId);
}

socket.on('voice:user-joined', ({ user, peerId }) => {
  if (!peer || !localStream || user.id === currentUser.id) return;
  const call = peer.call(peerId, localStream, { metadata: { userId: currentUser.id } });
  handleCall(call, user.id);
  if (screenStream) sendScreenTo(user.id); // novo participante recebe a tela em andamento
});

socket.on('voice:user-left', ({ userId }) => {
  const c = voiceConnections.get(userId);
  if (c) { try { c.call.close(); } catch (e) {} c.audio.remove(); voiceConnections.delete(userId); }
  document.querySelector(`.voice-user[data-id="${userId}"]`)?.remove();
  document.querySelector(`.vu[data-id="${userId}"]`)?.remove();
});

// Alguém parou/começou a compartilhar (sinalização instantânea via socket)
socket.on('screen:state', ({ user_id, sharing }) => {
  if (!sharing) removeScreenTile(user_id);
});

// Estado dos canais de voz (sidebar): quem está em qual canal
socket.on('voice:state', ({ channel_id, users }) => {
  const wrap = document.querySelector(`.voice-channel-users[data-channel="${channel_id}"]`);
  if (wrap) {
    wrap.innerHTML = '';
    users.forEach(u => {
      const d = document.createElement('div');
      d.className = 'vu';
      d.dataset.id = u.id;
      d.innerHTML = `<span class="dot"></span><span>${u.username}</span>`;
      wrap.appendChild(d);
    });
  }
  // painel: usuários do canal atual
  if (currentVoiceChannel && currentVoiceChannel.id === channel_id) {
    const list = $('voice-users');
    if (list) {
      list.innerHTML = '';
      users.forEach(u => {
        const d = document.createElement('div');
        d.className = 'voice-user';
        d.dataset.id = u.id;
        d.innerHTML = `<div class="avatar" style="background:${u.avatar_color || '#5865F2'}">${(u.username || '?')[0].toUpperCase()}</div><span>${u.username}${u.id === currentUser.id ? ' (você)' : ''}</span>`;
        list.appendChild(d);
      });
    }
  }
});

function handleCall(call, userId) {
  call.on('stream', (remoteStream) => {
    if (voiceConnections.has(userId)) return;
    const audio = new Audio();
    audio.srcObject = remoteStream;
    audio.autoplay = true;
    voiceConnections.set(userId, { call, audio });

    // detecção de fala
    const div = document.querySelector(`.voice-user[data-id="${userId}"]`) || document.createElement('div');
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(remoteStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    setInterval(() => {
      if (!voiceConnections.has(userId)) return;
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      div.classList.toggle('speaking', avg > 20);
    }, 100);
  });
}

$('btn-voice-leave').onclick = leaveVoice;

// ===== COMPARTILHAMENTO DE TELA =====
async function startScreenShare() {
  if (!currentVoiceChannel) return alert('Entre em um canal de voz primeiro');
  if (screenStream) return;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: true
    });
  } catch (e) {
    return; // usuário cancelou o seletor
  }
  // usuário parou pelo controle do navegador/OS
  screenStream.getVideoTracks()[0]?.addEventListener('ended', () => stopScreenShare());

  // pede ao server quem está no canal p/ enviar a tela a cada um
  socket.emit('voice:who', { channel_id: currentVoiceChannel.id });
  socket.emit('screen:state', { channel_id: currentVoiceChannel.id, sharing: true });
  updateShareBtn(true);
}

// o server responde com quem está no canal -> envia a tela a cada um
socket.on('voice:who', ({ channel_id, users }) => {
  if (!screenStream || !currentVoiceChannel || currentVoiceChannel.id !== channel_id) return;
  users.filter(u => u.id !== currentUser.id).forEach(u => sendScreenTo(u.id));
});

function sendScreenTo(userId) {
  if (!peer || !screenStream) return;
  const old = screenCalls.get(userId);
  if (old) { try { old.close(); } catch (e) {} }
  const call = peer.call('user-' + userId, screenStream, {
    metadata: { userId: currentUser.id, username: currentUser.username, type: 'screen' }
  });
  screenCalls.set(userId, call);
}

function stopScreenShare(silent = false) {
  if (screenStream) {
    screenStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
    if (currentVoiceChannel && !silent) socket.emit('screen:state', { channel_id: currentVoiceChannel.id, sharing: false });
  }
  screenStream = null;
  screenCalls.forEach(c => { try { c.close(); } catch (e) {} });
  screenCalls.clear();
  removeScreenTile(currentUser.id);
  updateShareBtn(false);
}

$('btn-share-screen').onclick = () => {
  if (screenStream) stopScreenShare();
  else startScreenShare();
};

function updateShareBtn(sharing) {
  const btn = $('btn-share-screen');
  if (!btn) return;
  btn.textContent = sharing ? '⏹️ Parar Tela' : '🖥️ Compartilhar Tela';
  btn.classList.toggle('active', !!sharing);
}

// ===== GRID DE TELAS REMOTAS =====
function showScreenTile(userId, username, stream) {
  const grid = $('screen-grid');
  if (!grid) return;
  grid.classList.remove('hidden');
  let tile = grid.querySelector(`.screen-tile[data-id="${userId}"]`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'screen-tile';
    tile.dataset.id = userId;
    tile.innerHTML = `<video autoplay playsinline muted></video><div class="screen-name">🖥️ ${username}</div>`;
    grid.appendChild(tile);
  }
  const v = tile.querySelector('video');
  v.srcObject = stream;
  v.play().catch(() => {});
}

function removeScreenTile(userId) {
  const grid = $('screen-grid');
  if (!grid) return;
  grid.querySelector(`.screen-tile[data-id="${userId}"]`)?.remove();
  if (!grid.querySelector('.screen-tile')) grid.classList.add('hidden');
}