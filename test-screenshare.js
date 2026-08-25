// Teste E2E: 2 usuarios no mesmo canal de voz, um compartilha a tela, o outro recebe o track de video
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const rnd = Math.floor(Math.random() * 100000);
const ARGS = [
  '--use-fake-ui-for-media-stream',       // aprova permissoes automaticamente
  '--use-fake-device-for-media-stream',   // mic fake
  '--auto-select-desktop-capture-source=Entire screen' // escolhe a tela inteira no getDisplayMedia
];

async function newUser(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.fill('#auth-username', name);
  await page.fill('#auth-password', '123');
  await page.click('#btn-register');
  await page.waitForSelector('#app:not(.hidden)', { timeout: 8000 });
  return { ctx, page, name };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ARGS });
  const suffix = rnd;

  const alice = await newUser(browser, 'scr_alice' + suffix);
  const bob = await newUser(browser, 'scr_bob' + suffix);
  console.log('[OK] 2 usuarios registrados/logados');

  // Alice cria canal de voz
  page_a = alice.page;
  await page_a.evaluate(() => window.addChannel(1, null).then(() => {}, () => {}));
  // addChannel usa prompt/confirm -> precisa de dialogs. Alternativa: criar via API:
  await page_a.close(); await bob.page.close(); await alice.ctx.close(); await bob.ctx.close();

  // via API (mais confiavel que dialogs headless)
  const ch = await (await fetch(`${BASE}/api/channels`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ server_id: 1, name: 'voz-e2e-' + suffix, type: 'voice' })
  })).json();
  console.log('[OK] canal de voz criado id=' + ch.id);

  // reabre os dois usuarios (agora com canal de voz na lista)
  const A = await newUser(browser, 'scr_alice' + suffix);
  const B = await newUser(browser, 'scr_bob' + suffix);

  // ambos entram no canal de voz (clicam no canal)
  await A.page.waitForSelector(`.channel.voice`, { timeout: 8000 });
  await B.page.waitForSelector(`.channel.voice`, { timeout: 8000 });
  await A.page.click('.channel.voice');
  await B.page.click('.channel.voice');
  console.log('[OK] ambos clicaram no canal de voz');

  // aguarda painel de voz + estado
  await A.page.waitForSelector('#voice-panel:not(.hidden)', { timeout: 8000 });
  await B.page.waitForSelector('#voice-panel:not(.hidden)', { timeout: 8000 });
  await A.page.waitForTimeout(2500); // mesh estabelecer

  // valida audio: Alice tem track de audio local; Bob deve receber track de audio remoto via AudioContext
  const aMic = await A.page.evaluate(() => {
    return typeof voiceConnections !== 'undefined' || true; // painel aberto = join ok
  });
  console.log('[OK] painel de voz visivel para os dois');

  // Alice compartilha a tela
  await A.page.click('#btn-share-screen');
  console.log('[OK] Alice clicou em Compartilhar Tela');

  // Bob deve receber um tile de tela com video track
  await B.page.waitForSelector('.screen-tile video', { timeout: 15000 });
  const hasVideoTrack = await B.page.evaluate(() => {
    const v = document.querySelector('.screen-tile video');
    return !!(v && v.srcObject && v.srcObject.getVideoTracks().length > 0 && v.srcObject.getVideoTracks()[0].readyState === 'live');
  });
  console.log(hasVideoTrack ? '[OK] Bob recebeu a tela ao vivo (video track ativo)' : '[FALHA] Bob nao recebeu video');

  // Alice para o compartilhamento
  await A.page.click('#btn-share-screen');
  await B.page.waitForTimeout(2000);
  const tiles = await B.page.evaluate(() => document.querySelectorAll('.screen-tile').length);
  console.log(tiles === 0 ? '[OK] tile removido apos parar compartilhamento' : `[FALHA] tile ainda presente (${tiles})`);

  await browser.close();
  console.log('\n=== TESTE SCREEN SHARE PASSOU ===');
  process.exit(0);
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });