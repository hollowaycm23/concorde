let sodium = null;
let identityKey = null;
const sessions = new Map();

async function initE2E() {
  await sodiumReady();
  const stored = localStorage.getItem('e2e-keys');
  if (stored) {
    const keys = JSON.parse(stored);
    identityKey = {
      publicKey: sodium.from_base64(keys.identity.publicKey),
      privateKey: sodium.from_base64(keys.identity.privateKey)
    };
  } else {
    await generateIdentityKeys();
  }
}

async function sodiumReady() {
  if (!sodium) {
    await window.sodium.ready;
    sodium = window.sodium;
  }
}

async function generateIdentityKeys() {
  identityKey = sodium.crypto_box_keypair();
  localStorage.setItem('e2e-keys', JSON.stringify({
    identity: {
      publicKey: sodium.to_base64(identityKey.publicKey),
      privateKey: sodium.to_base64(identityKey.privateKey)
    }
  }));
}

async function establishSession(recipientPublicKey) {
  const ephemeralKey = sodium.crypto_box_keypair();
  const dh1 = sodium.crypto_scalarmult(identityKey.privateKey, sodium.from_base64(recipientPublicKey));
  const dh2 = sodium.crypto_scalarmult(ephemeralKey.privateKey, sodium.from_base64(recipientPublicKey));
  const input = sodium.concat(dh1, dh2, ephemeralKey.publicKey);
  const sessionKey = sodium.crypto_kdf_derive_from_key(32, 1, 'session', input);
  return { sessionKey, ephemeralPublicKey: sodium.to_base64(ephemeralKey.publicKey) };
}

async function encryptMessage(plaintext, sessionKey) {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, sessionKey);
  return {
    nonce: sodium.to_base64(nonce),
    ciphertext: sodium.to_base64(ciphertext),
    version: 1
  };
}

async function decryptMessage(encrypted, sessionKey) {
  const nonce = sodium.from_base64(encrypted.nonce);
  const ciphertext = sodium.from_base64(encrypted.ciphertext);
  try {
    const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, sessionKey);
    return sodium.to_string(plaintext);
  } catch (e) {
    return '[Mensagem não pôde ser descriptografada]';
  }
}

async function getOrCreateSession(channelId, recipientPublicKey) {
  if (sessions.has(channelId)) return sessions.get(channelId);
  const session = await establishSession(recipientPublicKey);
  sessions.set(channelId, session.sessionKey);
  return session.sessionKey;
}

window.encryptIfNeeded = async (channelId, content, isEncrypted) => {
  if (!isEncrypted || !identityKey) return { content, encrypted: null };
  const recipientPubKey = localStorage.getItem('demo-recipient-pubkey')
    || sodium.to_base64(identityKey.publicKey);
  const sessionKey = await getOrCreateSession(channelId, recipientPubKey);
  const encrypted = await encryptMessage(content, sessionKey);
  return { content: '[encrypted]', encrypted };
};

window.decryptIfNeeded = async (msg) => {
  if (!msg.encrypted) return msg;
  const sessionKey = sessions.get(msg.channel_id);
  if (sessionKey) {
    msg.content = await decryptMessage(msg.encrypted, sessionKey);
  }
  return msg;
};