/* =========================================================
   ESCALA WEB — ENGINE FINAL (LIMPO / MODULAR / ESTÁVEL)
   - 4 escalas fixas: UPA DIA/NOITE, HOB DIA/NOITE
   - Dias livres por mês (3 dias / 4 dias / qualquer)
   - Setores com quantidade (n)
   - Inserção manual com:
       * bloqueio por ocorrência
       * bloqueio duplicidade no mesmo dia (NORMAL)
       * EXTRA permitido apenas no turno oposto (mesmo dia)
       * aviso (confirm) ao quebrar ciclo 30h/40h
   - Distribuição automática com:
       * rodízio contínuo mensal (ponteiro)
       * respeita ocorrência, duplicidade e ciclo (sem forçar)
       * 2 modos: preencher vazios ou apagar+redistribuir
       * se faltar gente, deixa em branco
   - Resumo mensal separado por escala (tabela)
   - Export CSV, XLSX (se CDN carregar), imprimir/PDF
   - Persistência localStorage (sem Firebase por enquanto)
========================================================= */

const APP_KEY = "escala_web_state_v3";

/* ====== Escalas fixas ====== */
const SCALE_DEFS = [
  { id:"UPA_DIA",   name:"UPA DIA",   unit:"UPA", shift:"DIA"   },
  { id:"UPA_NOITE", name:"UPA NOITE", unit:"UPA", shift:"NOITE" },
  { id:"HOB_DIA",   name:"HOB DIA",   unit:"HOB", shift:"DIA"   },
  { id:"HOB_NOITE", name:"HOB NOITE", unit:"HOB", shift:"NOITE" },
];

/* ====== Setores default (você pode editar no menu) ======
   Obs: o mês atual usa snapshot. Mudou setor? Use Resetar mês (escala).
*/
const DEFAULT_SECTORS_UPA = [
  "SALA DE EMERGÊNCIA - LEITO 1-2 (4)",
  "SALA DE EMERGÊNCIA - LEITO 3-4 (4)",
  "SALA DE EMERGÊNCIA - LEITO 5-6 (4)",
  "SALA DE EMERGÊNCIA - LEITO 7-8 (4)",
  "FLUXISTA (1)",
  "FAST (1)",
  "MEDICAÇÃO (2)",
  "UDC (2)",
  "MACAS (2)",
  "AMARELINHA ISOLADO (2)",
  "AMARELA GRANDE - LEITO 1-5 (4)",
  "AMARELA GRANDE - LEITO 6-9 (4)",
  "AMARELA GRANDE - LEITO 10-14 (4)",
  "AMARELA GRANDE - LEITO 15-18 (4)",
  "MATERIAL (1)"
];

const DEFAULT_SECTORS_HOB = [
  "SALA DE EMERGÊNCIA - LEITO 1-2 (4)",
  "SALA DE EMERGÊNCIA - LEITO 3-4 (4)",
  "SALA DE EMERGÊNCIA - LEITO 5-6 (4)",
  "SALA DE EMERGÊNCIA - LEITO 7-8 (4)",
  "CORREDOR (4)",
  "VASCULAR (2)",
  "FLUXISTA P.S (1)",
  "UPP (1)",
  "OBSERVAÇÃO TRAUMA (2)",
  "FLUXISTA EXT/DV (1)",
  "ORTOPEDIA (1)"
];

/* ====== Helpers ====== */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function uid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }
function pad2(n){ return String(n).padStart(2,"0"); }
function normName(s){ return (s||"").trim().replace(/\s+/g," "); }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function clampInt(n,a,b){ if(Number.isNaN(n)) return a; return Math.max(a, Math.min(b,n)); }
function monthDays(y,m){ return new Date(y, m+1, 0).getDate(); }
function ymKey(y,m){ return `${y}-${pad2(m+1)}`; }
function ymd(y,m,d){ return `${y}-${pad2(m+1)}-${pad2(d)}`; }
function parseISO(s){
  const [Y,M,D] = String(s||"").split("-").map(x=>parseInt(x,10));
  if(!Y||!M||!D) return null;
  return new Date(Y, M-1, D);
}
function dateInRange(dateISO, startISO, endISO){
  const d = parseISO(dateISO), s = parseISO(startISO), e = parseISO(endISO);
  if(!d||!s||!e) return false;
  const t=d.getTime(), ts=s.getTime(), te=e.getTime();
  return t>=ts && t<=te;
}
function dowLabel(y,m,d){
  const w = new Date(y,m,d).getDay();
  return ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][w];
}

/* ====== Setor parser "nome (n)" ====== */
function sectorFromLabel(label){
  const m = String(label).match(/^(.*?)(?:\s*\((\d+)\))?\s*$/);
  const name = normName(m?.[1] ?? label);
  const req  = clampInt(parseInt(m?.[2] ?? "4", 10), 1, 12);
  return { id: uid(), name, required: req };
}

/* ====== State ====== */
function makeDefaultState(){
  return {
    version: 3,
    activeView: "SCALES", // SCALES | TECHS | OCC | SUMMARY
    activeScaleId: SCALE_DEFS[0].id,
    scales: SCALE_DEFS.map(sd => ({
      ...sd,
      sectors: (sd.unit==="UPA" ? DEFAULT_SECTORS_UPA : DEFAULT_SECTORS_HOB).map(sectorFromLabel),
    })),
    // tech: {id,name,upa,hob,dia,noite,workload:"30"|"40"}
    techs: [],
    // occ: {id,techId,type,start,end}
    occurrences: [],
    // data[scaleId][ym] = { sectorsSnapshot, selectedDays, pointer, days }
    // days[d][sectorId] = slots (len=required) each slot {techId|null, cov:"NORMAL|EXTRA"}
    data: {}
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(APP_KEY);
    if(!raw) return makeDefaultState();
    const obj = JSON.parse(raw);
    if(!obj || typeof obj!=="object") return makeDefaultState();
    // migração defensiva
    obj.data ||= {};
    obj.techs ||= [];
    obj.occurrences ||= [];
    obj.scales ||= makeDefaultState().scales;
    obj.activeView ||= "SCALES";
    obj.activeScaleId ||= SCALE_DEFS[0].id;
    return obj;
  }catch{
    return makeDefaultState();
  }
}

let state = loadState();

function saveState(){
  localStorage.setItem(APP_KEY, JSON.stringify(state));
  const el = $("#saveState");
  if(el){
    el.textContent = "Salvo ✅";
    el.style.opacity = "1";
    setTimeout(()=>{ el.style.opacity="0.85"; }, 700);
  }
}

/* ====== getters ====== */
function getScale(scaleId){ return state.scales.find(s=>s.id===scaleId); }
function getScaleDef(scaleId){ return SCALE_DEFS.find(s=>s.id===scaleId); }

/* ====== month data (CORRIGIDO) ====== */
function ensureMonthData(scaleId, y, m){
  const ym = ymKey(y,m);
  state.data ||= {};
  state.data[scaleId] ||= {};
  if(!state.data[scaleId][ym]){
    state.data[scaleId][ym] = {
      sectorsSnapshot: getScale(scaleId).sectors.map(s => ({...s})),
      selectedDays: [],
      pointer: 0,
      days: {}
    };
  } else {
    // garantir snapshot e campos
    const md = state.data[scaleId][ym];
    md.sectorsSnapshot ||= getScale(scaleId).sectors.map(s => ({...s}));
    md.selectedDays ||= [];
    md.pointer = md.pointer || 0;
    md.days ||= {};
  }
  return { ym, md: state.data[scaleId][ym] };
}

/* ====== slots ====== */
function ensureDaySectorSlots(md, day, sector){
  md.days[String(day)] ||= {};
  const dayObj = md.days[String(day)];
  dayObj[sector.id] ||= Array.from({length: sector.required}, ()=>({techId:null, cov:"NORMAL"}));

  // ajustar caso required mudou no snapshot
  const arr = dayObj[sector.id];
  if(arr.length < sector.required){
    for(let i=arr.length;i<sector.required;i++) arr.push({techId:null, cov:"NORMAL"});
  }else if(arr.length > sector.required){
    arr.length = sector.required;
  }
  return dayObj[sector.id];
}

/* ====== Ocorrência / elegibilidade ====== */
function techUnavailableOn(techId, dateISO){
  return state.occurrences.some(o => o.techId===techId && dateInRange(dateISO, o.start, o.end));
}

function techEligibleForScale(tech, scaleId){
  const def = getScaleDef(scaleId);
  const okUnit  = (def.unit==="UPA" ? !!tech.upa : !!tech.hob);
  const okShift = (def.shift==="DIA" ? !!tech.dia : !!tech.noite);
  return okUnit && okShift;
}

function listEligibleTechs(scaleId, y, m, d){
  const dateISO = ymd(y,m,d);
  return state.techs.filter(t =>
    techEligibleForScale(t, scaleId) &&
    !techUnavailableOn(t.id, dateISO)
  );
}

/* ====== assignments across all scales (same day) ======
   Map techId -> [{scaleId, shift, cov}]
*/
function dayAssignmentsAllScales(y,m,d){
  const res = new Map();
  for(const sc of SCALE_DEFS){
    const { md } = ensureMonthData(sc.id, y, m);
    const sectors = md.sectorsSnapshot || [];
    const dayObj = md.days[String(d)] || {};
    for(const sec of sectors){
      const slots = dayObj[sec.id] || [];
      for(const slot of slots){
        if(!slot?.techId) continue;
        const arr = res.get(slot.techId) || [];
        arr.push({ scaleId: sc.id, shift: sc.shift, cov: slot.cov || "NORMAL" });
        res.set(slot.techId, arr);
      }
    }
  }
  return res;
}

function techWorkedOnDay(techId, y,m,d){
  if(d<=0) return false;
  const all = dayAssignmentsAllScales(y,m,d);
  return (all.get(techId) || []).length > 0;
}

/* ====== Ciclo 30/40 (não importa turno) ====== */
function violatesCycle(tech, y,m,d){
  const wl = String(tech.workload || "40");
  if(wl === "40"){
    return techWorkedOnDay(tech.id, y,m, d-1);
  }
  // 30h
  return techWorkedOnDay(tech.id, y,m, d-1) || techWorkedOnDay(tech.id, y,m, d-2);
}

/* ====== Regras de duplicidade por dia ======
   NORMAL: não pode se já existe em qualquer escala no dia
   EXTRA: pode se NÃO existe no mesmo turno (DIA/NOITE)
*/
function canAssignTech({techId, scaleId, y,m,d, cov}){
  const def = getScaleDef(scaleId);
  const all = dayAssignmentsAllScales(y,m,d);
  const existing = all.get(techId) || [];
  if(existing.length===0) return true;
  if(cov === "NORMAL") return false;
  // EXTRA: bloquear se já tem no mesmo turno
  return !existing.some(e => e.shift === def.shift);
}

function findTechByNameExact(name){
  const nn = normName(name).toLowerCase();
  return state.techs.find(t => t.name.toLowerCase()===nn) || null;
}

/* ====== Dias exibidos no quadro ====== */
function getDisplayDays(md, y, m){
  const dim = monthDays(y,m);
  if(md.selectedDays?.length){
    return md.selectedDays.filter(d=>d>=1&&d<=dim).sort((a,b)=>a-b);
  }
  // default: 3 dias
  return [1,2,3].filter(d=>d<=dim);
}

/* =========================================================
   UI BINDINGS
========================================================= */

