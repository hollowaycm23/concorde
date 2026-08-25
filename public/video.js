let videoRoom = null;
let localVideoTrack = null;
let localAudioTrack = null;

const videoPanel = document.createElement('div');
videoPanel.id = 'video-panel';
videoPanel.className = 'hidden';
videoPanel.innerHTML = `
  <div class="video-grid" id="video-grid"></div>
  <div class="video-controls">
    <button id="btn-toggle-video">📹</button>
    <button id="btn-toggle-audio">🎤</button>
    <button id="btn-leave-video">📞</button>
  </div>
`;
document.body.appendChild(videoPanel);

const videoCSS = `
#video-panel {
  position: fixed; inset: 0; background: #000; z-index: 200;
  display: flex; flex-direction: column;
}
.video-grid {
  flex: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 8px; padding: 16px; overflow-y: auto;
}
.video-tile {
  position: relative; background: #1e1f22; border-radius: 8px; overflow: hidden;
  aspect-ratio: 16/9;
}
.video-tile video {
  width: 100%; height: 100%; object-fit: cover;
}
.video-tile .username {
  position: absolute; bottom: 8px; left: 8px; background: rgba(0,0,0,.7);
  padding: 4px 8px; border-radius: 4px; color: #fff; font-size: 12px;
}
.video-controls {
  display: flex; justify-content: center; gap: 16px; padding: 16px;
  background: #1e1f22;
}
.video-controls button {
  width: 50px; height: 50px; border-radius: 50%; border: none;
  background: #5865F2; color: #fff; font-size: 20px; cursor: pointer;
}
.video-controls button:hover { background: #4752c4; }
.video-controls button.active { background: #ED4245; }
`;
const style = document.createElement('style');
style.textContent = videoCSS;
document.head.appendChild(style);

$('btn-video').onclick = async () => {
  if (videoRoom) return;
  if (!currentServer) return alert('Selecione um servidor');

  try {
    const res = await fetch('/api/video/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_name: `server-${currentServer.id}`,
        user_id: currentUser.id,
        username: currentUser.username
      })
    });
    const { token, url } = await res.json();

    videoRoom = new LivekitRoom.Room({
      adaptiveStream: true,
      dynacast: true
    });

    videoRoom.on('trackSubscribed', (track, publication, participant) => {
      const tile = document.querySelector(`.video-tile[data-id="${participant.sid}"]`)
        || createVideoTile(participant);
      const element = track.attach();
      tile.querySelector('.video-container').appendChild(element);
    });

    videoRoom.on('trackUnsubscribed', (track) => {
      track.detach().forEach(el => el.remove());
    });

    videoRoom.on('participantDisconnected', (participant) => {
      document.querySelector(`.video-tile[data-id="${participant.sid}"]`)?.remove();
    });

    await videoRoom.connect(url, token);

    localAudioTrack = await LivekitRoom.createLocalAudioTrack();
    localVideoTrack = await LivekitRoom.createLocalVideoTrack();

    await videoRoom.localParticipant.publishTrack(localAudioTrack);
    await videoRoom.localParticipant.publishTrack(localVideoTrack);

    const localTile = createVideoTile(videoRoom.localParticipant);
    localTile.querySelector('.video-container').appendChild(localVideoTrack.attach());

    videoPanel.classList.remove('hidden');
  } catch (e) {
    alert('Erro ao entrar na sala de vídeo: ' + e.message);
  }
};

function createVideoTile(participant) {
  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.dataset.id = participant.sid;
  tile.innerHTML = `
    <div class="video-container"></div>
    <div class="username">${participant.name || participant.identity}</div>
  `;
  $('video-grid').appendChild(tile);
  return tile;
}

$('btn-toggle-video').onclick = async () => {
  if (!localVideoTrack) return;
  const pub = videoRoom.localParticipant.getTrackPublication('camera');
  if (pub?.isMuted) {
    await pub.unmute();
    $('btn-toggle-video').classList.remove('active');
  } else {
    await pub?.mute();
    $('btn-toggle-video').classList.add('active');
  }
};

$('btn-toggle-audio').onclick = async () => {
  if (!localAudioTrack) return;
  const pub = videoRoom.localParticipant.getTrackPublication('microphone');
  if (pub?.isMuted) {
    await pub.unmute();
    $('btn-toggle-audio').classList.remove('active');
  } else {
    await pub?.mute();
    $('btn-toggle-audio').classList.add('active');
  }
};

$('btn-leave-video').onclick = () => {
  videoRoom?.disconnect();
  localVideoTrack?.stop();
  localAudioTrack?.stop();
  videoPanel.classList.add('hidden');
  $('video-grid').innerHTML = '';
  videoRoom = null;
};