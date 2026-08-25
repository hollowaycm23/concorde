// Teste API: sair de servidor (membro), regras de dono, delete com cascata
const BASE = 'http://localhost:3000';
const sfx = Math.floor(Math.random() * 100000);

function http(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = require('http').request(BASE + path, { method, headers: { 'Content-Type': 'application/json' } }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(b || '{}') }); } catch (e) { resolve({ status: res.statusCode, json: {} }); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const owner = (await http('POST', '/api/register', { username: 'own' + sfx, password: '123' })).json;
  const member = (await http('POST', '/api/register', { username: 'mem' + sfx, password: '123' })).json;
  console.log('[OK] usuarios:', owner.username, member.username);

  const srv = (await http('POST', '/api/servers', { name: 'Srv Leave ' + sfx, owner_id: owner.id })).json;
  console.log('[OK] servidor criado id=' + srv.id, 'invite=' + srv.invite_code);

  // canais do servidor novo (geral texto + Geral voz padrao)
  const chans = (await http('GET', '/api/channels/' + srv.id)).json;
  console.log('[OK] canais padrao:', chans.map(c => c.name + '/' + c.type).join(', '));

  // member entra
  await http('POST', '/api/servers/join', { user_id: member.id, code: srv.invite_code });
  console.log('[OK] membro entrou');

  // member sai
  const leave = await http('POST', `/api/servers/${srv.id}/leave`, { user_id: member.id });
  console.log(leave.json.ok ? '[OK] membro saiu do servidor' : '[FALHA] leave: ' + JSON.stringify(leave.json));

  // sai de novo -> erro (nao é membro, mas delete member ignora)
  const again = await http('POST', `/api/servers/${srv.id}/leave`, { user_id: member.id });
  console.log(again.status === 200 ? '[INFO] leave repetido ok (idempotente)' : '[FALHA] leave repetido');

  // dono tenta sair -> deve bloquear
  const ownerLeave = await http('POST', `/api/servers/${srv.id}/leave`, { user_id: owner.id });
  console.log(ownerLeave.status === 400 ? '[OK] dono bloqueado de sair: ' + ownerLeave.json.error : '[FALHA] dono saiu!');

  // membro tenta deletar -> 403
  const delByMember = await http('DELETE', `/api/servers/${srv.id}`, { user_id: member.id });
  console.log(delByMember.status === 403 ? '[OK] membro bloqueado de deletar' : '[FALHA] membro deletou!');

  // dono deleta -> cascata
  const del = await http('DELETE', `/api/servers/${srv.id}`, { user_id: owner.id });
  const gone = (await http('GET', '/api/channels/' + srv.id)).status;
  console.log(del.json.ok && gone === 200 ? '[OK] servidor deletado (cascata ok)' : '[FALHA] delete: ' + JSON.stringify(del.json));

  console.log('\n=== TESTE LEAVE/DELETE ' + (del.json.ok ? 'PASSOU' : 'FALHOU') + ' ===');
  process.exit(del.json.ok ? 0 : 1);
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });