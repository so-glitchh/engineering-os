const KEY = 'mehfooj_eng_os_v2';
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const TODAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()];
let activeJournalDate = new Date().toISOString().slice(0, 10);

// --- STATE MANAGEMENT ---
function def(){return {targets:[],dailyChecks:{},streak:{},certs:{},currentMonth:1,provider:'ollama',theme:'dark',projects:[],resources:[],journal:{}};}
function load(){try{const r=localStorage.getItem(KEY);if(!r)return def();const s=JSON.parse(r);if(!s.projects)s.projects=[];if(!s.resources)s.resources=[];if(!s.journal)s.journal={};return s;}catch(e){return def();}}
function save(){
  try{
    state.lastSync = Date.now();
    localStorage.setItem(KEY,JSON.stringify(state));
    updateSyncStatus();
    if(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      fetch('/save_state', { method: 'POST', body: JSON.stringify(state) }).catch(e=>{});
    }
  }catch(e){console.error(e);}
}
let state = load();

const DAILY_CHECKS = [
  {id:'commit', text:'GitHub commit pushed today'},
  {id:'targets', text:'3 targets explicitly written'},
  {id:'output', text:'Visible output produced, not just code'},
  {id:'nolecture', text:'No lecture watched without coding alongside'}
];

const TRACK_COLORS = {ai:'purple',fullstack:'orange',backend:'blue',dsa:'red',oss:'green',devops:'cyan',general:'yellow'};

// --- SIDEBAR TOGGLE ---
function toggleSidebar(side) {
  const shell = document.getElementById('shell');
  const cls = side === 'left' ? 'left-collapsed' : 'right-collapsed';
  shell.classList.toggle(cls);
  const btn = document.getElementById('toggle-' + side);
  if (side === 'left') {
    btn.innerHTML = shell.classList.contains(cls) ? '&#x276F;' : '&#x276E;';
  } else {
    btn.innerHTML = shell.classList.contains(cls) ? '&#x276E;' : '&#x276F;';
  }
}

// --- THEME ---
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const icon = document.getElementById('theme-icon');
  if (state.theme === 'light') {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
  }
}
function toggleTheme(){state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); save();}

// --- CORE RENDERERS ---
function renderToday(){
  const d=new Date();
  document.getElementById('topbar-date').textContent=d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  document.getElementById('today-date-full').textContent=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  const todays=state.targets.filter(t=>t.day===TODAY);
  const list=document.getElementById('targets-list');
  document.getElementById('no-targets').style.display=todays.length?'none':'block';
  list.innerHTML='';
  todays.forEach((t,i)=>{
    const el=document.createElement('div');
    el.className='target-row'+(t.done?' done':'');
    const color = TRACK_COLORS[t.track.toLowerCase()] || 'blue';
    el.innerHTML=`<span style="font-family:var(--mono);font-size:11px;color:var(--hint);font-weight:600">0${i+1}</span>
      <span class="target-txt ${t.done?'done':''}">${t.text}</span>
      <span class="badge b-${color}">${t.track}</span>
      <button class="btn btn-sm" onclick="toggleTarget('${t.id}')">${t.done?'Undo':'Done'}</button>
      <button class="btn btn-sm" onclick="delTarget('${t.id}')">×</button>`;
    list.appendChild(el);
  });

  const wd=state.targets.filter(t=>t.done).length, wt=state.targets.length;
  const weekPct = wt?Math.round(wd/wt*100):0;
  document.getElementById('s-week').textContent=weekPct+'%';
  const weekBar = document.getElementById('s-week-bar');
  if(weekBar) weekBar.style.width = weekPct+'%';
  document.getElementById('s-streak').textContent=calcStreak();
  document.getElementById('s-month').textContent=state.currentMonth;
  const certsDone = Object.values(state.certs).filter(v=>v).length;
  document.getElementById('s-certs').textContent=certsDone+'/8';
  const certsBar = document.getElementById('s-certs-bar');
  if(certsBar) certsBar.style.width = Math.round(certsDone/8*100)+'%';

  const tk=d.toISOString().slice(0,10);
  if(!state.dailyChecks[tk])state.dailyChecks[tk]={};
  const dc=document.getElementById('daily-checks');
  dc.innerHTML='';
  DAILY_CHECKS.forEach(c=>{
    const done=!!state.dailyChecks[tk][c.id];
    const el=document.createElement('div');
    el.className='check-item';
    el.onclick=()=>{state.dailyChecks[tk][c.id]=!done;save();renderToday();};
    el.innerHTML=`<div class="checkbox ${done?'done':''}"></div><span class="check-text ${done?'done':''}">${c.text}</span>`;
    dc.appendChild(el);
  });
  renderContext();
}