let activeScaleId = state.activeScaleId || SCALE_DEFS[0].id;
let activeMonth = new Date().getMonth();
let activeYear  = new Date().getFullYear();

/* ====== Elementos principais ====== */
function els(){
  return {
    navEl: $("#nav"),
    viewScales: $("#viewScales"),
    viewTechs: $("#viewTechs"),
    viewOcc: $("#viewOcc"),
    viewSummary: $("#viewSummary"),
    tableWrap: $("#tableWrap"),
    tableTitle: $("#tableTitle"),
    tableMeta: $("#tableMeta"),
    monthSel: $("#monthSel"),
    yearSel: $("#yearSel"),
    btnPrint: $("#btnPrint"),
    btnExportCSV: $("#btnExportCSV"),
    btnExportXLSX: $("#btnExportXLSX"),
    btnResetMonth: $("#btnResetMonth"),

    overlay: $("#overlay"),
    overlayAuto: $("#overlayAuto"),

    btnClose: $("#btnClose"),
    btnDone: $("#btnDone"),
    btnAddManual: $("#btnAddManual"),
    btnClearCell: $("#btnClearCell"),
    btnAutoFillHere: $("#btnAutoFillHere"),

    nameInput: $("#nameInput"),
    covSel: $("#covSel"),
    techDatalist: $("#techDatalist"),
    manualNote: $("#manualNote"),
    slotList: $("#slotList"),

    btnCloseAuto: $("#btnCloseAuto"),
    btnRunAuto: $("#btnRunAuto"),
    autoSub: $("#autoSub"),
  };
}

/* ====== Navegação ====== */
function setView(v){
  state.activeView = v;
  saveState();
  renderAll();
}

function renderNav(){
  const { navEl } = els();
  if(!navEl) return;

  const items = [
    { id:"SCALES",  label:"📅 Escalas" },
    { id:"TECHS",   label:"👥 Técnicos" },
    { id:"OCC",     label:"🩺 Ocorrências" },
    { id:"SUMMARY", label:"📊 Resumo Mensal" },
  ];

  navEl.innerHTML = "";
  for(const it of items){
    const div = document.createElement("div");
    div.className = "item" + (state.activeView===it.id ? " active":"");
    div.textContent = it.label;
    div.addEventListener("click", ()=> setView(it.id));
    navEl.appendChild(div);
  }
}

/* ====== Month/year selectors ====== */
function initMonthYear(){
  const { monthSel, yearSel } = els();
  if(!monthSel || !yearSel) return;

  const months = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  monthSel.innerHTML = months.map((n,i)=>`<option value="${i}">${n}</option>`).join("");

  const y0 = new Date().getFullYear()-2;
  const y1 = new Date().getFullYear()+3;
  yearSel.innerHTML = Array.from({length:(y1-y0+1)}, (_,k)=>`<option value="${y0+k}">${y0+k}</option>`).join("");

  monthSel.value = String(activeMonth);
  yearSel.value  = String(activeYear);

  monthSel.addEventListener("change", ()=>{
    activeMonth = parseInt(monthSel.value,10);
    renderAll();
  });
  yearSel.addEventListener("change", ()=>{
    activeYear = parseInt(yearSel.value,10);
    renderAll();
  });
}

/* =========================================================
   VIEW: SCALES (tabs + days picker + sectors editor)
========================================================= */

function renderScaleTabs(container){
  container.innerHTML = `
    <div>
      <div class="muted" style="font-weight:1000;margin-bottom:8px">Escala ativa</div>
      <div class="tabs" id="tabs"></div>
    </div>
  `;
  const tabs = container.querySelector("#tabs");
  tabs.innerHTML = "";
  for(const sc of state.scales){
    const b = document.createElement("div");
    b.className = "tab" + (sc.id===activeScaleId ? " active":"");
    b.textContent = sc.name;
    b.addEventListener("click", ()=>{
      activeScaleId = sc.id;
      state.activeScaleId = activeScaleId;
      saveState();
      renderAll();
    });
    tabs.appendChild(b);
  }
}

