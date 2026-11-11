// 간단한 통합 테스트: node test.js (서버가 3100 포트에서 실행 중이어야 함)
const B = 'http://localhost:3100';
const CID = 'test-client-aaaa';
const post = async (p, body, cid = CID) => { const r = await fetch(`${B}${p}?cid=${cid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, json: await r.json() }; };
const get = async (p, cid = CID) => (await fetch(`${B}${p}?cid=${cid}`)).json();
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

  // 지원하지 않는 모드(5:5 등)는 SOLO로 처리
  r = await post('/api/rooms', { mode: '5v5' });
  s = await get('/api/state/' + r.json.hostToken);
  assert(s.mode === 'solo' && s.seats.length === 1 && s.blueName === '블루팀', '지원하지 않는 모드는 SOLO로 처리 / 기본 팀 이름');
  // 한 링크에는 한 명만: 두 번째 사람은 관전자로 입장
  r = await post('/api/rooms', { mode: '1v1' });
  s = await get('/api/state/' + r.json.hostToken);
  const lk = s.links[1];
  assert((await get('/api/state/' + lk)).me.role === 'seat', '첫 사용자는 자리를 차지');
  const other = await get('/api/state/' + lk, 'other-client-9999');
  assert(other.me.role === 'spectator' && other.me.taken === true && !other.links, '두 번째 사람은 관전자로 입장');
  assert((await get('/api/state/' + lk)).me.role === 'seat', '원래 사람은 재접속해도 자리 유지');
  assert((await post('/api/ready/' + lk, {}, 'other-client-9999')).status === 403, '관전자로 들어온 사람은 준비 불가');
  assert((await fetch(`${B}/api/state/${lk}`)).status === 400, 'cid 없이 좌석 링크 접근 거부');
  assert((await get('/api/state/' + s.specToken, 'other-client-9999')).me.role === 'spectator', '관전 링크는 여러 명 가능');

  // 선택 미리보기(hover): 확정 전 고르는 중인 챔피언이 상대/관전자에게 보임
  r = await post('/api/rooms', { mode: '1v1' });
  s = await get('/api/state/' + r.json.hostToken);
  const blueT = r.json.hostToken, redT = s.links[1], specT = s.specToken;
  await post('/api/ready/' + blueT); await post('/api/ready/' + redT);
  assert((await post('/api/hover/' + blueT, { championId: 'Ahri' })).status === 200, '내 차례에 미리보기 가능');
  assert((await get('/api/state/' + redT)).hover === 'Ahri', '상대 화면에 미리보기가 보임');
  assert((await get('/api/state/' + specT, 'viewer-client-1234')).hover === 'Ahri', '관전자에게도 보임');
  assert((await post('/api/hover/' + redT, { championId: 'Zed' })).status === 403, '차례가 아니면 미리보기 불가');
  assert((await post('/api/hover/' + blueT, { championId: 'bad id!' })).status === 400, '잘못된 챔피언 거부');
  await post('/api/action/' + blueT, { championId: 'Ahri' });
  assert((await get('/api/state/' + redT)).hover === null, '확정하면 미리보기 초기화');
  assert((await post('/api/hover/' + redT, { championId: 'Ahri' })).status === 400, '이미 밴된 챔피언은 미리보기 불가');

  // 레드 선픽 + 내가 레드 진영
  r = await post('/api/rooms', { mode: '1v1', firstPick: 'red', hostSide: 'red' });
  s = await get('/api/state/' + r.json.hostToken);
  assert(s.me.team === 'red' && s.me.host, '방장이 레드 진영');
  assert(s.firstPick === 'red' && s.steps[0].team === 'red' && s.steps[0].type === 'ban', '레드 선픽: 첫 밴이 레드');
  assert(s.steps[6].type === 'pick' && s.steps[6].team === 'red', '레드 선픽: 첫 픽이 레드');
  const blueLink = s.links[s.seats.findIndex((x) => x.team === 'blue')];
  await post('/api/ready/' + r.json.hostToken);
  await post('/api/ready/' + blueLink);
  assert((await post('/api/action/' + blueLink, { championId: 'Ahri' })).status === 403, '레드 선픽: 블루는 첫 턴에 못 함');
  assert((await post('/api/action/' + r.json.hostToken, { championId: 'Ahri' })).status === 200, '레드 선픽: 레드가 먼저 밴');
  // 기본값은 블루 선픽
  r = await post('/api/rooms', { mode: '1v1' });
  s = await get('/api/state/' + r.json.hostToken);
  assert(s.firstPick === 'blue' && s.me.team === 'blue' && s.steps[0].team === 'blue', '기본값: 블루 선픽, 내가 블루');
  console.log('ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
