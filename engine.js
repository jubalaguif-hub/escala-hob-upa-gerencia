/* ===============================
   ESCALA WEB — ENGINE LIMPO
   =============================== */

const APP_KEY = "escala_web_final_v2";

/* ===============================
   DEFINIÇÕES FIXAS
================================= */

const SCALE_DEFS = [
  { id:"UPA_DIA",   name:"UPA DIA",   unit:"UPA", shift:"DIA"   },
  { id:"UPA_NOITE", name:"UPA NOITE", unit:"UPA", shift:"NOITE" },
  { id:"HOB_DIA",   name:"HOB DIA",   unit:"HOB", shift:"DIA"   },
  { id:"HOB_NOITE", name:"HOB NOITE", unit:"HOB", shift:"NOITE" },
];

const DEFAULT_SECTORS = [
  { name:"SALA VERMELHA", required:4 },
  { name:"SALA AMARELA", required:3 },
  { name:"MEDICAÇÃO", required:2 },
  { name:"FAST", required:1 },
];

/* ===============================
   UTILITÁRIOS
================================= */

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function uid(){ return Math.random().toString(16).slice(2); }
function pad(n){ return String(n).padStart(2,"0"); }
function ymKey(y,m){ return `${y}-${pad(m+1)}`; }
function ymd(y,m,d){ return `${y}-${pad(m+1)}-${pad(d)}`; }
function monthDays(y,m){ return new Date(y,m+1,0).getDate(); }

/* ===============================
   STATE
================================= */

function defaultState(){
  return {
    activeView:"SCALES",
    activeScaleId:SCALE_DEFS[0].id,
    techs:[],
    occurrences:[],
    scales:SCALE_DEFS.map(s=>({
      ...s,
      sectors: DEFAULT_SECTORS.map(x=>({id:uid(),...x}))
    })),
    data:{} // escala -> mês -> dados
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(APP_KEY);
    if(!raw) return defaultState();
    return JSON.parse(raw);
  }catch(e){
    return defaultState();
  }
}

function saveState(){
  localStorage.setItem(APP_KEY, JSON.stringify(state));
}

let state = loadState();

let activeMonth = new Date().getMonth();
let activeYear  = new Date().getFullYear();

/* ===============================
   GARANTE MÊS
================================= */

function ensureMonth(scaleId,y,m){
  const key = ymKey(y,m);

  if(!state.data[scaleId]) state.data[scaleId]={};
  if(!state.data[scaleId][key]){
    state.data[scaleId][key]={
      pointer:0,
      selectedDays:[],
      days:{}
    };
  }

  return state.data[scaleId][key];
}

/* ===============================
   CICLO 30/40H
================================= */

function workedOnDay(techId,y,m,d){
  for(const sc of SCALE_DEFS){
    const md = ensureMonth(sc.id,y,m);
    const dayObj = md.days[d];
    if(!dayObj) continue;
    for(const secId in dayObj){
      for(const slot of dayObj[secId]){
        if(slot.techId===techId) return true;
      }
    }
  }
  return false;
}

function violatesCycle(tech,y,m,d){
  if(tech.workload==="40"){
    return workedOnDay(tech.id,y,m,d-1);
  }
  if(tech.workload==="30"){
    return workedOnDay(tech.id,y,m,d-1) ||
           workedOnDay(tech.id,y,m,d-2);
  }
  return false;
}

/* ===============================
   RENDER PRINCIPAL
================================= */

function renderAll(){
  renderNav();
  if(state.activeView==="SCALES") renderScales();
  if(state.activeView==="TECHS") renderTechs();
  if(state.activeView==="OCC") renderOcc();
  if(state.activeView==="SUMMARY") renderSummary();
}

/* ===============================
   NAV
================================= */

function renderNav(){
  const nav=$("#nav");
  nav.innerHTML="";

  [
    {id:"SCALES",label:"📅 Escalas"},
    {id:"TECHS",label:"👥 Técnicos"},
    {id:"OCC",label:"🩺 Ocorrências"},
    {id:"SUMMARY",label:"📊 Resumo Mensal"}
  ].forEach(item=>{
    const b=document.createElement("div");
    b.className="item"+(state.activeView===item.id?" active":"");
    b.textContent=item.label;
    b.onclick=()=>{
      state.activeView=item.id;
      saveState();
      renderAll();
    };
    nav.appendChild(b);
  });
}

/* ===============================
   ESCALAS
================================= */

function renderScales(){
  const wrap=$("#viewScales");
  wrap.innerHTML="";

  const scale=state.scales.find(s=>s.id===state.activeScaleId);

  wrap.innerHTML+=`<h3>${scale.name}</h3>`;

  const md=ensureMonth(scale.id,activeYear,activeMonth);
  const days=md.selectedDays.length?md.selectedDays:[1,2,3];

  const table=document.createElement("table");

  let head="<tr><th>DIA</th>";
  scale.sectors.forEach(s=>{
    head+=`<th>${s.name} (${s.required})</th>`;
  });
  head+="</tr>";
  table.innerHTML+=head;

  days.forEach(d=>{
    let row=`<tr><td>${pad(d)}</td>`;
    scale.sectors.forEach(sec=>{
      md.days[d] ||= {};
      md.days[d][sec.id] ||= Array.from({length:sec.required},()=>({techId:null}));
      const slots=md.days[d][sec.id];
      row+="<td>";
      slots.forEach(slot=>{
        const tech=state.techs.find(t=>t.id===slot.techId);
        row+=`<div>${tech?tech.name:"—"}</div>`;
      });
      row+="</td>";
    });
    row+="</tr>";
    table.innerHTML+=row;
  });

  wrap.appendChild(table);
}

/* ===============================
   TÉCNICOS
================================= */

function renderTechs(){
  const wrap=$("#viewTechs");
  wrap.innerHTML="";

  const btn=document.createElement("button");
  btn.textContent="➕ Técnico";
  btn.onclick=()=>{
    const name=prompt("Nome:");
    if(!name) return;
    const wl=prompt("Carga 30 ou 40?","40");
    state.techs.push({
      id:uid(),
      name:name.trim(),
      upa:true,
      hob:true,
      dia:true,
      noite:true,
      workload:wl==="30"?"30":"40"
    });
    saveState();
    renderAll();
  };
  wrap.appendChild(btn);

  state.techs.forEach(t=>{
    const div=document.createElement("div");
    div.textContent=`${t.name} (${t.workload}h)`;
    wrap.appendChild(div);
  });
}

/* ===============================
   OCORRÊNCIAS
================================= */

function renderOcc(){
  const wrap=$("#viewOcc");
  wrap.innerHTML="<h3>Ocorrências</h3>";
}

/* ===============================
   RESUMO
================================= */

function renderSummary(){
  const wrap=$("#viewSummary");
  wrap.innerHTML="<h3>Resumo mensal</h3>";
}

/* ===============================
   BOOT
================================= */

(function boot(){
  renderAll();
})();