function renderDaysPicker(container){
  const daysInMonth = monthDays(activeYear, activeMonth);
  const { md } = ensureMonthData(activeScaleId, activeYear, activeMonth);

  container.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="muted" style="font-weight:1000">Dias para lançar (livre)</div>
      <div class="row">
        <button class="mini-btn" id="btnClearDays">Limpar</button>
        <button class="mini-btn primary" id="btnShowMonth">Mês inteiro</button>
      </div>
    </div>
    <div class="help">Marque 3 dias (terça) ou 4 dias (sexta), ou qualquer combinação. Para caber em 1 folha, use poucos dias.</div>
    <div class="days" id="daysGrid"></div>

    <div class="sep"></div>

    <div class="row" style="justify-content:space-between">
      <div class="muted" style="font-weight:1000">Ações</div>
      <button class="btn primary" id="btnOpenAuto">⚡ Distribuir automático</button>
    </div>
    <div class="help">Automático respeita: quantidade por setor, ocorrências, duplicidade e ciclo 30/40h. Se faltar gente, deixa em branco.</div>
  `;

  const grid = container.querySelector("#daysGrid");
  grid.innerHTML = "";
  for(let d=1; d<=daysInMonth; d++){
    const btn = document.createElement("div");
    const on = md.selectedDays.includes(d);
    btn.className = "daybtn " + (on ? "on":"off");
    btn.textContent = pad2(d);
    btn.addEventListener("click", ()=>{
      const idx = md.selectedDays.indexOf(d);
      if(idx>=0) md.selectedDays.splice(idx,1);
      else md.selectedDays.push(d);
      md.selectedDays.sort((a,b)=>a-b);
      saveState();
      renderAll();
    });
    grid.appendChild(btn);
  }

  container.querySelector("#btnClearDays").addEventListener("click", ()=>{
    md.selectedDays = [];
    saveState();
    renderAll();
  });
  container.querySelector("#btnShowMonth").addEventListener("click", ()=>{
    md.selectedDays = Array.from({length:daysInMonth}, (_,k)=>k+1);
    saveState();
    renderAll();
  });
  container.querySelector("#btnOpenAuto").addEventListener("click", openAutoModal);
}

function renderSectorsPanel(container){
  const sc = getScale(activeScaleId);

  container.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="muted" style="font-weight:1000">Setores (nome + quantidade)</div>
      <button class="mini-btn primary" id="btnAddSector">➕ Setor</button>
    </div>
    <div class="help">Você pode digitar “(n)” no nome ou ajustar no campo quantidade. (Isso vale para próximos meses; o mês atual usa snapshot.)</div>
    <div class="list" id="sectorList"></div>
    <div class="sep"></div>
    <div class="help">Se quiser aplicar mudanças nos setores ao mês atual, use “Resetar mês (escala)”.</div>
  `;

  const list = container.querySelector("#sectorList");
  list.innerHTML = "";

  sc.sectors.forEach((sec, idx)=>{
    const row = document.createElement("div");
    row.className = "chiprow";
    row.innerHTML = `
      <div class="meta" style="flex:1">
        <div class="t">Setor</div>
        <div class="inline" style="margin-top:6px">
          <input value="${escapeHtml(sec.name)}" style="flex:1;min-width:180px" />
          <input type="number" min="1" max="12" value="${sec.required}" style="width:92px" />
        </div>
        <div class="s">Ex.: ${escapeHtml(sec.name)} (${sec.required})</div>
      </div>
      <div class="inline">
        <button class="mini-btn danger">🗑️</button>
      </div>
    `;

    const nameInp = row.querySelectorAll("input")[0];
    const reqInp  = row.querySelectorAll("input")[1];
    const delBtn  = row.querySelector("button");

    nameInp.addEventListener("change", ()=>{
      const raw = normName(nameInp.value);
      const parsed = sectorFromLabel(raw);
      sec.name = parsed.name;
      if(raw.match(/\(\d+\)/)) sec.required = parsed.required;
      saveState();
      renderAll();
    });
    reqInp.addEventListener("change", ()=>{
      sec.required = clampInt(parseInt(reqInp.value,10),1,12);
      saveState();
      renderAll();
    });
    delBtn.addEventListener("click", ()=>{
      sc.sectors.splice(idx,1);
      saveState();
      renderAll();
    });

    list.appendChild(row);
  });

  container.querySelector("#btnAddSector").addEventListener("click", ()=>{
    sc.sectors.push({ id: uid(), name:`Novo setor ${sc.sectors.length+1}`, required:1 });
    saveState();
    renderAll();
  });
}

function renderScalesView(){
  const { viewScales } = els();
  if(!viewScales) return;

  viewScales.innerHTML = "";
  renderScaleTabs(viewScales);

  const box1 = document.createElement("div");
  box1.className = "stack";
  viewScales.appendChild(box1);
  renderDaysPicker(box1);

  const box2 = document.createElement("div");
  box2.className = "stack";
  viewScales.appendChild(box2);
  renderSectorsPanel(box2);
}

/* =========================================================
   VIEW: TECHS
========================================================= */

