const $ = s => document.querySelector(s);
const SUBJECTS = [
  {name:'Physics',icon:'⚛',desc:'Principles & experiments'},
  {name:'Chemistry',icon:'⚗',desc:'Reactions & lab work'},
  {name:'Data Structures',icon:'⌘',desc:'Algorithms & logic'},
  {name:'Java',icon:'☕',desc:'Programming practice'},
  {name:'DBMS',icon:'▤',desc:'Queries & databases'}
];
const EXPERIMENTS = ['Read the experiment manual','Understand the aim and theory','Prepare the procedure','Complete the lab experiment','Revise viva questions'];
let user = null, selectedSubject = 'Physics', documents = [], progress = {}, authMode = 'login', lastQuiz = null;
const studyCache = Object.create(null);

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3000)}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function api(url,opts={}){
  const headers={...(opts.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(opts.headers||{})};
  const options={...opts,credentials:'same-origin',headers};
  if(opts.body && !(opts.body instanceof FormData) && typeof opts.body!=='string') options.body=JSON.stringify(opts.body);
  const r=await fetch(url,options);let d={};try{d=await r.json()}catch{}
  if(!r.ok)throw new Error(d.error||'Something went wrong.');return d;
}
function renderSubjects(){
  $('#subjectList').innerHTML=SUBJECTS.map(s=>`<button class="subject ${selectedSubject===s.name?'active':''}" data-subject="${esc(s.name)}"><span class="subicon">${s.icon}</span><span><b>${esc(s.name)}</b><small>${documents.filter(d=>d.subject===s.name).length} PDFs</small></span></button>`).join('');
  $('#subjectSelect').innerHTML=SUBJECTS.map(s=>`<option value="${esc(s.name)}" ${s.name===selectedSubject?'selected':''}>${esc(s.name)}</option>`).join('');
}
function renderProgress(){
  const done=EXPERIMENTS.filter(x=>progress[x]).length;
  $('#experiments').innerHTML=EXPERIMENTS.map((x,i)=>`<label class="experiment ${progress[x]?'done':''}"><input type="checkbox" data-exp="${esc(x)}" ${progress[x]?'checked':''}><span>${esc(x)}</span><small>${String(i+1).padStart(2,'0')}</small></label>`).join('');
  $('#doneCount').textContent=`${done}/5`;$('#trackerLabel').textContent=`${Math.round(done/5*100)}% complete`;
  $('#progressBar').style.width=`${done/5*100}%`;
}
function renderDocs(){
  const docs=documents.filter(d=>d.subject===selectedSubject);
  $('#pdfCount').textContent=documents.length;
  $('#docList').innerHTML=docs.length?docs.map(d=>`
    <article class="doc-entry" data-doc-entry="${esc(d.id)}">
      <div class="doc-row">
        <span class="pdf-icon">PDF</span>
        <div class="doc-info"><b>${esc(d.name)}</b><small>${esc(d.subject)} · ${(Number(d.size||0)/1024/1024).toFixed(2)} MB</small></div>
        <div class="doc-actions">
          <button class="smallbtn" data-study="steps" data-id="${esc(d.id)}">Step by Step</button>
          <button class="smallbtn" data-study="viva" data-id="${esc(d.id)}">Summary &amp; Viva</button>
          <button class="smallbtn outline" data-study="text" data-id="${esc(d.id)}">Text</button>
          <button class="smallbtn outline" data-view="${esc(d.id)}">Preview PDF</button>
          <button class="smallbtn danger" data-delete="${esc(d.id)}">Delete</button>
        </div>
      </div>
      <div id="result-${esc(d.id)}" class="result-slot" aria-live="polite"></div>
    </article>`).join(''):`<div class="empty">No PDFs in ${esc(selectedSubject)} yet. Upload your first lab document above.</div>`;
}
async function refresh(){
  const m=await api('/api/me');user=m.user;
  $('#userLabel').textContent=user?`Hi, ${user.name}`:'Guest mode';$('#authButton').textContent=user?'Sign out':'Sign in';
  if(user){documents=await api('/api/documents');progress=await api('/api/progress')}else{documents=[];progress={};Object.keys(studyCache).forEach(k=>delete studyCache[k]);}
  renderSubjects();renderProgress();renderDocs();
  $('#uploadForm').querySelector('button').disabled=!user;$('#generateForm').querySelector('button').disabled=!user;$('#mcqButton').disabled=!user;
}
function openAuth(mode='login'){
  authMode=mode;$('#modal').classList.remove('hidden');$('#authError').textContent='';
  $('#nameWrap').classList.toggle('hidden',mode!=='register');$('#nameInput').required=mode==='register';
  $('#modalTitle').textContent=mode==='register'?'Create your account':'Welcome back';
  $('#loginTab').classList.toggle('active',mode==='login');$('#registerTab').classList.toggle('active',mode==='register');
}
function renderSteps(d){
  const steps=Array.isArray(d.steps)?d.steps:[];
  return `<h4>Implementation plan</h4><p class="muted">Follow these steps in order. Verify each result against the uploaded PDF.</p>${steps.length?`<ol class="step-list">${steps.map(s=>`<li><b>${esc(s.title||'Step')}</b><p>${esc(s.detail||s.description||s)}</p></li>`).join('')}</ol>`:'<p class="muted">No steps could be generated from the extracted text.</p>'}`;
}
function renderSummaryViva(d){
  return `<h4>Simple summary</h4><p class="study-summary">${esc(d.summary||'No summary available.')}</p>${d.keyPoints?.length?`<h4>Important points</h4><ul class="key-points">${d.keyPoints.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:''}<h4>Viva questions and answers</h4>${d.viva?.length?d.viva.map((v,i)=>`<div class="qa"><b>${i+1}. ${esc(v.q)}</b><p>${esc(v.a)}</p></div>`).join(''):'<p class="muted">No viva questions were generated.</p>'}`;
}
function renderTextView(id,d){
  const codes=Array.isArray(d.codeBlocks)?d.codeBlocks:[];
  return `<div class="text-panel-head"><div><h4>Extracted PDF text</h4><p class="muted">Text is shown in document order. Code sections detected in the PDF are listed below.</p></div><button class="smallbtn" data-copy-text="${esc(id)}">Copy Text</button></div><pre class="extracted-text">${esc(d.text||'No readable text was extracted.')}</pre><div class="code-heading"><h4>Code found in the PDF</h4><span class="pill">${codes.length} block${codes.length===1?'':'s'}</span></div>${codes.length?codes.map((c,i)=>`<section class="code-card"><div class="code-card-head"><div><b>${esc(c.title||`Code block ${i+1}`)}</b><span class="code-language">${esc(c.language||'text')}</span></div><button class="smallbtn" data-copy-code="${esc(id)}" data-code-index="${i}">Copy Code</button></div><pre class="code-text"><code>${esc(c.code)}</code></pre></section>`).join(''):'<p class="muted">No clear code blocks were detected. The full extracted text above is still available to copy.</p>'}`;
}
function renderStudy(id,mode){
  const d=studyCache[String(id)];const slot=$(`#result-${CSS.escape(String(id))}`);if(!slot||!d)return;
  const label={steps:'Step by Step',viva:'Summary & Viva',text:'Text'}[mode]||'Study materials';
  let content=mode==='steps'?renderSteps(d):mode==='viva'?renderSummaryViva(d):renderTextView(id,d);
  slot.innerHTML=`<section class="study-panel"><div class="study-panel-head"><div><span class="eyebrow">LABPREP AI · ${esc(label.toUpperCase())}</span><h3>${esc(d.title||'PDF study material')}</h3></div><button class="smallbtn outline" data-close-study="${esc(id)}" aria-label="Close study view">Close</button></div>${d.note?`<p class="study-note">${esc(d.note)}</p>`:''}${content}</section>`;
}
async function openStudy(id,mode){
  const slot=$(`#result-${CSS.escape(String(id))}`);if(!slot)return;
  if(!user){openAuth();return;}
  if(!studyCache[String(id)]){
    slot.innerHTML='<div class="study-panel"><p class="muted">Reading the PDF and preparing study materials. Longer documents may take a little time…</p><div class="loading-line"></div></div>';
    try{studyCache[String(id)]=await api(`/api/documents/${encodeURIComponent(id)}/study`,{method:'POST',body:{}});}
    catch(err){slot.innerHTML=`<div class="study-panel"><p class="error">${esc(err.message)}</p><button class="smallbtn outline" data-retry-study="${esc(id)}" data-study="${esc(mode)}">Try again</button></div>`;return;}
  }
  renderStudy(id,mode);
  slot.scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function copyToClipboard(text){
  try{
    if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);toast('Copied to clipboard.');return;}
  }catch{}
  const box=document.createElement('textarea');box.value=text;box.setAttribute('readonly','');box.style.position='fixed';box.style.opacity='0';document.body.appendChild(box);box.select();
  const ok=document.execCommand('copy');box.remove();toast(ok?'Copied to clipboard.':'Copy was blocked by the browser.');
}