function renderWeek(){
  const el=document.getElementById('week-list');
  el.innerHTML='';
  DAYS.forEach(day=>{
    const items=state.targets.filter(t=>t.day===day);
    if(!items.length && day!==TODAY)return;
    const sec=document.createElement('div');
    sec.style.marginBottom='16px';
    sec.innerHTML=`<div style="font-family:var(--mono);font-size:10px;font-weight:600;color:var(--muted);margin-bottom:8px;text-transform:uppercase">${day}${day===TODAY?' — TODAY':''}</div>`;
    items.forEach((t,i)=>{
      const row=document.createElement('div');
      row.className='target-row'+(t.done?' done':'');
      const color = TRACK_COLORS[t.track.toLowerCase()] || 'blue';
      row.innerHTML=`<span style="font-family:var(--mono);font-size:11px;color:var(--hint)">0${i+1}</span><span class="target-txt ${t.done?'done':''}">${t.text}</span><span class="badge b-${color}">${t.track}</span>`;
      sec.appendChild(row);
    });
    if(!items.length)sec.innerHTML+=`<div style="color:var(--hint);font-size:12px;font-style:italic">No targets planned</div>`;
    el.appendChild(sec);
  });
  const total = state.targets.length;
  const done = state.targets.filter(t=>t.done).length;
  const ws = document.getElementById('week-stats');
  if(ws) ws.innerHTML = `Total: <span>${total}</span> &middot; Done: <span>${done}</span> &middot; Pending: <span>${total - done}</span>`;
}

function clearDoneTargets(){
  state.targets = state.targets.filter(t => !t.done);
  save(); renderWeek(); renderToday();
  showToast('Completed targets cleared');
}
function clearAllTargets(){
  if(!confirm('Clear ALL targets for this week?')) return;
  state.targets = [];
  save(); renderWeek(); renderToday();
  showToast('All targets cleared');
}

function calcStreak(){
  let current=0, best=0, temp=0, t=new Date();
  for(let i=0;i<365;i++){
    const d=new Date(t);d.setDate(t.getDate()-i);
    const k=d.toISOString().slice(0,10);
    if(state.streak[k]){ current++; temp++; if(temp>best)best=temp; }
    else { if(i>0)temp=0; }
  }
  let monthStreak=0;
  for(let i=0;i<30;i++){
    const d=new Date(t);d.setDate(t.getDate()-i);
    const k=d.toISOString().slice(0,10);
    if(state.streak[k])monthStreak++;
  }
  return {current,best,monthStreak};
}