function renderTechsView(){
  const { viewTechs } = els();
  if(!viewTechs) return;

  viewTechs.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="muted" style="font-weight:1000">Cadastro de Técnicos</div>
      <button class="btn primary" id="btnAddTech">➕ Técnico</button>
    </div>
    <div class="help">Escolha carga 30h (1x2) ou 40h (1x1). Marque onde pode aparecer (UPA/HOB e DIA/NOITE).</div>
    <div class="list" id="techList"></div>
  `;

  const list = viewTechs.querySelector("#techList");
  list.innerHTML = "";

  state.techs
    .slice()
    .sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"))
    .forEach((t, idx)=>{
      const row = document.createElement("div");
      row.className = "chiprow";
      row.innerHTML = `
        <div class="meta" style="flex:1">
          <div class="t">${escapeHtml(t.name)}</div>
          <div class="inline" style="margin-top:6px">
            <label class="inline"><input type="checkbox" ${t.upa?"checked":""}> UPA</label>
            <label class="inline"><input type="checkbox" ${t.hob?"checked":""}> HOB</label>
            <label class="inline"><input type="checkbox" ${t.dia?"checked":""}> DIA</label>
            <label class="inline"><input type="checkbox" ${t.noite?"checked":""}> NOITE</label>
            <label class="inline">
              <span class="muted" style="font-weight:1000">Carga:</span>
              <select>
                <option value="30" ${String(t.workload)==="30"?"selected":""}>30h (1x2)</option>
                <option value="40" ${String(t.workload)==="40"?"selected":""}>40h (1x1)</option>
              </select>
            </label>
          </div>
        </div>
        <div class="inline">
          <button class="mini-btn danger">🗑️</button>
        </div>
      `;

      const cbs = row.querySelectorAll('input[type="checkbox"]');
      const sel = row.querySelector("select");

      cbs[0].addEventListener("change", ()=>{ t.upa = cbs[0].checked; saveState(); });
      cbs[1].addEventListener("change", ()=>{ t.hob = cbs[1].checked; saveState(); });
      cbs[2].addEventListener("change", ()=>{ t.dia = cbs[2].checked; saveState(); });
      cbs[3].addEventListener("change", ()=>{ t.noite = cbs[3].checked; saveState(); });
      sel.addEventListener("change", ()=>{ t.workload = sel.value; saveState(); });

      row.querySelector("button").addEventListener("click", ()=>{
        const ok = confirm(`Remover ${t.name}? (ocorrências também serão removidas)`);
        if(!ok) return;
        state.techs = state.techs.filter(x=>x.id!==t.id);
        state.occurrences = state.occurrences.filter(o=>o.techId!==t.id);
        saveState();
        renderAll();
      });

      list.appendChild(row);
    });

  viewTechs.querySelector("#btnAddTech").addEventListener("click", ()=>{
    const name = prompt("Nome do técnico:");
    if(!name) return;
    const nn = normName(name);
    if(!nn) return;
    if(state.techs.some(x=>x.name.toLowerCase()===nn.toLowerCase())){
      alert("Já existe um técnico com esse nome.");
      return;
    }
    const wl = prompt("Carga horária (30 ou 40):", "40");
    const workload = (String(wl).trim()==="30") ? "30" : "40";
    state.techs.push({ id: uid(), name: nn, upa:true, hob:false, dia:true, noite:true, workload });
    saveState();
    renderAll();
  });
}

/* =========================================================
   VIEW: OCCURRENCES
========================================================= */

function renderOccView(){
  const { viewOcc } = els();
  if(!viewOcc) return;

  viewOcc.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="muted" style="font-weight:1000">Ocorrências (por período)</div>
      <button class="btn primary" id="btnAddOcc">➕ Ocorrência</button>
    </div>
    <div class="help">Durante o período, o técnico não entra no automático e não aparece para inserção manual.</div>
    <div class="list" id="occList"></div>
  `;

  const techById = new Map(state.techs.map(t=>[t.id,t]));
  const list = viewOcc.querySelector("#occList");
  list.innerHTML = "";

  const occSorted = [...state.occurrences].sort((a,b)=>(a.start+a.end).localeCompare(b.start+b.end));
  for(const o of occSorted){
    const t = techById.get(o.techId);
    const row = document.createElement("div");
    row.className = "chiprow";
    row.innerHTML = `
      <div class="meta" style="flex:1">
        <div class="t">${escapeHtml(t ? t.name : "(técnico removido)")}</div>
        <div class="s">${escapeHtml(o.type)} • ${escapeHtml(o.start)} até ${escapeHtml(o.end)}</div>
      </div>
      <div class="inline">
        <button class="mini-btn danger">🗑️</button>
      </div>
    `;
    row.querySelector("button").addEventListener("click", ()=>{
      state.occurrences = state.occurrences.filter(x=>x.id!==o.id);
      saveState();
      renderAll();
    });
    list.appendChild(row);
  }

  viewOcc.querySelector("#btnAddOcc").addEventListener("click", ()=>{
    if(state.techs.length===0){ alert("Cadastre técnicos primeiro."); return; }

    const q = prompt("Buscar técnico pelo nome (ou parte):");
    if(q===null) return;
    const qq = normName(q).toLowerCase();
    const matches = state.techs.filter(t=>t.name.toLowerCase().includes(qq));
    if(matches.length===0){ alert("Não encontrei."); return; }

    let pick = matches[0];
    if(matches.length>1){
      const opts = matches.slice(0,20).map((t,i)=>`${i+1}. ${t.name}`).join("\n");
      const idxStr = prompt(`Vários encontrados. Escolha pelo número:\n${opts}`);
      const idx = parseInt(idxStr,10);
      if(!idx || idx<1 || idx>Math.min(20,matches.length)) return;
      pick = matches[idx-1];
    }

    const type = prompt("Tipo (ex: Licença médica, Férias, Treinamento):", "Licença médica");
    if(!type) return;

    const start = prompt("Data início (YYYY-MM-DD):", ymKey(activeYear,activeMonth)+"-01");
    if(!start || !parseISO(start)){ alert("Data início inválida."); return; }

    const end = prompt("Data fim (YYYY-MM-DD):", start);
    if(!end || !parseISO(end)){ alert("Data fim inválida."); return; }

    state.occurrences.push({ id: uid(), techId: pick.id, type: normName(type), start, end });
    saveState();
    renderAll();
  });
}

/* =========================================================
   VIEW: SUMMARY (mensal separado por escala)
========================================================= */

function computeMonthlySummary(scaleId, y, m){
  const { md } = ensureMonthData(scaleId, y, m);
  const sectors = md.sectorsSnapshot || [];
  const dim = monthDays(y,m);

  // techId => set of days
  const worked = new Map();

  for(let d=1; d<=dim; d++){
    const dayObj = md.days[String(d)] || {};
    const seenTech = new Set();

    for(const sec of sectors){
      const slots = dayObj[sec.id] || [];
      for(const s of slots){
        if(s?.techId) seenTech.add(s.techId);
      }
    }
    for(const tid of seenTech){
      const set = worked.get(tid) || new Set();
      set.add(d);
      worked.set(tid, set);
    }
  }

  const techById = new Map(state.techs.map(t=>[t.id,t]));
  const rows = [];
  for(const [tid, set] of worked.entries()){
    const t = techById.get(tid);
    if(!t) continue;
    rows.push({ name: t.name, workload: String(t.workload||"40")+"h", days: set.size });
  }
  return rows.sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
}

function renderSummaryView(){
  const { viewSummary } = els();
  if(!viewSummary) return;

  viewSummary.innerHTML = `
    <div class="muted" style="font-weight:1000">Resumo Mensal (por escala)</div>
    <div class="help">Conta quantos dias o técnico apareceu na escala naquele mês (qualquer setor no dia conta 1).</div>
    <div class="sep"></div>
    <div id="summaryTables" class="stack"></div>
  `;

  const holder = viewSummary.querySelector("#summaryTables");
  holder.innerHTML = "";

  for(const sc of state.scales){
    const rows = computeMonthlySummary(sc.id, activeYear, activeMonth);

    const box = document.createElement("div");
    box.className = "note";
    box.innerHTML = `
      <b>${escapeHtml(sc.name)} — ${ymKey(activeYear,activeMonth)}</b>
      <div class="table-wrap" style="margin-top:8px">
        <table style="min-width:600px">
          <thead>
            <tr><th>Técnico</th><th>Carga</th><th>Dias Trabalhados</th></tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map(r=>`
                    <tr>
                      <td>${escapeHtml(r.name)}</td>
                      <td>${escapeHtml(r.workload)}</td>
                      <td>${r.days}</td>
                    </tr>
                  `).join("")
                : `<tr><td colspan="3" class="muted">Sem lançamentos no mês.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;
    holder.appendChild(box);
  }
}

