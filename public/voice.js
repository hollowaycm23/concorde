// Voz por canal: mesh PeerJS entre os participantes do canal de voz
let peer = null;
let localStream = null;
let currentVoiceChannel = null;
const voiceConnections = new Map(); // userId -> { call, audio }

async function joinVoiceChannel(channel) {
  if (currentVoiceChannel && currentVoiceChannel.id === channel.id) return;
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (!peer) {
      peer = new Peer('user-' + currentUser.id, { debug: 0 });
      peer.on('call', (call) => {
        call.answer(localStream);
        handleCall(call, call.metadata?.userId);
      });
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
    $('voice-users').innerHTML = '';
  } catch (e) {
    alert('Erro no microfone: ' + e.message);
    leaveVoice();
  }
}

function leaveVoice() {
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

socket.on('voice:user-joined', ({ user, peerId }) => {
  if (!peer || !localStream || user.id === currentUser.id) return;
  const call = peer.call(peerId, localStream, { metadata: { userId: currentUser.id } });
  handleCall(call, user.id, user.username);
});

socket.on('voice:user-left', ({ userId }) => {
  const c = voiceConnections.get(userId);
  if (c) { try { c.call.close(); } catch (e) {} c.audio.remove(); voiceConnections.delete(userId); }
  document.querySelector(`.voice-user[data-id="${userId}"]`)?.remove();
  document.querySelector(`.vu[data-id="${userId}"]`)?.remove();
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

function handleCall(call, userId, username) {
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