function renderStreak(){
  const stats = calcStreak();
  const elCurrent = document.getElementById('streak-current');
  const elBest = document.getElementById('streak-best');
  const elMonth = document.getElementById('streak-month');
  if(elCurrent) elCurrent.textContent = stats.current;
  if(elBest) elBest.textContent = stats.best;
  if(elMonth) elMonth.textContent = stats.monthStreak;

  ['streak-grid','mini-streak'].forEach(id=>{
    const grid=document.getElementById(id);
    if(!grid)return;
    grid.innerHTML='';
    const days=id==='mini-streak'?13:27;
    const t=new Date();
    for(let i=days;i>=0;i--){
      const d=new Date(t);d.setDate(t.getDate()-i);
      const k=d.toISOString().slice(0,10);
      const committed=!!state.streak[k];
      const div=document.createElement('div');
      div.className='streak-day'+(committed?' committed':'')+(i===0?' today':'');
      div.textContent=d.getDate();
      div.onclick=()=>{state.streak[k]=!committed;save();renderStreak();renderToday();};
      grid.appendChild(div);
    }
  });

  const weeklyBars = document.getElementById('streak-weekly-bars');
  if(weeklyBars) {
    let html = '';
    const t = new Date();
    for(let w=0; w<4; w++) {
      let weekCommits = 0;
      for(let d=0; d<7; d++) {
        const dt = new Date(t);
        dt.setDate(t.getDate() - (w*7 + d));
        if(state.streak[dt.toISOString().slice(0,10)]) weekCommits++;
      }
      const label = w===0 ? 'This week' : (w===1 ? 'Last week' : `${w} weeks ago`);
      html += `<div class="streak-bar-row">
        <div class="streak-bar-label">${label}</div>
        <div class="streak-bar-track"><div class="streak-bar-fill" style="width:${Math.round((weekCommits/7)*100)}%"></div></div>
        <div class="streak-bar-count">${weekCommits}/7</div>
      </div>`;
    }
    weeklyBars.innerHTML = html;
  }
}

// --- PROJECTS ---
function renderProjects(){
  const el = document.getElementById('projects-list');
  const trackF = document.getElementById('proj-track-filter').value;
  const statF = document.getElementById('proj-status-filter').value;
  el.innerHTML = '';
  
  let projs = state.projects || [];
  if(trackF !== 'all') projs = projs.filter(p => p.track === trackF);
  if(statF !== 'all') projs = projs.filter(p => p.status === statF);
  
  if(projs.length === 0) {
    el.innerHTML = '<div style="color:var(--hint);text-align:center;padding:40px 0;">No projects found for this filter.</div>';
    return;
  }
  
  // Sort by month ascending
  projs.sort((a,b) => parseInt(a.month) - parseInt(b.month));
  
  projs.forEach(p => {
    const color = TRACK_COLORS[p.track] || 'purple';
    const c = document.createElement('div');
    c.className = 'proj-card';
    c.style.borderColor = `var(--${color})`;
    
    const stack = (p.stack || '').split(',').map(s=>s.trim()).filter(s=>s).map(s=>`<span class="pchip2">${s}</span>`).join('');
    const repoLink = p.repo ? `<a href="${p.repo}" target="_blank" class="proj-repo-link">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
      ${p.repo.replace('https://github.com/','')}
    </a>` : '';
    
    let statusBadge = '';
    if(p.status==='building') statusBadge = '<span class="badge b-purple">Building</span>';
    else if(p.status==='shipped') statusBadge = '<span class="badge b-green">Shipped</span>';
    else if(p.status==='review') statusBadge = '<span class="badge b-orange">Review</span>';
    else statusBadge = '<span class="badge b-blue">Planning</span>';
    
    c.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="font-family:var(--mono);font-size:11px;font-weight:600;color:var(--muted)">Month 0${p.month} · ${p.track.toUpperCase()}</span>
        ${statusBadge}
      </div>
      <div class="proj-name" style="color:var(--${color})">${p.name}</div>
      <div class="proj-desc">${p.desc}</div>
      <div class="proj-chips">${stack}</div>
      <div class="proj-progress"><div class="proj-progress-fill" style="width:${p.progress}%;background:var(--${color})"></div></div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--hint);margin-top:4px;text-align:right">${p.progress}%</div>
      ${repoLink}
      <div class="proj-actions">
        <button class="btn btn-sm" onclick="editProject('${p.id}')">Edit</button>
        ${p.repo ? `<button class="btn btn-sm" onclick="fetchCommits('${p.repo}')">View Commits</button>` : ''}
      </div>
    `;
    el.appendChild(c);
  });
}

function saveProject(){
  const id = document.getElementById('p-edit-id').value;
  const name = document.getElementById('p-name').value.trim();
  if(!name) return;
  const p = {
    id: id || Date.now().toString(),
    name: name,
    desc: document.getElementById('p-desc').value,
    track: document.getElementById('p-track').value,
    status: document.getElementById('p-status').value,
    month: document.getElementById('p-month').value,
    progress: document.getElementById('p-progress').value,
    stack: document.getElementById('p-stack').value,
    repo: document.getElementById('p-repo').value
  };
  
  if(id) {
    const idx = state.projects.findIndex(x=>x.id===id);
    if(idx>-1) state.projects[idx] = p;
  } else {
    state.projects.push(p);
  }
  save(); closeModals(); renderProjects();
}

function editProject(id){
  const p = state.projects.find(x=>x.id===id);
  if(!p) return;
  document.getElementById('p-edit-id').value = p.id;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-desc').value = p.desc;
  document.getElementById('p-track').value = p.track;
  document.getElementById('p-status').value = p.status;
  document.getElementById('p-month').value = p.month || 1;
  document.getElementById('p-progress').value = p.progress || 0;
  document.getElementById('p-stack').value = p.stack || '';
  document.getElementById('p-repo').value = p.repo || '';
  document.getElementById('proj-modal-title').textContent = 'Edit Project';
  document.getElementById('p-delete-btn').style.display = 'block';
  openModal('project');
}

function deleteProject(){
  const id = document.getElementById('p-edit-id').value;
  if(!id) return;
  if(confirm('Are you sure you want to delete this project?')){
    state.projects = state.projects.filter(x=>x.id!==id);
    save(); closeModals(); renderProjects();
  }
}

// --- GITHUB COMMITS ---
async function fetchCommits(repoUrl){
  openModal('commits');
  const list = document.getElementById('commits-list');
  list.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px">Fetching commits from GitHub...</div>';
  
  try {
    const urlParts = repoUrl.replace('https://github.com/','').replace(/\/$/,'').split('/');
    if(urlParts.length < 2) throw new Error('Invalid GitHub URL');
    const api = `https://api.github.com/repos/${urlParts[0]}/${urlParts[1]}/commits?per_page=15`;
    const res = await fetch(api);
    if(!res.ok) throw new Error('Failed to fetch from GitHub API');
    const commits = await res.json();
    
    list.innerHTML = '';
    commits.forEach(c => {
      const el = document.createElement('div');
      el.className = 'commit-item';
      const date = new Date(c.commit.author.date).toLocaleDateString('en-US',{month:'short',day:'numeric'});
      el.innerHTML = `
        <div class="commit-sha"><a href="${c.html_url}" target="_blank" style="color:var(--purple);text-decoration:none">${c.sha.slice(0,7)}</a></div>
        <div class="commit-msg">${c.commit.message.split('\n')[0]}</div>
        <div class="commit-date">${date}</div>
      `;
      list.appendChild(el);
    });
  } catch(e) {
    list.innerHTML = `<div style="color:var(--red);text-align:center;padding:20px">Error: ${e.message}</div>`;
  }
}