/* =========================================================
   TABELA PRINCIPAL (visual de escala)
========================================================= */

function renderTable(){
  const { tableWrap, tableTitle, tableMeta } = els();
  if(!tableWrap || !tableTitle || !tableMeta) return;

  const sc = getScale(activeScaleId);
  const months = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const { md } = ensureMonthData(activeScaleId, activeYear, activeMonth);

  const sectors = md.sectorsSnapshot || [];
  const days = getDisplayDays(md, activeYear, activeMonth);

  tableTitle.textContent = `🧾 ${sc.name} — ${months[activeMonth]} ${activeYear}`;
  tableMeta.textContent  = `Dias exibidos: ${days.length} • Ponteiro do rodízio: ${md.pointer || 0} • Setores: ${sectors.length}`;

  const techById = new Map(state.techs.map(t=>[t.id,t]));

  let html = `<table><thead><tr>
    <th>DIA</th>
    ${sectors.map(s=>`<th>${escapeHtml(s.name)} <span class="muted" style="font-weight:1000">(${s.required})</span></th>`).join("")}
  </tr></thead><tbody>`;

  for(const d of days){
    html += `<tr>
      <td><div class="day-meta"><div>${pad2(d)}</div><div class="dow">${dowLabel(activeYear, activeMonth, d)}</div></div></td>
      ${sectors.map(sec=>{
        const slots = ensureDaySectorSlots(md, d, sec);
        const missing = slots.some(s=>!s.techId);
        const warnClass = missing ? " warn-missing" : "";
        return `<td>
          <div class="cell${warnClass}" data-day="${d}" data-sector="${sec.id}">
            ${slots.map(slot=>{
              if(!slot.techId) return `<div class="slot empty"><span class="name">—</span></div>`;
              const t = techById.get(slot.techId);
              const nm = t ? t.name : "(removido)";
              const badge = (slot.cov==="EXTRA") ? `<span class="badge extra">EXTRA</span>` : ``;
              return `<div class="slot"><span class="name">${escapeHtml(nm)}</span>${badge}</div>`;
            }).join("")}
          </div>
        </td>`;
      }).join("")}
    </tr>`;
  }

  html += `</tbody></table>`;
  tableWrap.innerHTML = html;

  $$(".cell").forEach(el=>{
    el.addEventListener("click", ()=>{
      const day = parseInt(el.dataset.day,10);
      const sectorId = el.dataset.sector;
      openCellModal(activeScaleId, activeYear, activeMonth, day, sectorId);
    });
  });
}

/* =========================================================
   MODAL: editar célula (manual)
========================================================= */

let modalCtx = null; // {scaleId,y,m,day,sectorId}

function openCellModal(scaleId, y,m, day, sectorId){
  const {
    overlay, nameInput, covSel
  } = els();
  if(!overlay || !nameInput || !covSel) return;

  modalCtx = {scaleId,y,m,day,sectorId};

  const sc = getScale(scaleId);
  const { md } = ensureMonthData(scaleId, y,m);
  const sec = (md.sectorsSnapshot||[]).find(s=>s.id===sectorId);
  if(!sec) return;

  ensureDaySectorSlots(md, day, sec);

  $("#modalTitle").textContent = `📌 Dia ${pad2(day)} — ${sec.name}`;
  $("#modalSub").textContent   = `${sc.name} • ${ymd(y,m,day)}`;

  covSel.value = "NORMAL";
  nameInput.value = "";
  refreshManualUI();

  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden","false");
  nameInput.focus();
}

