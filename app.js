(() => {
  'use strict';
  const app = document.getElementById('app');
  const TOKEN = (location.pathname.match(/^\/r\/([\w-]+)/) || [])[1] || null;
  const DD = 'https://ddragon.leagueoflegends.com';
  // 이 브라우저를 구분하는 ID (한 링크에는 한 명만 입장하도록 서버가 확인)
  const CID = (() => {
    try {
      let c = localStorage.getItem('banpick_cid');
      if (!c) { c = (crypto.randomUUID ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now()}`); localStorage.setItem('banpick_cid', c); }
      return c;
    } catch { return `anon-${Math.random().toString(36).slice(2)}${Date.now()}`; }
  })();
  const LANE_BUTTONS = [['ALL', '전체'], ['TOP', '탑'], ['JG', '정글'], ['MID', '미드'], ['ADC', '원딜'], ['SUP', '서폿']];
  const MODE_LABEL = { solo: 'SOLO', '1v1': '1:1', '5v5': '5:5' };

  let ver = null, champs = [], byId = {};
  let S = null, offset = 0;
  let selected = null, query = '', lane = 'ALL', lastStep = -1;
  let phase = null, tick = null, es = null;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => app.querySelector(sel);
  const icon = (id) => `${DD}/cdn/${ver}/img/champion/${id}.png`;
  const splash = (id) => `${DD}/cdn/img/champion/splash/${id}_0.jpg`;
  const nameOf = (id) => (byId[id] ? byId[id].name : id);
  const teamName = (t) => (t === 'blue' ? S.blueName : S.redName);

  // ---------- 한글 검색 (초성 포함) ----------
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const toCho = (s) => [...s].map((ch) => { const c = ch.charCodeAt(0) - 0xAC00; return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch; }).join('');
  const isCho = (s) => s.length > 0 && [...s].every((ch) => CHO.includes(ch));
  function matches(c, q) {
    if (!q) return true;
    const n = q.toLowerCase();
    return c.name.includes(q) || c.id.toLowerCase().includes(n) || (isCho(q) && toCho(c.name).includes(q));
  }

  // ---------- 데이터 ----------
  async function loadChamps() {
    const vs = await (await fetch(`${DD}/api/versions.json`)).json();
    ver = vs[0];
    const j = await (await fetch(`${DD}/cdn/${ver}/data/ko_KR/champion.json`)).json();
    champs = Object.values(j.data).map((c) => ({ id: c.id, name: c.name, tags: c.tags }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    byId = Object.fromEntries(champs.map((c) => [c.id, c]));
  }
  async function api(path, body) {
    const url = `${path}${path.includes('?') ? '&' : '?'}cid=${encodeURIComponent(CID)}`;
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '요청 실패');
    return j;
  }
  function toast(msg) {
    const d = document.createElement('div'); d.className = 'banner'; d.textContent = msg;
    document.body.appendChild(d); setTimeout(() => d.remove(), 2500);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    toast('링크를 복사했습니다.');
  }

  // ---------- 홈: 방 생성 ----------
  function renderHome() {
    app.innerHTML = `
      <main class="card">
        <h1>리그 오브 레전드 밴픽</h1>
        <p class="sub">토너먼트 드래프트 방식 밴픽 시뮬레이터</p>
        <label class="lbl">블루팀 이름</label>
        <input id="blueName" class="in blue" maxlength="20" placeholder="블루팀 이름을 입력해주세요.">
        <label class="lbl">레드팀 이름</label>
        <input id="redName" class="in red" maxlength="20" placeholder="레드팀 이름을 입력해주세요.">
        <label class="lbl">밴픽 모드</label>
        <div class="modes two">
          <label class="mode"><input type="radio" name="mode" value="solo" checked><b>SOLO</b><span>혼자서 양 팀 진행</span></label>
          <label class="mode"><input type="radio" name="mode" value="1v1"><b>1:1</b><span>팀장 2명</span></label>        </div>
        <label class="lbl">선픽 팀 <span class="spec-pill">먼저 밴/픽을 하는 팀</span></label>
        <div class="modes two">
          <label class="mode"><input type="radio" name="firstPick" value="blue" checked><b>블루팀 선픽</b><span>기본 (롤 공식 방식)</span></label>
          <label class="mode"><input type="radio" name="firstPick" value="red"><b>레드팀 선픽</b><span>레드팀이 먼저</span></label>
        </div>
        <label class="lbl">내 진영 <span class="spec-pill">1:1에서 내가 앉을 자리</span></label>
        <div class="modes two">
          <label class="mode"><input type="radio" name="hostSide" value="blue" checked><b>블루팀</b><span>내가 블루팀</span></label>
          <label class="mode"><input type="radio" name="hostSide" value="red"><b>레드팀</b><span>내가 레드팀</span></label>
        </div>
        <button id="create" class="btn primary">방 생성</button>
        <p id="err" class="err"></p>
      </main>`;
    $('#create').onclick = async () => {
      const btn = $('#create'); btn.disabled = true;
      try {
        const r = await api('/api/rooms', {
          blueName: $('#blueName').value, redName: $('#redName').value,
          mode: app.querySelector('input[name=mode]:checked').value,
          firstPick: app.querySelector('input[name=firstPick]:checked').value,
          hostSide: app.querySelector('input[name=hostSide]:checked').value,
        });
        location.href = `/r/${r.hostToken}`;
      } catch (e) { $('#err').textContent = e.message; btn.disabled = false; }
    };
  }

  // ---------- 로비 ----------
  function seatLabel(s) {
    if (s.team === 'both') return '혼자 진행';
    return s.slot == null ? `${s.team === 'blue' ? '블루' : '레드'} 팀장` : `${s.team === 'blue' ? '블루' : '레드'} Player${s.slot + 1}`;
  }
  const linkRow = (cls, who, url) => `
    <div class="linkrow ${cls}">
      ${who ? `<span class="who">${esc(who)}</span>` : ''}
      <input readonly value="${esc(url)}" onclick="this.select()">
      <button data-copy="${esc(url)}">복사</button>
    </div>`;

  function renderLobby() {
    phase = 'lobby';
    const me = S.me;
    let html = `<main class="card lobby">
      <h2><span style="color:var(--blue2)">${esc(S.blueName)}</span><span class="vs">VS</span><span style="color:var(--red2)">${esc(S.redName)}</span></h2>
      <div class="center-t"><span class="badge">${MODE_LABEL[S.mode]} 모드</span>
      <span class="badge">${esc(teamName(S.firstPick))} 선픽</span>
      <span class="badge">관전 ${S.spectators}명</span></div>`;

    if (me.host) {
      const base = location.origin;
      const others = S.seats.map((s, i) => ({ s, url: `${base}/r/${S.links[i]}` })).filter((x) => !x.s.host);
      if (S.mode === '1v1') {
        for (const t of ['blue', 'red']) {
          const x = others.find((o) => o.s.team === t);
          if (x) html += `<h3>${esc(teamName(t))} 참가 링크 <small>${x.s.joined ? '접속함' : '대기 중'}</small></h3>${linkRow(t, '', x.url)}`;
        }
      }
      html += `<h3>관전자 참가 링크</h3>${linkRow('spec', '', `${base}/r/${S.specToken}`)}`;
    }

    if (S.mode !== 'solo') {
      html += `<div class="seats">${S.seats.map((s) => `
        <div class="seat ${s.team}"><span>${seatLabel(s)}</span>
        <span class="dot ${s.ready ? 'on' : ''}">${s.ready ? '준비 완료' : s.joined ? '접속 중' : '대기'}</span></div>`).join('')}</div>`;
    }

    if (me.role === 'spectator') {
      if (me.taken) html += `<p class="note">이 링크는 이미 다른 사람이 사용 중이라 <b>관전자</b>로 입장했어요.</p>`;
      html += `<button class="btn primary" disabled>밴픽 시작을 기다리는 중...</button>`;
    } else {
      const label = me.team === 'both' ? '밴픽 시작' : me.team === 'blue' ? 'BLUE 준비' : 'RED 준비';
      html += `<button id="ready" class="btn primary ${me.team === 'red' ? 'red' : ''}" ${me.ready ? 'disabled' : ''}>${me.ready ? '준비 완료 - 다른 참가자를 기다리는 중' : (me.slot != null ? label + ` (Player${me.slot + 1})` : label)}</button>`;
    }
    html += '</main>';
    app.innerHTML = html;
    app.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
    const r = $('#ready');
    if (r) r.onclick = () => api(`/api/ready/${TOKEN}`, {}).catch((e) => toast(e.message));
  }

  // ---------- 밴픽 화면 ----------
  const currentStep = () => (S.status === 'drafting' ? S.steps[S.step] : null);
  function canAct() {
    const st = currentStep();
    if (!st || S.me.role !== 'seat') return false;
    const m = S.me;
    return m.team === 'both' || (m.team === st.team && (m.slot == null || m.slot === st.slot));
  }
  function usedIds() {
    const s = new Set();
    for (const t of ['blue', 'red']) [...S.picks[t], ...S.bans[t]].forEach((x) => x && x !== 'none' && s.add(x));
    return s;
  }

  function buildDraft() {
    phase = 'draft';
    app.innerHTML = `
      <div class="draft">
        <div class="topbar">
          <div class="tn blue" id="tnBlue"></div>
          <div class="turn"><div class="label" id="turnLabel"></div><div class="timer" id="timer"></div><div class="sub2" id="specCnt"></div></div>
          <div class="tn red" id="tnRed"></div>
        </div>
        <div class="board">
          <aside class="team blue" id="slotsBlue"></aside>
          <section class="mid">
            <div id="pickArea" style="display:flex;flex-direction:column;flex:1">
              <div class="tools">
                <input id="search" placeholder="챔피언 검색 (한글, 초성 가능: ㄱㅊㅇ)" autocomplete="off">
                <div class="lanes">${LANE_BUTTONS.map(([k, v]) => `<button data-lane="${k}">${v}</button>`).join('')}</div>
              </div>
              <div class="grid" id="grid"></div>
              <div class="actions"><button class="btn blue" id="confirm"></button><button class="btn ghost" id="skip">밴 안 함</button></div>
              <div class="status-msg" id="statusMsg"></div>
            </div>
            <div id="finishArea" class="finish" style="display:none">
              <h2>FINISHED</h2><div class="note">밴픽이 모두 끝났습니다.</div>
              <div class="row"><button class="btn primary sm" id="saveImg">결과 이미지 저장</button><a class="btn sm" href="/" style="background:#3b3e44">새 방 만들기</a></div>
            </div>
          </section>
          <aside class="team red" id="slotsRed"></aside>
        </div>
        <div class="bans"><div class="banrow blue" id="bansBlue"></div><div class="banmid"></div><div class="banrow red" id="bansRed"></div></div>
      </div>`;
    $('#search').value = query;
    $('#search').oninput = (e) => { query = e.target.value.trim(); renderGrid(); };
    app.querySelectorAll('[data-lane]').forEach((b) => (b.onclick = () => { lane = b.dataset.lane; renderGrid(); }));
    $('#grid').onclick = (e) => {
      const t = e.target.closest('.tile');
      if (!t || t.classList.contains('used') || !canAct()) return;
      selected = t.dataset.id; renderGrid(); renderSlots(); renderBans(); renderActions();
      api(`/api/hover/${TOKEN}`, { championId: selected }).catch(() => {}); // 상대/관전자에게 미리보기 전송
    };
    $('#confirm').onclick = () => submit(selected);
    $('#skip').onclick = () => submit('none');
    $('#saveImg').onclick = saveImage;
    clearInterval(tick); tick = setInterval(updateTimer, 250);
  }

  async function submit(id) {
    if (!id || !canAct()) return;
    try { await api(`/api/action/${TOKEN}`, { championId: id }); selected = null; }
    catch (e) { toast(e.message); }
  }

  function renderDraft() {
    if (phase !== 'draft') buildDraft();
    if (S.step !== lastStep) { selected = null; lastStep = S.step; }
    const st = currentStep();
    const fin = S.status === 'finished';
    $('#tnBlue').textContent = S.blueName;
    $('#tnRed').textContent = S.redName;
    $('#specCnt').textContent = `${MODE_LABEL[S.mode]} · ${teamName(S.firstPick)} 선픽 · 관전 ${S.spectators}명`;
    const lbl = $('#turnLabel');
    if (fin) { lbl.className = 'label'; lbl.textContent = 'FINISHED'; }
    else {
      lbl.className = `label ${st.team}`;
      lbl.textContent = `${teamName(st.team)} ${st.type === 'ban' ? '밴' : '픽'} ${st.slot + 1}${canAct() ? ' · 내 차례' : ''}`;
    }
    $('#pickArea').style.display = fin ? 'none' : 'flex';
    $('#finishArea').style.display = fin ? 'block' : 'none';
    renderSlots(); renderBans(); renderGrid(); renderActions(); updateTimer();
  }

  function renderSlots() {
    const st = currentStep();
    for (const t of ['blue', 'red']) {
      $(`#slots${t === 'blue' ? 'Blue' : 'Red'}`).innerHTML = S.picks[t].map((id, i) => {
        const active = st && st.type === 'pick' && st.team === t && st.slot === i;
        const hov = canAct() ? selected : S.hover; // 내 차례면 내 선택, 아니면 상대가 고르는 중인 챔피언
        const preview = active && !id && hov;
        const shown = preview ? hov : (id && id !== 'none' ? id : null);
        const bg = shown ? `style="background-image:url('${splash(shown)}')"` : '';
        return `<div class="slot ${active ? 'active' : ''} ${preview ? 'preview' : ''}" ${bg}>
          <div class="cn">${shown ? esc(nameOf(shown)) : (id === 'none' ? '-' : '')}</div><div class="pn">Player${i + 1}</div></div>`;
      }).join('');
    }
  }

  function renderBans() {
    const st = currentStep();
    for (const t of ['blue', 'red']) {
      const tag = '<span class="tag">BAN</span>';
      const items = S.bans[t].map((id, i) => {
        const active = st && st.type === 'ban' && st.team === t && st.slot === i;
        if (id === 'none') return `<div class="ban none" title="밴 안 함"></div>`;
        const shown = id || (active ? (canAct() ? selected : S.hover) : null);
        const bg = shown ? `style="background-image:url('${icon(shown)}')"` : '';
        return `<div class="ban ${active ? 'active' : ''} ${active && !id && shown ? 'hovering' : ''}" ${bg} title="${shown ? esc(nameOf(shown)) : ''}"></div>`;
      }).join('');
      $(`#bans${t === 'blue' ? 'Blue' : 'Red'}`).innerHTML = t === 'blue' ? tag + items : items + tag;
    }
  }

  function renderGrid() {
    if (!$('#grid')) return;
    app.querySelectorAll('[data-lane]').forEach((b) => b.classList.toggle('on', b.dataset.lane === lane));
    const used = usedIds();
    const laneSet = lane === 'ALL' ? null : new Set((window.LANES || {})[lane] || []);
    const gridEl = $('#grid');
    const scrollTop = gridEl.scrollTop;
    gridEl.innerHTML = champs.filter((c) => (!laneSet || laneSet.has(c.id)) && matches(c, query)).map((c) => `
      <button class="tile ${used.has(c.id) ? 'used' : ''} ${selected === c.id ? 'sel' : ''} ${!canAct() && S.hover === c.id ? 'hov' : ''}" data-id="${c.id}" title="${esc(c.name)}">
        <img loading="lazy" src="${icon(c.id)}" alt=""><span>${esc(c.name)}</span>
      </button>`).join('') || '<div class="note" style="grid-column:1/-1;padding:20px">검색 결과가 없습니다.</div>';
    gridEl.scrollTop = scrollTop; // 상대가 고를 때마다 목록 스크롤이 맨 위로 튀지 않게
  }

  function renderActions() {
    const st = currentStep();
    if (!st) return;
    const mine = canAct();
    const confirm = $('#confirm');
    confirm.textContent = st.type === 'ban' ? '밴 확정' : '챔피언 선택';
    confirm.className = `btn ${st.team === 'red' ? 'red' : 'blue'}`;
    confirm.disabled = !mine || !selected;
    confirm.style.display = mine ? '' : 'none';
    $('#skip').style.display = mine && st.type === 'ban' ? '' : 'none';
    $('#statusMsg').textContent = S.me.role === 'spectator' ? (S.me.taken ? '이미 사용 중인 링크라 관전자로 입장했습니다.' : '관전 중입니다.')
      : mine ? (selected ? `${nameOf(selected)} 선택됨` : '챔피언을 선택하세요.')
        : `${teamName(st.team)}의 ${st.type === 'ban' ? '밴' : '픽'}을 기다리는 중...`;
  }

  function updateTimer() {
    const el = $('#timer');
    if (!el) return;
    if (S.status === 'drafting' && S.mode === 'solo') { el.textContent = '∞'; el.classList.remove('low'); return; }
    if (S.status !== 'drafting' || !S.turnEndsAt) { el.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((S.turnEndsAt - (Date.now() + offset)) / 1000));
    el.textContent = left;
    el.classList.toggle('low', left <= 5);
  }

  // ---------- 결과 이미지 저장 ----------
  function loadImg(url) {
    return new Promise((resolve) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = url;
    });
  }
  function drawCover(ctx, im, x, y, w, h, fy = 0.2) {
    const r = Math.max(w / im.width, h / im.height);
    const sw = w / r, sh = h / r;
    ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) * fy, sw, sh, x, y, w, h);
  }
  async function saveImage() {
    const btn = $('#saveImg'); btn.disabled = true; btn.textContent = '이미지 생성 중...';
    try {
      const W = 1280, H = 790, ROW = 100, SW = 580;
      const ids = new Set();
      for (const t of ['blue', 'red']) [...S.picks[t], ...S.bans[t]].forEach((x) => x && x !== 'none' && ids.add(x));
      const imgs = {};
      await Promise.all([...ids].map(async (id) => { imgs[id] = { s: await loadImg(splash(id)), i: await loadImg(icon(id)) }; }));
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#1b1d22'; ctx.fillRect(0, 0, W, H);
      ctx.font = '800 30px sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#4a9bff'; ctx.textAlign = 'left'; ctx.fillText(S.blueName, 30, 45);
      ctx.fillStyle = '#ff6b63'; ctx.textAlign = 'right'; ctx.fillText(S.redName, W - 30, 45);
      ctx.fillStyle = '#9aa0a6'; ctx.textAlign = 'center'; ctx.font = '700 22px sans-serif'; ctx.fillText('VS', W / 2, 45);
      for (const t of ['blue', 'red']) {
        const x = t === 'blue' ? 30 : W - 30 - SW;
        S.picks[t].forEach((id, i) => {
          const y = 90 + i * (ROW + 6);
          ctx.fillStyle = '#111'; ctx.fillRect(x, y, SW, ROW);
          const im = id && id !== 'none' ? imgs[id] : null;
          if (im && im.s) drawCover(ctx, im.s, x, y, SW, ROW);
          const g = ctx.createLinearGradient(t === 'blue' ? x : x + SW, 0, t === 'blue' ? x + SW : x, 0);
          g.addColorStop(0, 'rgba(0,0,0,.1)'); g.addColorStop(1, 'rgba(0,0,0,.8)');
          ctx.fillStyle = g; ctx.fillRect(x, y, SW, ROW);
          ctx.textAlign = t === 'blue' ? 'right' : 'left';
          const tx = t === 'blue' ? x + SW - 16 : x + 16;
          ctx.fillStyle = '#fff'; ctx.font = '800 24px sans-serif';
          ctx.fillText(id && id !== 'none' ? nameOf(id) : '-', tx, y + 36);
          ctx.fillStyle = '#ddd'; ctx.font = '500 16px sans-serif'; ctx.fillText(`Player${i + 1}`, tx, y + 70);
          ctx.fillStyle = t === 'blue' ? '#4a9bff' : '#ff6b63'; ctx.fillRect(t === 'blue' ? x : x + SW - 5, y, 5, ROW);
        });
        // 밴
        const by = 90 + 5 * (ROW + 6) + 14;
        ctx.fillStyle = '#9aa0a6'; ctx.font = '800 16px sans-serif'; ctx.textAlign = 'left';
        let bx = t === 'blue' ? x : x + SW - (5 * 68 + 50);
        ctx.fillText('BAN', bx, by + 28); bx += 50;
        S.bans[t].forEach((id, i) => {
          const im = id && id !== 'none' ? imgs[id] : null;
          ctx.fillStyle = '#111'; ctx.fillRect(bx + i * 68, by, 60, 60);
          if (im && im.i) { ctx.filter = 'grayscale(1)'; ctx.drawImage(im.i, bx + i * 68, by, 60, 60); ctx.filter = 'none'; }
        });
      }
      ctx.fillStyle = '#666'; ctx.font = '500 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${location.host} · ${new Date().toLocaleString('ko-KR')}`, W / 2, H - 14);
      const url = cv.toDataURL('image/png');
      const a = document.createElement('a'); a.href = url; a.download = `banpick_${Date.now()}.png`; a.click();
    } catch (e) { toast('이미지 저장에 실패했습니다.'); console.error(e); }
    btn.disabled = false; btn.textContent = '결과 이미지 저장';
  }

  // ---------- 상태 처리 ----------
  function render() {
    if (!S || !champs.length) return;
    if (S.status === 'lobby') { clearInterval(tick); renderLobby(); } else renderDraft();
  }

  async function boot() {
    if (!TOKEN) return renderHome();
    app.innerHTML = '<main class="card"><p class="sub">불러오는 중...</p></main>';
    try {
      await Promise.all([loadChamps(), api(`/api/state/${TOKEN}`).then((s) => { S = s; })]);
    } catch (e) {
      app.innerHTML = `<main class="card"><h2>입장할 수 없습니다</h2><p class="sub">${esc(e.message === 'Failed to fetch' ? '챔피언 데이터를 불러오지 못했습니다. 네트워크를 확인해주세요.' : e.message)}</p><a class="btn primary" style="text-decoration:none;text-align:center" href="/">처음으로</a></main>`;
      return;
    }
    es = new EventSource(`/api/events/${TOKEN}?cid=${encodeURIComponent(CID)}`);
    es.onmessage = (e) => {
      const prevStatus = S && S.status;
      S = JSON.parse(e.data); offset = S.serverNow - Date.now();
      if (prevStatus !== S.status) phase = null;
      render();
    };
    render();
  }
  boot();
})();