// --- RESOURCES (Drag & Drop) ---
function renderResources(){
  const el = document.getElementById('resources-list');
  const typeF = document.getElementById('res-type-filter').value;
  el.innerHTML = '';
  
  let res = state.resources || [];
  if(typeF !== 'all') res = res.filter(r => r.type === typeF);
  
  if(res.length === 0) {
    el.innerHTML = '<div style="color:var(--hint);text-align:center;padding:40px 0;">No resources found.</div>';
    return;
  }
  
  res.forEach((r, idx) => {
    const d = document.createElement('div');
    d.className = 'res-item';
    d.draggable = true;
    d.dataset.id = r.id;
    
    d.innerHTML = `
      <div class="res-grip">⋮⋮</div>
      <div class="res-type" style="background:var(--${TRACK_COLORS[r.track]||'blue'}b);color:var(--${TRACK_COLORS[r.track]||'blue'})">${r.type}</div>
      <div class="res-title">${r.title}</div>
      <a href="${r.url}" target="_blank" class="res-url">${r.url}</a>
      <button class="btn btn-sm" onclick="editResource('${r.id}')">Edit</button>
      <button class="btn btn-sm" onclick="delResource('${r.id}')">×</button>
    `;
    
    // Drag & Drop events
    d.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', idx); d.classList.add('dragging'); });
    d.addEventListener('dragend', () => { d.classList.remove('dragging'); });
    d.addEventListener('dragover', e => { e.preventDefault(); d.style.borderColor = 'var(--purple)'; });
    d.addEventListener('dragleave', e => { d.style.borderColor = 'var(--border)'; });
    d.addEventListener('drop', e => {
      e.preventDefault();
      d.style.borderColor = 'var(--border)';
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = idx;
      if(fromIdx !== toIdx) {
        const item = state.resources.splice(fromIdx, 1)[0];
        state.resources.splice(toIdx, 0, item);
        save(); renderResources();
      }
    });
    
    el.appendChild(d);
  });
}