function closeModal(){
  const { overlay } = els();
  if(!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden","true");
  modalCtx = null;
}

/* ====== UI manual ====== */
function refreshManualUI(){
  if(!modalCtx) return;

  const {
    covSel, techDatalist, manualNote
  } = els();

  const {scaleId,y,m,day,sectorId} = modalCtx;
  const { md } = ensureMonthData(scaleId,y,m);
  const sec = (md.sectorsSnapshot||[]).find(s=>s.id===sectorId);
  const def = getScaleDef(scaleId);
  const cov = covSel.value;

  manualNote.innerHTML = `<b>Turno:</b> ${def.shift} • <b>Modo:</b> ${cov} • <b>Ciclo 30/40h:</b> manual avisa, automático bloqueia`;

  // Elegíveis + sem ocorrência + sem duplicidade (pela regra do cov).
  // (Ciclo no manual é só aviso)
  const elig = listEligibleTechs(scaleId,y,m,day);
  const options = elig.filter(t => canAssignTech({techId:t.id, scaleId, y,m,d:day, cov}));

  techDatalist.innerHTML = options
    .sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"))
    .map(t=>`<option value="${escapeHtml(t.name)}"></option>`)
    .join("");

  const slots = ensureDaySectorSlots(md, day, sec);
  renderSlotList(slots);
}

function renderSlotList(slots){
  const { slotList } = els();
  if(!slotList) return;

  const techById = new Map(state.techs.map(t=>[t.id,t]));
  slotList.innerHTML = "";

  slots.forEach((slot, idx)=>{
    const nm = slot.techId ? (techById.get(slot.techId)?.name ?? "(removido)") : "— (vazio)";
    const row = document.createElement("div");
    row.className = "chiprow";
    row.innerHTML = `
      <div class="meta" style="flex:1">
        <div class="t">Slot ${idx+1}: ${escapeHtml(nm)} ${slot.techId && slot.cov==="EXTRA" ? `<span class="badge extra">EXTRA</span>`:""}</div>
        <div class="s">${slot.techId ? "Use remover para trocar." : "Insira acima para preencher."}</div>
      </div>
      <div class="inline">
        <button class="mini-btn danger" ${slot.techId ? "" : "disabled"}>🗑️ Remover</button>
      </div>
    `;
    row.querySelector("button").addEventListener("click", ()=>{
      slot.techId = null;
      slot.cov = "NORMAL";
      saveState();
      refreshManualUI();
      renderTable();
    });
    slotList.appendChild(row);
  });
}

function addManual(){
  if(!modalCtx) return;

  const { nameInput, covSel } = els();
  const {scaleId,y,m,day,sectorId} = modalCtx;
  const { md } = ensureMonthData(scaleId,y,m);
  const sec = (md.sectorsSnapshot||[]).find(s=>s.id===sectorId);
  if(!sec) return;

  const cov = covSel.value;
  const inputName = normName(nameInput.value);
  if(!inputName){ nameInput.focus(); return; }

  const tech = findTechByNameExact(inputName);
  if(!tech){
    alert("Esse nome não está cadastrado. Cadastre em “Técnicos” para manter regras (carga/ocorrências/eligibilidade).");
    return;
  }

  const dateISO = ymd(y,m,day);
  if(techUnavailableOn(tech.id, dateISO)){
    alert("Este técnico está com ocorrência ativa neste dia. Não pode ser escalado.");
    return;
  }
  if(!techEligibleForScale(tech, scaleId)){
    alert("Este técnico não é elegível para esta escala (UPA/HOB e DIA/NOITE). Ajuste em “Técnicos”.");
    return;
  }

  if(!canAssignTech({techId:tech.id, scaleId, y,m,d:day, cov})){
    alert(cov==="NORMAL"
      ? "Já existe lançamento desse técnico em alguma escala nesse dia (NORMAL não permite duplicar)."
      : "Esse técnico já está no mesmo turno nesse dia. EXTRA só permite no turno oposto.");
    return;
  }

  const cycleBreak = violatesCycle(tech, y,m,day);
  if(cycleBreak){
    const ok = confirm(`⚠️ Atenção: ${tech.name} (${tech.workload}h) deveria estar em folga pelo ciclo.\nDeseja inserir mesmo assim?`);
    if(!ok) return;
  }

  const slots = ensureDaySectorSlots(md, day, sec);
  const idx = slots.findIndex(s=>!s.techId);
  if(idx<0){
    alert("Não há slot vazio. Aumente a quantidade do setor se precisar.");
    return;
  }

  slots[idx].techId = tech.id;
  slots[idx].cov = cov;

  nameInput.value = "";
  saveState();
  refreshManualUI();
  renderTable();
}

/* =========================================================
   MODAL: Distribuição Automática
========================================================= */

function openAutoModal(){
  const { overlayAuto, autoSub } = els();
  if(!overlayAuto || !autoSub) return;

  const { md } = ensureMonthData(activeScaleId, activeYear, activeMonth);
  const days = getDisplayDays(md, activeYear, activeMonth);

  autoSub.textContent = `Escala: ${getScale(activeScaleId).name} • Dias: ${days.join(", ") || "nenhum"}`;
  overlayAuto.classList.add("show");
  overlayAuto.setAttribute("aria-hidden","false");
}

function closeAutoModal(){
  const { overlayAuto } = els();
  if(!overlayAuto) return;
  overlayAuto.classList.remove("show");
  overlayAuto.setAttribute("aria-hidden","true");
}

function getAutoMode(){
  const el = $$('input[name="autofillMode"]').find(x=>x.checked);
  return el?.value || "FILL_EMPTY";
}

/** Automático: respeita tudo (inclusive ciclo) e nunca força. */
function runAutoDistribution({ onlyDay=null } = {}){
  const scaleId = activeScaleId;
  const { md } = ensureMonthData(scaleId, activeYear, activeMonth);
  const sectors = md.sectorsSnapshot || [];
  const mode = getAutoMode();

  const days = onlyDay ? [onlyDay] : getDisplayDays(md, activeYear, activeMonth);
  if(days.length===0){ alert("Selecione os dias primeiro."); return; }
  if(state.techs.length===0){ alert("Cadastre técnicos primeiro."); return; }

  let ptr = md.pointer || 0;

  for(const d of days){
    const eligible = listEligibleTechs(scaleId, activeYear, activeMonth, d);
    const n = eligible.length;

    if(mode==="CLEAR_AND_FILL"){
      md.days[String(d)] ||= {};
      for(const sec of sectors){
        const slots = ensureDaySectorSlots(md, d, sec);
        for(const s of slots){ s.techId=null; s.cov="NORMAL"; }
      }
    }

    for(const sec of sectors){
      const slots = ensureDaySectorSlots(md, d, sec);

      for(let i=0; i<sec.required; i++){
        if(mode==="FILL_EMPTY" && slots[i].techId) continue;

        let chosen = null;
        if(n>0){
          for(let tries=0; tries<n; tries++){
            const t = eligible[ptr % n];
            ptr = (ptr + 1) % n;

            // não duplicar NORMAL no dia
            if(!canAssignTech({techId:t.id, scaleId, y:activeYear,m:activeMonth,d, cov:"NORMAL"})) continue;

            // ciclo bloqueia no automático
            if(violatesCycle(t, activeYear, activeMonth, d)) continue;

            chosen = t;
            break;
          }
        }

        if(!chosen){
          slots[i].techId = null;
          slots[i].cov = "NORMAL";
        }else{
          slots[i].techId = chosen.id;
          slots[i].cov = "NORMAL";
        }
      }
    }
  }

  md.pointer = ptr;
  saveState();
}

/* =========================================================
   EXPORT / PRINT / RESET
========================================================= */

function exportMatrixForActiveScale(){
  const { md } = ensureMonthData(activeScaleId, activeYear, activeMonth);
  const sectors = md.sectorsSnapshot || [];
  const days = getDisplayDays(md, activeYear, activeMonth);
  const techById = new Map(state.techs.map(t=>[t.id,t]));

  const rows = [];
  rows.push(["DIA", ...sectors.map(s=>s.name)]);

  for(const d of days){
    const dayObj = md.days[String(d)] || {};
    const row = [pad2(d)];
    for(const sec of sectors){
      const slots = ensureDaySectorSlots(md, d, sec);
      const names = slots.filter(s=>s.techId).map(s=>techById.get(s.techId)?.name ?? "(removido)");
      row.push(names.join(" | "));
    }
    rows.push(row);
  }
  return rows;
}

function downloadBlob(content, filename, mime){
  const blob = new Blob([content], {type:mime});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCSV(){
  const rows = exportMatrixForActiveScale();
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? "");
    const needs = /[",\n;]/.test(s);
    const escaped = s.replace(/"/g,'""');
    return needs ? `"${escaped}"` : escaped;
  }).join(";")).join("\n");
  const name = `${getScale(activeScaleId).name}_${ymKey(activeYear,activeMonth)}.csv`.replace(/\s+/g,"_");
  downloadBlob(csv, name, "text/csv;charset=utf-8");
}

