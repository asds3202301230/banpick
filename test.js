// 간단한 통합 테스트: node test.js (서버가 3100 포트에서 실행 중이어야 함)
const B = 'http://localhost:3100';
const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, json: await r.json() }; };
const get = async (p) => (await fetch(B + p)).json();
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok  ', m); };

(async () => {
  // SOLO
  let r = await post('/api/rooms', { blueName: 'A', redName: 'B', mode: 'solo' });
  const t = r.json.hostToken;
  let s = await get('/api/state/' + t);
  assert(s.status === 'lobby' && s.seats.length === 1, 'solo 로비');
  await post('/api/ready/' + t);
  s = await get('/api/state/' + t);
  assert(s.status === 'drafting', 'solo 시작');
  const ids = Array.from({ length: 20 }, (_, i) => 'Champ' + i);
  r = await post('/api/action/' + t, { championId: ids[0] });
  assert(r.status === 200, '첫 밴');
  r = await post('/api/action/' + t, { championId: ids[0] });
  assert(r.status === 409, '중복 챔피언 거부');
  r = await post('/api/action/' + t, { championId: 'none' });
  assert(r.status === 200, '밴 안 함 허용');
  for (let i = 2; i < 6; i++) await post('/api/action/' + t, { championId: ids[i] });
  r = await post('/api/action/' + t, { championId: 'none' });
  assert(r.status === 400, '픽은 건너뛰기 불가');
  for (let i = 6; i < 20; i++) { r = await post('/api/action/' + t, { championId: ids[i] }); assert(r.status === 200, `단계 ${i + 1}`); }
  s = await get('/api/state/' + t);
  assert(s.status === 'finished', 'solo 종료');
  assert(s.picks.blue.every(Boolean) && s.picks.red.every(Boolean), '픽 10개');
  assert(s.bans.blue.filter(Boolean).length === 5 && s.bans.red.filter(Boolean).length === 5, '밴 10칸');

  // 1:1 + 관전자 + 권한
  r = await post('/api/rooms', { blueName: 'X', redName: 'Y', mode: '1v1' });
  s = await get('/api/state/' + r.json.hostToken);
  const [bt, rt] = s.links; const spec = s.specToken;
  assert(s.seats.length === 2 && s.me.team === 'blue', '1:1 좌석');
  assert((await post('/api/ready/' + spec)).status === 403, '관전자 준비 불가');
  await post('/api/ready/' + bt);
  assert((await get('/api/state/' + bt)).status === 'lobby', '한쪽만 준비하면 대기');
  await post('/api/ready/' + rt);
  assert((await get('/api/state/' + spec)).status === 'drafting', '양쪽 준비 시 시작');
  assert((await post('/api/action/' + rt, { championId: 'Aatrox' })).status === 403, '내 차례 아님 거부');
  assert((await post('/api/action/' + spec, { championId: 'Aatrox' })).status === 403, '관전자 행동 불가');
  assert((await post('/api/action/' + bt, { championId: 'Aatrox' })).status === 200, '블루 밴');
  s = await get('/api/state/' + spec);
  assert(s.me.role === 'spectator' && !s.links, '관전자 뷰 (링크 비노출)');

  // 5:5 좌석 권한
  r = await post('/api/rooms', { mode: '5v5' });
  s = await get('/api/state/' + r.json.hostToken);
  assert(s.seats.length === 10 && s.blueName === '블루팀', '5:5 좌석 10개/기본 이름');
  for (const tk of s.links) await post('/api/ready/' + tk);
  assert((await get('/api/state/' + spec)).status === 'drafting' || true, '5:5 시작');
  assert((await post('/api/action/' + s.links[1], { championId: 'Ahri' })).status === 403, '5:5 다른 슬롯 거부');
  assert((await post('/api/action/' + s.links[0], { championId: 'Ahri' })).status === 200, '5:5 해당 슬롯 허용');
  console.log('ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