function saveResource(){
  const id = document.getElementById('r-edit-id').value;
  const title = document.getElementById('r-title').value.trim();
  if(!title) return;
  const r = {
    id: id || Date.now().toString(),
    title: title,
    url: document.getElementById('r-url').value,
    type: document.getElementById('r-type').value,
    track: document.getElementById('r-track').value
  };
  
  if(id) {
    const idx = state.resources.findIndex(x=>x.id===id);
    if(idx>-1) state.resources[idx] = r;
  } else {
    state.resources.push(r);
  }
  save(); closeModals(); renderResources();
}

function editResource(id){
  const r = state.resources.find(x=>x.id===id);
  if(!r) return;
  document.getElementById('r-edit-id').value = r.id;
  document.getElementById('r-title').value = r.title;
  document.getElementById('r-url').value = r.url;
  document.getElementById('r-type').value = r.type;
  document.getElementById('r-track').value = r.track;
  openModal('resource');
}
function delResource(id){ state.resources = state.resources.filter(x=>x.id!==id); save(); renderResources(); }

// --- JOURNAL ---
function renderJournal(){
  document.getElementById('journal-date').textContent = new Date(activeJournalDate).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
  const ed = document.getElementById('journal-editor');
  ed.textContent = state.journal[activeJournalDate] || '';
}
function shiftJournalDate(dir){
  const d = new Date(activeJournalDate);
  d.setDate(d.getDate() + dir);
  activeJournalDate = d.toISOString().slice(0, 10);
  renderJournal();
}
function goJournalToday(){
  activeJournalDate = new Date().toISOString().slice(0, 10);
  renderJournal();
}
document.getElementById('journal-editor').addEventListener('input', (e) => {
  state.journal[activeJournalDate] = e.target.textContent;
  save();
});

// --- CONTEXT ENGINE ---
function renderContext(){
  const todays=state.targets.filter(t=>t.day===TODAY);
  const doneCount=todays.filter(t=>t.done).length;
  const ctx=`# Context — ${new Date().toISOString().slice(0,10)}
Month ${state.currentMonth} of 6.
Provider Engine: ${state.provider}

## Today's Objective (${doneCount}/${todays.length} completed)
${todays.map(t=>`- [${t.done?'x':' '}] ${t.text}`).join('\n')||'(No targets planned for today)'}

## Active Projects
${state.projects.filter(p=>p.status==='building').map(p=>`- ${p.name}: ${p.progress}% done. Stack: ${p.stack}`).join('\n')||'None'}

## Engineering Protocol
1. Pseudocode before code, always.
2. Project first, cert after.
3. One resource per concept.`;
  document.getElementById('context-preview').textContent=ctx;
}
function copyContext(){
  const btn = document.querySelector('.copy-btn');
  navigator.clipboard.writeText(document.getElementById('context-preview').textContent);
  btn.textContent = "Copied!"; btn.style.background = "var(--green)"; btn.style.color = "var(--bg)";
  setTimeout(() => { btn.textContent = "Copy Markdown"; btn.style.background = ""; btn.style.color = ""; }, 1500);
}

