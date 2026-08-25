// Voz por canal: mesh PeerJS (áudio) + compartilhamento de tela entre os participantes
let peer = null;
let localStream = null;
let currentVoiceChannel = null;
let screenStream = null;
let cameraStream = null;
const voiceConnections = new Map(); // userId -> { call, audio }
const screenCalls = new Map();      // userId -> call (minha tela -> ele)
const cameraCalls = new Map();      // userId -> call (minha câmera -> ele)

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
  stopCamera(true);
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

// ===== CHAMADAS ENTRANTES: voz, tela ou câmera =====
function onIncomingCall(call) {
  const meta = call.metadata || {};
  if (meta.type === 'screen') {
    call.answer(); // recebe somente a tela
    call.on('stream', remote => {
      showMediaTile('scr', meta.userId, meta.username || ('Usuário ' + meta.userId), remote, '🖥️');
      remote.getVideoTracks().forEach(t => t.addEventListener('ended', () => removeMediaTile('scr', meta.userId)));
      remote.addEventListener('removetrack', () => {
        if (!remote.getVideoTracks().length) removeMediaTile('scr', meta.userId);
      });
    });
    call.on('close', () => removeMediaTile('scr', meta.userId));
    return;
  }
  if (meta.type === 'camera') {
    call.answer(); // recebe somente o vídeo
    call.on('stream', remote => {
      showMediaTile('cam', meta.userId, meta.username || ('Usuário ' + meta.userId), remote, '📹');
      remote.getVideoTracks().forEach(t => t.addEventListener('ended', () => removeMediaTile('cam', meta.userId)));
      remote.addEventListener('removetrack', () => {
        if (!remote.getVideoTracks().length) removeMediaTile('cam', meta.userId);
      });
    });
    call.on('close', () => removeMediaTile('cam', meta.userId));
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
  if (cameraStream) sendCameraTo(user.id); // e a câmera
});

socket.on('voice:user-left', ({ userId }) => {
  const c = voiceConnections.get(userId);
  if (c) { try { c.call.close(); } catch (e) {} c.audio.remove(); voiceConnections.delete(userId); }
  document.querySelector(`.voice-user[data-id="${userId}"]`)?.remove();
  document.querySelector(`.vu[data-id="${userId}"]`)?.remove();
  removeMediaTile('scr', userId);
  removeMediaTile('cam', userId);
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
    // NotAllowedError = cancelou o picker; outros erros = avisa
    if (!e || e.name !== 'NotAllowedError') {
      alert('Falha ao compartilhar tela: ' + (e?.message || e));
    }
    return;
  }
  // usuário parou pelo controle do navegador/OS
  screenStream.getVideoTracks()[0]?.addEventListener('ended', () => stopScreenShare());

  // pede ao server quem está no canal p/ enviar a tela a cada um
  socket.emit('voice:who', { channel_id: currentVoiceChannel.id });
  socket.emit('screen:state', { channel_id: currentVoiceChannel.id, sharing: true });
  showMediaTile('scr', currentUser.id, currentUser.username + ' (você)', screenStream, '🖥️');
  updateShareBtn(true);
}

// o server responde com quem está no canal -> envia tela e câmera a cada um
socket.on('voice:who', ({ channel_id, users }) => {
  if (!currentVoiceChannel || currentVoiceChannel.id !== channel_id) return;
  users.filter(u => u.id !== currentUser.id).forEach(u => {
    if (screenStream) sendScreenTo(u.id);
    if (cameraStream) sendCameraTo(u.id);
  });
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
  removeMediaTile('scr', currentUser.id);
  updateShareBtn(false);
}

$('btn-share-screen').onclick = () => {
  if (screenStream) stopScreenShare();
  else startScreenShare();
};

$('btn-camera').onclick = () => {
  if (cameraStream) stopCamera();
  else toggleCamera();
};

function updateCamBtn(on) {
  const btn = $('btn-camera');
  if (!btn) return;
  btn.textContent = on ? '⏹️ Desligar Câmera' : '📹 Câmera';
  btn.classList.toggle('active', !!on);
}

// ===== CÂMERA P2P =====
async function toggleCamera() {
  if (!currentVoiceChannel) return alert('Entre em um canal de voz primeiro');
  if (cameraStream) return stopCamera();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640 }, audio: false });
  } catch (e) {
    return alert('Falha ao acessar a câmera: ' + (e?.message || e));
  }
  cameraStream.getVideoTracks()[0]?.addEventListener('ended', () => stopCamera());
  socket.emit('voice:who', { channel_id: currentVoiceChannel.id });
  socket.emit('camera:state', { channel_id: currentVoiceChannel.id, sharing: true });
  showMediaTile('cam', currentUser.id, currentUser.username + ' (você)', cameraStream, '📹');
  updateCamBtn(true);
}

function sendCameraTo(userId) {
  if (!peer || !cameraStream) return;
  const old = cameraCalls.get(userId);
  if (old) { try { old.close(); } catch (e) {} }
  const call = peer.call('user-' + userId, cameraStream, {
    metadata: { userId: currentUser.id, username: currentUser.username, type: 'camera' }
  });
  cameraCalls.set(userId, call);
}

function stopCamera(silent = false) {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
    if (currentVoiceChannel && !silent) socket.emit('camera:state', { channel_id: currentVoiceChannel.id, sharing: false });
  }
  cameraStream = null;
  cameraCalls.forEach(c => { try { c.close(); } catch (e) {} });
  cameraCalls.clear();
  removeMediaTile('cam', currentUser.id);
  updateCamBtn(false);
}

function updateShareBtn(sharing) {
  const btn = $('btn-share-screen');
  if (!btn) return;
  btn.textContent = sharing ? '⏹️ Parar Tela' : '🖥️ Compartilhar Tela';
  btn.classList.toggle('active', !!sharing);
}

// Alguém parou/começou a compartilhar (sinalização instantânea via socket)
socket.on('screen:state', ({ user_id, sharing }) => {
  if (!sharing) removeMediaTile('scr', user_id);
});
socket.on('camera:state', ({ user_id, sharing }) => {
  if (!sharing) removeMediaTile('cam', user_id);
});

// ===== GRID DE VÍDEOS REMOTOS (telas e câmeras) =====
function showMediaTile(kind, userId, username, stream, icon) {
  const grid = $('screen-grid');
  if (!grid) return;
  grid.classList.remove('hidden');
  const tileId = kind + '-' + userId;
  let tile = grid.querySelector(`.screen-tile[data-id="${tileId}"]`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'screen-tile';
    tile.dataset.id = tileId;
    tile.innerHTML = `<video autoplay playsinline muted></video><div class="screen-name">${icon} ${username}</div><button class="fs-btn" title="Tela cheia">⛶</button>`;
    const fsBtn = tile.querySelector('.fs-btn');
    fsBtn.onclick = (e) => { e.stopPropagation(); toggleTileFullscreen(tile); };
    tile.ondblclick = () => toggleTileFullscreen(tile);
    grid.appendChild(tile);
  } else {
    tile.querySelector('.screen-name').textContent = `${icon} ${username}`;
  }
  const v = tile.querySelector('video');
  v.srcObject = stream;
  v.play().catch(() => {});
}

function removeMediaTile(kind, userId) {
  const grid = $('screen-grid');
  if (!grid) return;
  const tile = grid.querySelector(`.screen-tile[data-id="${kind}-${userId}"]`);
  if (tile && document.fullscreenElement === tile) document.exitFullscreen().catch(()=>{});
  tile?.remove();
  if (!grid.querySelector('.screen-tile')) grid.classList.add('hidden');
}

function toggleTileFullscreen(tile) {
  if (document.fullscreenElement === tile) document.exitFullscreen().catch(()=>{});
  else tile.requestFullscreen().catch(()=> tile.querySelector('video')?.requestFullscreen().catch(()=>{}));
}