$('#authButton').onclick=async()=>{
  if(user){try{await api('/api/logout',{method:'POST',body:{}});await refresh();toast('Signed out.')}catch(e){toast(e.message)}}else openAuth();
};
$('#closeModal').onclick=()=>$('#modal').classList.add('hidden');$('#loginTab').onclick=()=>openAuth('login');$('#registerTab').onclick=()=>openAuth('register');
$('#authForm').onsubmit=async e=>{
  e.preventDefault();$('#authError').textContent='';
  try{await api('/api/'+(authMode==='login'?'login':'register'),{method:'POST',body:{name:$('#nameInput').value,email:$('#emailInput').value,password:$('#passwordInput').value}});$('#modal').classList.add('hidden');await refresh();toast('You are signed in.');}
  catch(err){$('#authError').textContent=err.message;}
};
$('#subjectList').onclick=e=>{const b=e.target.closest('[data-subject]');if(!b)return;selectedSubject=b.dataset.subject;renderSubjects();renderDocs()};
$('#subjectSelect').onchange=e=>{selectedSubject=e.target.value;renderSubjects();renderDocs()};
$('#uploadJump').onclick=()=>{if(!user)return openAuth();$('#documents').scrollIntoView({behavior:'smooth'})};
$('#practiceJump').onclick=()=>$('#practice').scrollIntoView({behavior:'smooth'});
$('#uploadForm').onsubmit=async e=>{
  e.preventDefault();if(!user)return openAuth();const f=$('#pdfInput').files[0];if(!f)return;
  if(f.size>20*1024*1024)return toast('PDF must be smaller than 20 MB.');
  const button=$('#uploadForm').querySelector('button');button.disabled=true;button.textContent='Uploading…';
  const data=new FormData();data.append('pdf',f);data.append('subject',selectedSubject);
  try{const d=await api('/api/documents',{method:'POST',body:data});$('#pdfInput').value='';await refresh();toast(`PDF uploaded. Choose Step by Step, Summary & Viva, or Text for “${d.name}”.`);}
  catch(err){toast(err.message)}finally{button.disabled=!user;button.textContent='Upload PDF';}
};
$('#docList').onclick=async e=>{
  const study=e.target.closest('[data-study]'), retry=e.target.closest('[data-retry-study]'), view=e.target.closest('[data-view]'), del=e.target.closest('[data-delete]'), copyText=e.target.closest('[data-copy-text]'), copyCode=e.target.closest('[data-copy-code]'), close=e.target.closest('[data-close-study]');
  try{
    if(study){await openStudy(study.dataset.id,study.dataset.study);return;}
    if(retry){await openStudy(retry.dataset.id,retry.dataset.study);return;}
    if(close){const slot=$(`#result-${CSS.escape(String(close.dataset.closeStudy))}`);if(slot)slot.innerHTML='';return;}
    if(copyText){const d=studyCache[String(copyText.dataset.copyText)];if(d)await copyToClipboard(d.text||'');return;}
    if(copyCode){const d=studyCache[String(copyCode.dataset.copyCode)];const block=d?.codeBlocks?.[Number(copyCode.dataset.codeIndex)];if(block)await copyToClipboard(block.code);return;}
    if(view){const response=await fetch(`/api/documents/${encodeURIComponent(view.dataset.view)}/file`,{credentials:'same-origin'});if(!response.ok)throw new Error('Could not open PDF. Please sign in again and retry.');const blob=await response.blob(),url=URL.createObjectURL(blob),w=window.open(url,'_blank');if(!w)toast('Allow pop-ups to preview PDFs.');setTimeout(()=>URL.revokeObjectURL(url),60000);return;}
    if(del){if(!confirm('Delete this PDF and its saved file?'))return;await api('/api/documents/'+encodeURIComponent(del.dataset.delete),{method:'DELETE'});delete studyCache[String(del.dataset.delete)];await refresh();toast('PDF deleted.');return;}
  }catch(err){toast(err.message)}
};
$('#experiments').onchange=async e=>{
  const c=e.target.closest('[data-exp]');if(!c)return;if(!user){c.checked=false;return openAuth()}
  try{progress=await api('/api/progress',{method:'POST',body:{key:c.dataset.exp,done:c.checked}});renderProgress()}catch(err){toast(err.message)}
};
$('#generateForm').onsubmit=async e=>{
  e.preventDefault();if(!user)return openAuth();
  try{const d=await api('/api/generate',{method:'POST',body:{topic:$('#topicInput').value}});$('#vivaResults').innerHTML=`<p class="muted">${esc(d.note)}</p>`+d.viva.map(x=>`<div class="qa"><b>${esc(x.q)}</b><p>${esc(x.a)}</p></div>`).join('');}
  catch(err){toast(err.message)}
};
$('#mcqButton').onclick=async()=>{
  if(!user)return openAuth();
  try{lastQuiz=await api('/api/generate',{method:'POST',body:{topic:$('#topicInput').value||selectedSubject}});$('#mcqResults').innerHTML=lastQuiz.mcq.map((q,i)=>`<div class="quiz-q"><b>${i+1}. ${esc(q.q)}</b>${q.options.map((o,j)=>`<label><input type="radio" name="q${i}" value="${j}">${esc(o)}</label>`).join('')}</div>`).join('')+'<button id="gradeQuiz" class="full">Check answers</button><div id="quizScore"></div>';
    $('#gradeQuiz').onclick=()=>{let score=0;lastQuiz.mcq.forEach((q,i)=>{const a=document.querySelector(`input[name="q${i}"]:checked`);if(a&&Number(a.value)===q.answer)score++});$('#quizScore').innerHTML=`<p class="score">Your score: ${score}/${lastQuiz.mcq.length}</p>`};
  }catch(err){toast(err.message)}
};
refresh().catch(()=>toast('Could not connect to the server. Refresh the page.'));