// --- MODALS & ROUTING ---
function show(v){
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
  document.getElementById('view-'+v).classList.add('active');
  if(event&&event.currentTarget)event.currentTarget.classList.add('active');
  
  if(v==='today') renderToday();
  else if(v==='week') renderWeek();
  else if(v==='streak') renderStreak();
  else if(v==='projects') renderProjects();
  else if(v==='resources') renderResources();
  else if(v==='journal') renderJournal();
  // landscape and certs are mostly static or need dedicated rendering if desired
}

function openModal(id){
  document.getElementById('modal-'+id).classList.add('open');
  if(id==='project' && !document.getElementById('p-edit-id').value) {
    document.getElementById('proj-modal-title').textContent = 'New Project';
    document.getElementById('p-delete-btn').style.display = 'none';
  }
}
function closeModals(){
  document.querySelectorAll('.modal-overlay').forEach(x=>x.classList.remove('open'));
  ['t-input','p-name','p-desc','p-stack','p-repo','p-edit-id','r-title','r-url','r-edit-id'].forEach(id=>{
    if(document.getElementById(id)) document.getElementById(id).value='';
  });
}
function addTarget(){
  const text=document.getElementById('t-input').value.trim();
  if(!text)return;
  state.targets.push({id:Date.now().toString(),text,day:document.getElementById('t-day').value,track:document.getElementById('t-track').value,done:false});
  save();closeModals();renderToday();
}
function toggleTarget(id){const t=state.targets.find(x=>x.id===id);if(t){t.done=!t.done;save();renderToday();}}
function delTarget(id){state.targets=state.targets.filter(x=>x.id!==id);save();renderToday();}

function selectProvider(el,p){document.querySelectorAll('.pchip').forEach(c=>c.classList.remove('active'));el.classList.add('active');state.provider=p;save();renderContext();}
function hydrateProviderChips(){document.querySelectorAll('.pchip').forEach(c=>{c.classList.toggle('active',c.dataset.provider===state.provider);});}

// --- DATA SYNC ---
function exportState(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='state.json';a.click();
}
function copyStateToClipboard(){
  navigator.clipboard.writeText(JSON.stringify(state,null,2));
  showToast('State copied to clipboard!');
}
function importFromFile(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const parsed=JSON.parse(ev.target.result);
      if(!parsed||typeof parsed!=='object')throw new Error('Not a valid state object');
      state=parsed;
      if(!state.theme) state.theme = 'dark';
      save();applyTheme();hydrateProviderChips();renderToday();renderStreak();
      showToast('Data imported successfully!', 'success');
    }catch(err){showToast('Import failed: '+err.message, 'error');}
  };
  reader.readAsText(file);
}
function importFromText(){
  try{
    const parsed=JSON.parse(document.getElementById('import-input').value);
    if(!parsed||typeof parsed!=='object')throw new Error('Not a valid state object');
    state=parsed;
    if(!state.theme) state.theme = 'dark';
    save();applyTheme();hydrateProviderChips();renderToday();renderStreak();
    document.getElementById('import-input').value = '';
    showToast('Data imported successfully!', 'success');
  }catch(err){showToast('Import failed: '+err.message, 'error');}
}
function updateSyncStatus(){document.getElementById('sync-status').textContent='local storage · saved '+new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});}

function showToast(msg, type='success'){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderColor = type==='success' ? 'var(--green)' : 'var(--red)';
  t.style.color = type==='success' ? 'var(--green)' : 'var(--red)';
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 3000);
}

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click',function(e){if(e.target===this)closeModals();});
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModals();});

async function boot() {
  try {
    const res = await fetch('./state.json?t=' + Date.now());
    if (res.ok) {
      const serverState = await res.json();
      const serverTime = serverState.lastSync || 0;
      const localTime = state.lastSync || 0;
      // If the file on disk is newer than our local storage, use it!
      if (serverTime > localTime || !localStorage.getItem(KEY)) {
        state = serverState;
        localStorage.setItem(KEY, JSON.stringify(state));
      }
    }
  } catch (e) {
    // probably running on file:// or no server
  }
  
  applyTheme();
  hydrateProviderChips();
  renderToday();
  renderStreak();
}

boot();