function exportXLSX(){
  if(typeof XLSX === "undefined"){
    alert("XLSX não carregou (precisa internet). Use CSV (abre no Excel/Google Planilhas).");
    return;
  }
  const rows = exportMatrixForActiveScale();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Escala");
  const fname = `${getScale(activeScaleId).name}_${ymKey(activeYear,activeMonth)}.xlsx`.replace(/\s+/g,"_");
  XLSX.writeFile(wb, fname);
}

function resetMonth(){
  const sc = getScale(activeScaleId);
  const ym = ymKey(activeYear, activeMonth);
  const ok = confirm(`Apagar lançamentos de ${ym} para ${sc.name}? (Recria snapshot e zera ponteiro do rodízio)`);
  if(!ok) return;

  state.data[activeScaleId] ||= {};
  state.data[activeScaleId][ym] = {
    sectorsSnapshot: sc.sectors.map(s=>({...s})),
    selectedDays: [],
    pointer: 0,
    days: {}
  };
  saveState();
  renderAll();
}

/* =========================================================
   Render ALL (seleciona view + tabela sempre)
========================================================= */

function renderAll(){
  const { viewScales, viewTechs, viewOcc, viewSummary } = els();

  renderNav();

  if(viewScales)  viewScales.style.display  = state.activeView==="SCALES"  ? "" : "none";
  if(viewTechs)   viewTechs.style.display   = state.activeView==="TECHS"   ? "" : "none";
  if(viewOcc)     viewOcc.style.display     = state.activeView==="OCC"     ? "" : "none";
  if(viewSummary) viewSummary.style.display = state.activeView==="SUMMARY" ? "" : "none";

  if(state.activeView==="SCALES")  renderScalesView();
  if(state.activeView==="TECHS")   renderTechsView();
  if(state.activeView==="OCC")     renderOccView();
  if(state.activeView==="SUMMARY") renderSummaryView();

  renderTable();
}

/* =========================================================
   Bind events (uma vez)
========================================================= */

function bindGlobalEvents(){
  const E = els();

  // top buttons
  E.btnPrint?.addEventListener("click", ()=> window.print());
  E.btnExportCSV?.addEventListener("click", exportCSV);
  E.btnExportXLSX?.addEventListener("click", exportXLSX);
  E.btnResetMonth?.addEventListener("click", resetMonth);

  // modal manual
  E.btnClose?.addEventListener("click", closeModal);
  E.btnDone?.addEventListener("click", closeModal);

  E.overlay?.addEventListener("click", (e)=>{
    if(e.target===E.overlay) closeModal();
  });

  E.covSel?.addEventListener("change", ()=>{ refreshManualUI(); E.nameInput?.focus(); });

  E.btnAddManual?.addEventListener("click", addManual);
  E.nameInput?.addEventListener("keydown", (e)=>{
    if(e.key==="Enter"){ e.preventDefault(); addManual(); }
  });

  E.btnClearCell?.addEventListener("click", ()=>{
    if(!modalCtx) return;
    const {scaleId,y,m,day,sectorId} = modalCtx;
    const { md } = ensureMonthData(scaleId,y,m);
    const sec = (md.sectorsSnapshot||[]).find(s=>s.id===sectorId);
    if(!sec) return;
    const slots = ensureDaySectorSlots(md, day, sec);
    for(const s of slots){ s.techId=null; s.cov="NORMAL"; }
    saveState();
    refreshManualUI();
    renderTable();
  });

  E.btnAutoFillHere?.addEventListener("click", ()=>{
    if(!modalCtx) return;
    runAutoDistribution({ onlyDay: modalCtx.day });
    refreshManualUI();
    renderTable();
  });

  // modal auto
  E.btnCloseAuto?.addEventListener("click", closeAutoModal);
  E.overlayAuto?.addEventListener("click", (e)=>{
    if(e.target===E.overlayAuto) closeAutoModal();
  });
  E.btnRunAuto?.addEventListener("click", ()=>{
    runAutoDistribution();
    closeAutoModal();
    renderTable();
  });
}

/* =========================================================
   BOOT
========================================================= */

document.addEventListener("DOMContentLoaded", ()=>{
  initMonthYear();
  bindGlobalEvents();
  // garantir activeScaleId
  activeScaleId = state.activeScaleId || SCALE_DEFS[0].id;
  state.activeView = state.activeView || "SCALES";
  renderAll();
});
