/* almentor Quality dashboard. Data: quality/data.enc (synced hourly from the Quality Tracking workbook). */
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isAr=s=>/[؀-ۿ]/.test(s||"");
const nm=s=>`<span class="${isAr(s)?"ar":""}" dir="auto">${esc(s)}</span>`;
const fmtN=v=>v==null||isNaN(v)?"—":Math.round(v).toLocaleString("en-US");
const fmt1=v=>v==null||isNaN(v)?"—":(Math.round(v*10)/10).toLocaleString("en-US");
const pct=v=>v==null||!isFinite(v)?"—":Math.round(v*100)+"%";
const now=new Date();
const isoLocal=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const dnum=s=>s?Math.round(Date.parse(s+"T00:00:00Z")/864e5):null;
const TD=dnum(isoLocal(now));
const fD=s=>{if(!s)return "—";const [y,m,d]=s.split("-");return `${+d} ${MON[+m-1]} ${y}`};
const relTime=d=>{const m=Math.round((Date.now()-d)/60000);if(m<1)return"just now";if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<48)return h+" h ago";return Math.round(h/24)+" days ago"};
const fmtDT=d=>d.toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
const initials=s=>String(s).replace(/\(.*?\)/g,"").split(/\s+/).filter(w=>/^[\p{L}\p{N}]/u.test(w)).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"?";
const uniq=a=>[...new Set(a)];
const by=(f,d=1)=>(a,b)=>{const x=f(a),y=f(b);return (x>y?1:x<y?-1:0)*d};
const OLD=7; // days before an open error counts as overdue

/* ---------- state ---------- */
const VIEWS=["overview","teams","repeated","projects","courses","qa","log","alerts"];
const S={d:null,status:null,token:"",user:"",view:"overview",year:"all",months:new Set(),
  f:{project:new Set(),type:new Set(),team:new Set(),reviewer:new Set(),stage:new Set(),severity:new Set()},
  ovMode:"team",sort:{},cq:"",cst:"",lq:"",lst:"",lrep:false,aq:"",asev:"",aarea:""};
try{const v=localStorage.getItem("qa.view");if(VIEWS.includes(v))S.view=v}catch(e){}
{const h=location.hash.slice(1);if(VIEWS.includes(h))S.view=h}

/* ---------- model ---------- */
let STG=[],TEAM_OF={},TEAMS=[],C=[],CK=new Map(),L=[],SEVS=["Critical","Major","Minor"],ALERTS=[];
const NI="Not included";
function courseStatus(c){
  const sc=c.inScope.length,ap=c.ap;
  if(!sc)return "Scope not set";if(ap===sc)return "All approved";
  const v=c.inScope.map(s=>c.stages[s]);
  if(v.includes("Returned"))return "Returned for fixes";if(v.includes("In Review"))return "In review";return "In progress";
}
function build(){
  const D=S.d;
  STG=D.stages.map(s=>s.name);TEAM_OF=Object.fromEntries(D.stages.map(s=>[s.name,s.team]));
  TEAMS=uniq([...D.teams,...D.stages.map(s=>s.team)].filter(Boolean));
  if(D.severity?.length)SEVS=D.severity.map(s=>s.name);
  C=D.courses.map(c=>{const key=`${c.project} | ${c.course}`;const inScope=STG.filter(s=>c.stages[s]&&c.stages[s]!==NI);
    const o={...c,key,inScope,ap:inScope.filter(s=>c.stages[s]==="Approved").length};o.prog=inScope.length?o.ap/inScope.length:null;o.status=courseStatus(o);return o});
  CK=new Map();C.forEach(c=>{if(!CK.has(c.key))CK.set(c.key,c)});
  L=D.log.map(x=>{const c=CK.get(x.course);const parts=x.course.split(" | ");
    const o={...x,c,project:c?c.project:(parts.length>1?parts[0]:""),courseName:c?c.course:(parts.length>1?parts.slice(1).join(" | "):x.course),
      type:c?c.type:"",team:TEAM_OF[x.stage]||"",id:"QA-"+String(x.row-4).padStart(4,"0"),d:dnum(x.date),fx:dnum(x.fixed),open:x.status!=="Done"};
    o.age=o.open&&o.d!=null?TD-o.d:null;o.fixDays=o.d!=null&&o.fx!=null?o.fx-o.d:null;return o});
  const order=L.filter(x=>x.d!=null&&x.team&&x.category).sort((a,b)=>a.d-b.d||a.row-b.row);const cnt=new Map();
  for(const x of order){const k=x.team+"\u0001"+x.category;const n=(cnt.get(k)||0)+1;cnt.set(k,n);x.occ=n}
  for(const x of L){x.auto=x.occ?(x.occ>1?"Yes":"No"):"";const ov=/^(yes|no)$/i.test(x.override)?x.override[0].toUpperCase()+x.override.slice(1).toLowerCase():"";
    x.ov=ov;x.final=ov||x.auto;x.rep=x.final==="Yes"}
  ALERTS=buildAlerts();
}
const inPeriod=x=>{if(S.year==="all"&&!S.months.size)return true;if(!x.date)return false;return (S.year==="all"||x.date.startsWith(S.year))&&(!S.months.size||S.months.has(+x.date.slice(5,7)))};
const periodOn=()=>S.year!=="all"||S.months.size>0;
function fLog(o={}){const f=S.f;return L.filter(x=>(o.noPeriod||inPeriod(x))&&(!f.project.size||f.project.has(x.project))&&(!f.type.size||f.type.has(x.type))&&
  (!f.team.size||f.team.has(x.team))&&(!f.reviewer.size||f.reviewer.has(x.reviewer))&&(!f.stage.size||f.stage.has(x.stage))&&(!f.severity.size||f.severity.has(x.severity))&&(!o.extra||o.extra(x)))}
function fCourses(){const f=S.f;return C.filter(c=>(!f.project.size||f.project.has(c.project))&&(!f.type.size||f.type.has(c.type))&&(!f.reviewer.size||f.reviewer.has(c.reviewer))&&
  (!f.team.size||c.inScope.some(s=>f.team.has(TEAM_OF[s])))&&(!f.stage.size||c.inScope.some(s=>f.stage.has(s))))}
const stats=X=>{const t=X.length,fx=X.filter(x=>x.fixDays!=null&&!x.open);return {t,crit:X.filter(x=>x.severity==="Critical").length,maj:X.filter(x=>x.severity==="Major").length,
  min:X.filter(x=>x.severity==="Minor").length,rep:X.filter(x=>x.rep).length,open:X.filter(x=>x.open).length,r2:X.filter(x=>(x.round||1)>=2).length,
  fix:fx.length?fx.reduce((s,x)=>s+x.fixDays,0)/fx.length:null,old:X.filter(x=>x.open&&x.age>OLD).length,rr:t?X.filter(x=>x.rep).length/t:null}};
const group=(X,f)=>{const m=new Map();for(const x of X){const k=f(x);if(k==null)continue;if(!m.has(k))m.set(k,[]);m.get(k).push(x)}return m};

/* ---------- visuals ---------- */
const charts={};
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const teamCol=t=>{const i=TEAMS.indexOf(t);return [css("--fg"),"#FF0000",css("--cin"),"#F2A93B","#8E6CEF","#9DB2B7","#3CCB8E"][(i<0?6:i)%7]};
const sevCol=s=>({Critical:css("--bad"),Major:"#F2A93B",Minor:css("--planned")}[s]||css("--fg-3"));
const ST={"Approved":["ap","Approved"],"In Review":["ir","In review"],"Returned":["rt","Returned"],"Not Started":["ns","Not started"],[NI]:["ni","Not included"],"":["ni","Not set"]};
const CST={"All approved":"ap","Returned for fixes":"rt","In review":"ir","In progress":"ip","Scope not set":"ns"};
const stChip=s=>`<span class="st ${CST[s]||"ns"}">${esc(s)}</span>`;
const teamTag=t=>t?`<span class="teamtag"><i style="background:${teamCol(t)}"></i>${esc(t)}</span>`:'<span class="muted">—</span>';
const sevTag=s=>s?`<span class="sev ${esc(s)}">${esc(s)}</span>`:'<span class="muted">—</span>';
const repTag=x=>x.rep?`<span class="rep ${x.ov?"ov":""}" title="${x.ov?"Set by QA (override). Automatic: "+(x.auto||"—"):"Same team had this error category before ("+x.occ+(x.occ===2?"nd":x.occ===3?"rd":"th")+" time)"}">REPEATED</span>`:(x.ov==="No"&&x.auto==="Yes"?'<span class="muted" title="Automatic said Yes; QA overrode to No">No (QA)</span>':"");
const pipe=c=>`<span class="pipe">${STG.map(s=>{const v=c.stages[s]||"";const k=v===NI||!v?"ni":(ST[v]||["ns"])[0];return `<i class="${k}" title="${esc(s)}: ${esc(v||"Not set")}"></i>`}).join("")}</span>`;
const prog=v=>v==null?'<span class="muted">—</span>':`<div class="prog"><div class="t"><i class="${v>=1?"full":""}" style="width:${Math.round(v*100)}%"></i></div><b class="num">${pct(v)}</b></div>`;
function opts({horiz=false,stack=false,pctAxis=false,legend=false,maxTick=22}={}){
  const fg2=css("--fg-2"),grid=css("--grid");const fv=v=>pctAxis?Math.round(v*100)+"%":fmtN(v);
  return {responsive:true,maintainAspectRatio:false,animation:{duration:300},indexAxis:horiz?"y":"x",interaction:{mode:"index",intersect:false},
    plugins:{legend:{display:legend,position:"bottom",labels:{color:fg2,boxWidth:10,boxHeight:10,font:{family:"Inter",size:11.5}}},
      tooltip:{backgroundColor:"#0A0B0C",titleColor:"#fff",bodyColor:"#E5ECED",padding:10,cornerRadius:8,titleFont:{family:"Inter",weight:"700"},bodyFont:{family:"Inter"},
        filter:i=>i.parsed[horiz?"x":"y"]!==0,callbacks:{label:c=>` ${c.dataset.label}: ${fv(c.parsed[horiz?"x":"y"])}`}}},
    scales:{x:{stacked:stack,grid:{display:horiz,color:grid,drawTicks:false},border:{display:false},ticks:{color:fg2,font:{family:"Inter",size:11},padding:6,precision:0,...(horiz?{callback:fv}:{})}},
      y:{stacked:stack,beginAtZero:true,grid:{display:!horiz,color:grid,drawTicks:false},border:{display:false},ticks:{color:fg2,font:{family:"Inter",size:11},padding:6,precision:0,
        callback:horiz?function(v){const l=String(this.getLabelForValue(v));return l.length>maxTick?l.slice(0,maxTick-1)+"…":l}:fv}}}};
}
const bars=(label,data,color,extra={})=>({label,data,backgroundColor:color,borderRadius:3,borderSkipped:false,maxBarThickness:30,categoryPercentage:.74,barPercentage:.92,...extra});
function draw(id,cfg){if(!window.Chart)return;if(charts[id])charts[id].destroy();const el=document.getElementById(id);if(!el)return;charts[id]=new Chart(el,cfg)}
function kpi(k,v,d,hero){return `<div class="kpi ${hero?"hero":""}"><span class="k">${k}</span><span class="v num">${v}</span><span class="d">${d||"&nbsp;"}</span></div>`}
function card(title,sub,body,right=""){return `<div class="card"><div class="card-h"><div><h2>${title}</h2>${sub?`<div class="sub">${sub}</div>`:""}</div>${right}</div>${body}</div>`}
const chartBox=(id,cls="",label="")=>`<div class="chart-box ${cls}"><canvas id="${id}" role="img" aria-label="${esc(label)}"></canvas></div>`;
const empty=(t,s)=>`<div class="card empty"><b>${t}</b><span>${s||""}</span></div>`;
const periodLabel=()=>{const y=S.year==="all"?"All time":S.year;if(!S.months.size)return y;const ms=[...S.months].sort((a,b)=>a-b).map(m=>MON[m-1]);return (ms.length>3?ms.length+" months":ms.join(", "))+(S.year==="all"?" (all years)":" "+S.year)};
function monthKeys(X){
  let ks=uniq(X.filter(x=>x.date).map(x=>x.date.slice(0,7))).sort();if(!ks.length)return [];
  if(S.year!=="all"&&!S.months.size){const last=S.year===String(now.getFullYear())?now.getMonth()+1:12;ks=[];for(let m=1;m<=last;m++)ks.push(`${S.year}-${String(m).padStart(2,"0")}`);return ks}
  if(S.months.size)return ks;
  const out=[];let [y,m]=ks[0].split("-").map(Number);const [ly,lm]=ks[ks.length-1].split("-").map(Number);
  while(y<ly||(y===ly&&m<=lm)){out.push(`${y}-${String(m).padStart(2,"0")}`);m++;if(m>12){m=1;y++}}return out;
}
const mLab=k=>MON[+k.slice(5)-1]+" "+k.slice(2,4);

/* ---------- table helper (sortable) ---------- */
function tableHTML(id,cols,rows,{click,foot,limit}={}){
  const s=S.sort[id]||cols.find(c=>c.def)?.def&&{k:cols.find(c=>c.def).k,d:cols.find(c=>c.def).def}||{k:null,d:1};
  const col=cols.find(c=>c.k===s.k);let R=rows.slice();
  if(col){const sv=col.s||col.v;R.sort((a,b)=>{const x=sv(a),y=sv(b);if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return (typeof x==="string"?x.localeCompare(y):x-y)*s.d})}
  const more=limit&&R.length>limit?R.length-limit:0;if(more)R=R.slice(0,limit);
  return `<table id="${id}"><thead><tr>${cols.map(c=>`<th class="${c.r?"r ":""}${c.v||c.s?"sortable":""}" ${c.v||c.s?`data-st="${id}" data-k="${c.k}"`:""} ${c.title?`title="${esc(c.title)}"`:""}>${c.label}${s.k===c.k?` <span class="arr">${s.d>0?"↑":"↓"}</span>`:""}</th>`).join("")}</tr></thead>
  <tbody>${R.map(r=>`<tr ${click?`class="click" ${click(r)}`:""}>${cols.map(c=>`<td class="${c.r?"r num ":""}${c.cls||""}">${c.f?c.f(r):esc(c.v(r))}</td>`).join("")}</tr>`).join("")||`<tr><td colspan="${cols.length}" class="empty-sm">Nothing matches the filters.</td></tr>`}
  ${more?`<tr><td colspan="${cols.length}" class="muted" style="text-align:center">+ ${more} more rows. Narrow the filters or export to see them all.</td></tr>`:""}</tbody>${foot?`<tfoot><tr>${foot}</tr></tfoot>`:""}</table>`;
}

/* ================= views ================= */
function renderOverview(){
  const X=fLog(),A=fLog({noPeriod:true}),Cs=fCourses(),st=stats(X),openNow=A.filter(x=>x.open),oc=openNow.filter(x=>x.severity==="Critical").length,old=openNow.filter(x=>x.age>OLD).length;
  const scoped=Cs.filter(c=>c.inScope.length),ap=Cs.filter(c=>c.status==="All approved").length,ret=Cs.filter(c=>c.status==="Returned for fixes").length;
  const coursesHit=uniq(X.map(x=>x.course)).length;
  const sevBar=SEVS.map(s=>{const n=X.filter(x=>x.severity===s).length;return n?`<i style="width:${n/st.t*100}%;background:${sevCol(s)}" title="${s}: ${n}"></i>`:""}).join("");
  $("#v-overview").innerHTML=`
  <div class="kpis">
   ${kpi("Errors logged",fmtN(st.t),`${fmtN(st.crit)} critical · ${fmtN(st.maj)} major · ${fmtN(st.min)} minor`,true)}
   ${kpi("Open now",fmtN(openNow.length),`<span class="chip ${oc?"bad":"good"}">${oc} critical</span>${old?`<span class="chip warn">${old} over ${OLD} days</span>`:""}`)}
   ${kpi("Repeat rate",pct(st.rr),`${fmtN(st.rep)} errors the same team made before`)}
   ${kpi("Avg. days to fix",fmt1(st.fix),"from logged to fixed, closed errors")}
   ${kpi("Found after round 1",fmtN(st.r2),st.t?pct(st.r2/st.t)+" of errors needed another review":"")}
   ${kpi("Courses fully approved",`${ap}<small>/ ${scoped.length}</small>`,`${ret?`<span class="chip bad">${ret} returned for fixes</span>`:"none returned"}`)}
  </div>
  <div class="strip"><div class="it"><b class="num">${fmtN(Cs.length)}</b><span>Courses tracked</span></div><div class="it"><b class="num">${fmtN(coursesHit)}</b><span>Courses with errors</span></div>
   <div class="it"><b class="num">${coursesHit?fmt1(st.t/coursesHit):"—"}</b><span>Errors per course</span></div>
   <div class="bar"><div class="sl-label" style="margin-bottom:6px">Severity mix · ${esc(periodLabel())}</div><div class="bigbar">${sevBar}</div></div></div>
  ${card("Errors logged per month",`Stacked by ${S.ovMode==="team"?"responsible team":"severity"}; the line is repeated errors. ${esc(periodLabel())}.`,chartBox("c-ov-month","tall","Errors per month"),
    `<div class="seg small" id="ovMode"><button data-m="team" aria-pressed="${S.ovMode==="team"}">By team</button><button data-m="severity" aria-pressed="${S.ovMode==="severity"}">By severity</button></div>`)}
  <div class="grid-2">
   ${card("Errors by responsible team","Severity split; the team is set by the stage",chartBox("c-ov-team","","Errors by team"))}
   ${card("Errors by stage","Coloured by the team responsible",chartBox("c-ov-stage","","Errors by stage"))}
  </div>
  <div class="grid-2">
   ${card("Mistakes that keep coming back","Error categories with the most repeated errors",rankList(X))}
   ${card("Stage pipeline across courses","Where every in-scope stage stands right now",chartBox("c-ov-pipe","tall","Stage pipeline"))}
  </div>`;
  const ks=monthKeys(X);const G=S.ovMode==="team"?TEAMS:SEVS;const key=S.ovMode==="team"?"team":"severity";
  draw("c-ov-month",{type:"bar",data:{labels:ks.map(mLab),datasets:[
    {type:"line",label:"Repeated",data:ks.map(k=>X.filter(x=>x.rep&&x.date?.startsWith(k)).length),borderColor:"#FF0000",backgroundColor:"#FF0000",borderWidth:2,pointRadius:3,tension:.3,order:0,borderDash:[4,3]},
    ...G.map(g=>bars(g,ks.map(k=>X.filter(x=>x[key]===g&&x.date?.startsWith(k)).length),S.ovMode==="team"?teamCol(g):sevCol(g),{order:1}))]},options:opts({stack:true,legend:true})});
  const tm=TEAMS.map(t=>[t,X.filter(x=>x.team===t)]).sort((a,b)=>b[1].length-a[1].length);
  draw("c-ov-team",{type:"bar",data:{labels:tm.map(t=>t[0]),datasets:SEVS.map(s=>bars(s,tm.map(t=>t[1].filter(x=>x.severity===s).length),sevCol(s)))},options:opts({horiz:true,stack:true,legend:true})});
  draw("c-ov-stage",{type:"bar",data:{labels:STG,datasets:[bars("Errors",STG.map(s=>X.filter(x=>x.stage===s).length),STG.map(s=>teamCol(TEAM_OF[s])))]},options:opts({maxTick:14})});
  const pk=[["Approved",css("--good")],["In Review","#F2A93B"],["Returned",css("--bad")],["Not Started",css("--planned")]];
  draw("c-ov-pipe",{type:"bar",data:{labels:STG,datasets:pk.map(([k,c])=>bars(ST[k][1],STG.map(s=>Cs.filter(cc=>cc.stages[s]===k).length),c))},options:opts({horiz:true,stack:true,legend:true})});
}
function rankList(X,n=8){
  const g=[...group(X,x=>x.team&&x.category?x.team+"\u0001"+x.category:null)].map(([k,v])=>({team:k.split("\u0001")[0],cat:k.split("\u0001")[1],t:v.length,r:v.filter(x=>x.rep).length})).filter(o=>o.r).sort((a,b)=>b.r-a.r||b.t-a.t).slice(0,n);
  if(!g.length)return '<div class="empty-sm">No repeated errors in this selection.</div>';const mx=g[0].r;
  return `<div class="rank">${g.map((o,i)=>`<div class="row click" data-pat="${esc(o.team+"\u0001"+o.cat)}" style="cursor:pointer"><span class="no">${i+1}</span><span class="n"><b>${esc(o.cat)}</b><span>${esc(o.team)} · logged ${o.t}×</span></span><span class="t"><i style="width:${o.r/mx*100}%"></i></span><span class="v num">${o.r}</span></div>`).join("")}</div>`;
}

function renderTeams(){
  const X=fLog(),Cs=fCourses(),A=fLog({noPeriod:true});
  const T=TEAMS.map(t=>{const Y=X.filter(x=>x.team===t);const s=stats(Y);const stg=STG.filter(x=>TEAM_OF[x]===t);const cs=Cs.filter(c=>c.inScope.some(x=>stg.includes(x)));
    const cats=[...group(Y,x=>x.category||null)].map(([k,v])=>[k,v.length,v.filter(x=>x.rep).length]).sort((a,b)=>b[1]-a[1]).slice(0,3);
    return {t,s,stg,cs:cs.length,per:cs.length?s.t/cs.length:null,cats,openAll:A.filter(x=>x.team===t&&x.open).length}});
  $("#v-teams").innerHTML=`<div class="vh"><div><h2>Production teams</h2><div class="sub">Every error is counted against the team responsible for its stage · ${esc(periodLabel())}</div></div></div>
  <div class="tcards">${T.map(o=>{const mx=Math.max(1,...o.cats.map(c=>c[1]));return `<button class="tcard" data-team="${esc(o.t)}"><div class="accent" style="background:${teamCol(o.t)}"></div>
    <div class="top"><div><div class="nm">${esc(o.t)}</div><div class="meta">${esc(o.stg.join(" · ")||"No stages")}</div></div>${o.s.rr!=null&&o.s.rr>=.3?'<span class="chip bad">High repeat rate</span>':""}</div>
    <div class="stats"><div><b class="num">${fmtN(o.s.t)}</b><span>Errors</span></div><div><b class="num" style="color:${o.s.crit?"var(--bad)":""}">${fmtN(o.s.crit)}</b><span>Critical</span></div><div><b class="num">${pct(o.s.rr)}</b><span>Repeat rate</span></div>
    <div><b class="num">${fmtN(o.openAll)}</b><span>Open now</span></div><div><b class="num">${fmt1(o.per)}</b><span>Errors / course</span></div><div><b class="num">${fmt1(o.s.fix)}</b><span>Days to fix</span></div></div>
    <div class="mini">${SEVS.map(s=>{const n=X.filter(x=>x.team===o.t&&x.severity===s).length;return n?`<i style="width:${n/o.s.t*100}%;background:${sevCol(s)}"></i>`:""}).join("")}</div>
    <div class="toplist">${o.cats.map(c=>`<div class="row"><span class="n" title="${esc(c[0])}">${esc(c[0])}</span><span class="t"><i style="width:${c[1]/mx*100}%"></i></span><b class="num">${c[1]}</b></div>`).join("")||'<span class="muted">No errors logged</span>'}</div></button>`}).join("")}</div>
  ${card("Monthly errors by team","How each team is trending",chartBox("c-tm-trend","tall","Monthly errors by team"))}
  <div class="tbl-wrap">${tableHTML("t-teams",[
    {k:"t",label:"Team",v:o=>o.t,f:o=>teamTag(o.t)},{k:"cs",label:"Courses in scope",r:1,v:o=>o.cs},{k:"e",label:"Errors",r:1,v:o=>o.s.t,def:-1},
    {k:"c",label:"Critical",r:1,v:o=>o.s.crit},{k:"mj",label:"Major",r:1,v:o=>o.s.maj},{k:"mn",label:"Minor",r:1,v:o=>o.s.min},
    {k:"rp",label:"Repeated",r:1,v:o=>o.s.rep},{k:"rr",label:"Repeat rate",r:1,v:o=>o.s.rr,f:o=>pct(o.s.rr)},{k:"r2",label:"Round 2+",r:1,v:o=>o.s.r2,title:"Errors still found after the first review round"},
    {k:"pc",label:"Errors / course",r:1,v:o=>o.per,f:o=>fmt1(o.per)},{k:"fx",label:"Avg days to fix",r:1,v:o=>o.s.fix,f:o=>fmt1(o.s.fix)},{k:"op",label:"Open now",r:1,v:o=>o.openAll}],T,{click:o=>`data-team="${esc(o.t)}"`})}</div>`;
  const ks=monthKeys(X);
  draw("c-tm-trend",{type:"line",data:{labels:ks.map(mLab),datasets:TEAMS.map(t=>({label:t,data:ks.map(k=>X.filter(x=>x.team===t&&x.date?.startsWith(k)).length),borderColor:teamCol(t),backgroundColor:teamCol(t),borderWidth:2,pointRadius:3,tension:.3}))},options:opts({legend:true})});
}

function patterns(X){
  return [...group(X,x=>x.team&&x.category?x.team+"\u0001"+x.category:null)].map(([k,v])=>{const ds=v.map(x=>x.date).filter(Boolean).sort();
    return {k,team:k.split("\u0001")[0],cat:k.split("\u0001")[1],stages:uniq(v.map(x=>x.stage)),t:v.length,r:v.filter(x=>x.rep).length,courses:uniq(v.map(x=>x.course)).length,projects:uniq(v.map(x=>x.project)).length,
      first:ds[0],last:ds[ds.length-1],open:v.filter(x=>x.open).length,crit:v.filter(x=>x.severity==="Critical").length}});
}
function renderRepeated(){
  const X=fLog(),st=stats(X),P=patterns(X),rec=P.filter(p=>p.r>0),ovr=X.filter(x=>x.ov&&x.ov!==x.auto).length;
  $("#v-repeated").innerHTML=`<div class="vh"><div><h2>Repeated errors</h2><div class="sub">An error is repeated when the same team already had the same error category before, on any course or project. QA can overrule it in the sheet · ${esc(periodLabel())}</div></div></div>
  <div class="kpis">${kpi("Repeated errors",fmtN(st.rep),`of ${fmtN(st.t)} errors logged`,true)}${kpi("Repeat rate",pct(st.rr),"share of errors that were repeats")}
   ${kpi("Recurring mistakes",fmtN(rec.length),"team + category pairs that came back")}${kpi("Critical repeats",fmtN(X.filter(x=>x.rep&&x.severity==="Critical").length),"repeated and critical")}${kpi("QA overrides",fmtN(ovr),"where QA changed the automatic result")}</div>
  <div class="grid-2">${card("Repeat rate by team","Repeated ÷ all errors for the team",chartBox("c-rp-team","","Repeat rate by team"))}
   ${card("Repeated errors per month","By responsible team",chartBox("c-rp-month","","Repeated per month"))}</div>
  ${card("Where the repeats are","Responsible team × stage, number of repeated errors",heat(X))}
  <div class="vh"><div><h2 style="font-size:16px">Recurring mistakes</h2><div class="sub">Each row is one error category for one team. Click a row to see every time it happened.</div></div></div>
  <div class="tbl-wrap">${tableHTML("t-pat",[
    {k:"cat",label:"Error category",v:p=>p.cat,f:p=>`<b>${esc(p.cat)}</b>`,cls:"wrapc"},{k:"team",label:"Team",v:p=>p.team,f:p=>teamTag(p.team)},{k:"stg",label:"Stage",v:p=>p.stages.join(", ")},
    {k:"t",label:"Times logged",r:1,v:p=>p.t},{k:"r",label:"Repeated",r:1,v:p=>p.r,def:-1,f:p=>p.r?`<b style="color:var(--bad)">${p.r}</b>`:"0"},{k:"c",label:"Courses",r:1,v:p=>p.courses},{k:"p",label:"Projects",r:1,v:p=>p.projects},
    {k:"cr",label:"Critical",r:1,v:p=>p.crit},{k:"o",label:"Open",r:1,v:p=>p.open},{k:"f",label:"First seen",v:p=>p.first,f:p=>fD(p.first)},{k:"l",label:"Last seen",v:p=>p.last,f:p=>fD(p.last)}],
    P.filter(p=>p.t>1||p.r),{click:p=>`data-pat="${esc(p.k)}"`})}</div>`;
  const rr=TEAMS.map(t=>{const Y=X.filter(x=>x.team===t);return Y.length?Y.filter(x=>x.rep).length/Y.length:0});
  draw("c-rp-team",{type:"bar",data:{labels:TEAMS,datasets:[bars("Repeat rate",rr,TEAMS.map(teamCol))]},options:opts({horiz:true,pctAxis:true})});
  const ks=monthKeys(X);
  draw("c-rp-month",{type:"bar",data:{labels:ks.map(mLab),datasets:TEAMS.map(t=>bars(t,ks.map(k=>X.filter(x=>x.rep&&x.team===t&&x.date?.startsWith(k)).length),teamCol(t)))},options:opts({stack:true,legend:true})});
}
function heat(X){
  const R=X.filter(x=>x.rep);const mx=Math.max(1,...STG.map(s=>R.filter(x=>x.stage===s).length));
  const cell=n=>n?`<td class="h" style="background:rgba(255,0,0,${(.12+.75*n/mx).toFixed(2)});color:${n/mx>.5?"#fff":"var(--fg)"}">${n}</td>`:'<td class="h muted">·</td>';
  const tms=TEAMS.filter(t=>STG.some(s=>TEAM_OF[s]===t));
  return `<div class="tbl-wrap"><table class="heat"><thead><tr><th>Stage</th>${tms.map(t=>`<th class="r">${esc(t)}</th>`).join("")}<th class="r">Total</th></tr></thead><tbody>
   ${STG.map(s=>`<tr><td>${esc(s)}</td>${tms.map(t=>TEAM_OF[s]===t?cell(R.filter(x=>x.stage===s).length):'<td class="h muted"></td>').join("")}<td class="r num"><b>${R.filter(x=>x.stage===s).length}</b></td></tr>`).join("")}</tbody></table></div>`;
}

function projRows(){
  const X=fLog(),A=fLog({noPeriod:true}),Cs=fCourses();
  const names=uniq([...Cs.map(c=>c.project),...X.map(x=>x.project)]).filter(Boolean);
  return names.map(p=>{const cs=Cs.filter(c=>c.project===p),Y=X.filter(x=>x.project===p),s=stats(Y);const sc=cs.reduce((a,c)=>a+c.inScope.length,0),ap=cs.reduce((a,c)=>a+c.ap,0);
    return {p,cs,n:cs.length,types:uniq(cs.map(c=>c.type).filter(Boolean)).join(" + "),prog:sc?ap/sc:null,apC:cs.filter(c=>c.status==="All approved").length,ret:cs.filter(c=>c.status==="Returned for fixes").length,
      s,open:A.filter(x=>x.project===p&&x.open).length,per:cs.length?s.t/cs.length:null,rev:uniq(cs.map(c=>c.reviewer).filter(Boolean))}});
}
function renderProjects(){
  const R=projRows();const empties=(S.d.projects||[]).filter(p=>!C.some(c=>c.project===p));
  $("#v-projects").innerHTML=`<div class="vh"><div><h2>Projects</h2><div class="sub">${R.length} projects with courses · errors follow the period filter, open errors and progress are as of now</div></div></div>
  <div class="grid-2">${card("Errors per project","Severity split",chartBox("c-pj-err","tall","Errors per project"))}${card("Stage progress per project","Approved stages ÷ stages in scope",chartBox("c-pj-prog","tall","Progress per project"))}</div>
  <div class="tbl-wrap">${tableHTML("t-proj",[
    {k:"p",label:"Project",v:r=>r.p,f:r=>`<span class="pname">${nm(r.p)}</span>`},{k:"ty",label:"Type",v:r=>r.types},{k:"n",label:"Courses",r:1,v:r=>r.n},
    {k:"pr",label:"Stage progress",v:r=>r.prog,f:r=>prog(r.prog)},{k:"ap",label:"Approved",r:1,v:r=>r.apC,title:"Courses with every stage approved"},{k:"rt",label:"Returned",r:1,v:r=>r.ret,f:r=>r.ret?`<b style="color:var(--bad)">${r.ret}</b>`:"0"},
    {k:"e",label:"Errors",r:1,v:r=>r.s.t,def:-1},{k:"c",label:"Critical",r:1,v:r=>r.s.crit},{k:"rp",label:"Repeated",r:1,v:r=>r.s.rep},{k:"o",label:"Open now",r:1,v:r=>r.open},
    {k:"pc",label:"Errors / course",r:1,v:r=>r.per,f:r=>fmt1(r.per)},{k:"rv",label:"QA reviewers",v:r=>r.rev.join(", "),cls:"wrapc"}],R,{click:r=>`data-proj="${esc(r.p)}"`})}</div>
  ${empties.length?`<p class="muted" style="margin:0;font-size:12px">Listed in the sheet but no courses added yet: ${empties.map(esc).join(", ")}.</p>`:""}`;
  const top=R.slice().sort((a,b)=>b.s.t-a.s.t).slice(0,15);
  draw("c-pj-err",{type:"bar",data:{labels:top.map(r=>r.p),datasets:SEVS.map(s=>bars(s,top.map(r=>fLog({extra:x=>x.project===r.p&&x.severity===s}).length),sevCol(s)))},options:opts({horiz:true,stack:true,legend:true,maxTick:26})});
  const pr=R.filter(r=>r.prog!=null).sort((a,b)=>b.prog-a.prog).slice(0,15);
  draw("c-pj-prog",{type:"bar",data:{labels:pr.map(r=>r.p),datasets:[bars("Progress",pr.map(r=>r.prog),pr.map(r=>r.prog>=1?css("--good"):css("--fg")))]},options:{...opts({horiz:true,pctAxis:true,maxTick:26}),scales:{...opts({horiz:true,pctAxis:true,maxTick:26}).scales,x:{...opts({horiz:true,pctAxis:true}).scales.x,max:1}}}});
}

function renderCourses(){
  const Cs=fCourses(),X=fLog(),A=fLog({noPeriod:true});const q=S.cq.toLowerCase();
  const cnt=k=>Cs.filter(c=>c.status===k).length;
  const R=Cs.filter(c=>(!S.cst||c.status===S.cst)&&(!q||(c.course+" "+c.project+" "+c.reviewer).toLowerCase().includes(q))).map(c=>({c,e:X.filter(x=>x.course===c.key),o:A.filter(x=>x.course===c.key&&x.open)}));
  const sts=["Returned for fixes","In review","In progress","All approved","Scope not set"];
  $("#v-courses").innerHTML=`<div class="vh"><div><h2>Courses</h2><div class="sub">${Cs.length} courses · each square is a stage, in sheet order: ${esc(STG.join(" → "))}</div></div>
   <div class="ctl"><input type="search" id="cq" placeholder="Search course, project or reviewer" value="${esc(S.cq)}"></div></div>
  <div class="ctl"><div class="seg" id="cst"><button data-s="" aria-pressed="${!S.cst}">All<span class="c">${Cs.length}</span></button>${sts.map(s=>`<button data-s="${s}" aria-pressed="${S.cst===s}">${s}<span class="c">${cnt(s)}</span></button>`).join("")}</div></div>
  <div class="pkey"><span><span class="pipe"><i class="ap"></i></span>Approved</span><span><span class="pipe"><i class="ir"></i></span>In review</span><span><span class="pipe"><i class="rt"></i></span>Returned</span><span><span class="pipe"><i></i></span>Not started</span><span><span class="pipe"><i class="ni"></i></span>Not included</span></div>
  <div class="tbl-wrap">${tableHTML("t-crs",[
    {k:"c",label:"Course",v:r=>r.c.course,f:r=>`<span class="pname">${nm(r.c.course)}</span>`},{k:"p",label:"Project",v:r=>r.c.project,f:r=>nm(r.c.project)},{k:"t",label:"Type",v:r=>r.c.type},
    {k:"rv",label:"QA reviewer",v:r=>r.c.reviewer,f:r=>r.c.reviewer?esc(r.c.reviewer):'<span class="chip warn">Not assigned</span>'},
    {k:"pp",label:"Stages",f:r=>pipe(r.c)},{k:"pr",label:"Progress",v:r=>r.c.prog,f:r=>prog(r.c.prog)},{k:"s",label:"Status",v:r=>r.c.status,f:r=>stChip(r.c.status)},
    {k:"e",label:"Errors",r:1,v:r=>r.e.length,def:-1},{k:"cr",label:"Critical",r:1,v:r=>r.e.filter(x=>x.severity==="Critical").length},{k:"rp",label:"Repeated",r:1,v:r=>r.e.filter(x=>x.rep).length},
    {k:"o",label:"Open now",r:1,v:r=>r.o.length,f:r=>r.o.length?`<b style="color:var(--bad)">${r.o.length}</b>`:"0"},{k:"sd",label:"Start",v:r=>r.c.start,f:r=>fD(r.c.start)}],R,{click:r=>`data-course="${esc(r.c.key)}"`})}</div>`;
}

function reviewers(){return uniq([...S.d.reviewers,...C.map(c=>c.reviewer),...L.map(x=>x.reviewer)].filter(Boolean)).filter(r=>!S.f.reviewer.size||S.f.reviewer.has(r))}
function renderQA(){
  const X=fLog(),Cs=fCourses(),A=fLog({noPeriod:true});const un=Cs.filter(c=>!c.reviewer);
  const R=reviewers().map(r=>{const cs=Cs.filter(c=>c.reviewer===r),Y=X.filter(x=>x.reviewer===r);const last=L.filter(x=>x.reviewer===r&&x.date).map(x=>x.date).sort().pop();
    return {r,cs,proj:uniq(cs.map(c=>c.project)),Y,crit:Y.filter(x=>x.severity==="Critical").length,open:A.filter(x=>x.open&&x.c&&x.c.reviewer===r).length,
      active:cs.filter(c=>c.status!=="All approved"&&c.status!=="Scope not set").length,done:cs.filter(c=>c.status==="All approved").length,last}});
  $("#v-qa").innerHTML=`<div class="vh"><div><h2>QA team</h2><div class="sub">Who reviews what: courses and projects assigned, errors logged (${esc(periodLabel())}) and open errors on their courses</div></div></div>
  ${un.length?`<div class="note">${un.length} course${un.length>1?"s have":" has"} no QA reviewer: ${un.slice(0,6).map(c=>esc(c.course)).join(", ")}${un.length>6?"…":""}</div>`:""}
  <div class="tcards">${R.map(o=>`<button class="tcard" data-rev="${esc(o.r)}"><div class="top"><div style="display:flex;gap:10px;align-items:center"><div class="avatar lg">${esc(initials(o.r))}</div><div><div class="nm">${esc(o.r)}</div><div class="meta">${o.last?"Last error logged "+fD(o.last):"No errors logged yet"}</div></div></div></div>
    <div class="stats"><div><b class="num">${o.proj.length}</b><span>Projects</span></div><div><b class="num">${o.cs.length}</b><span>Courses</span></div><div><b class="num">${o.active}</b><span>In progress</span></div>
    <div><b class="num">${fmtN(o.Y.length)}</b><span>Errors logged</span></div><div><b class="num" style="color:${o.crit?"var(--bad)":""}">${o.crit}</b><span>Critical found</span></div><div><b class="num">${o.open}</b><span>Open on courses</span></div></div>
    <div class="wlist">${o.proj.map(p=>`<span class="tag">${nm(p)} · ${o.cs.filter(c=>c.project===p).length}</span>`).join("")||'<span class="muted">No courses assigned</span>'}</div></button>`).join("")}</div>
  <div class="grid-2">${card("Workload","Courses assigned, by course status",chartBox("c-qa-load","","Workload"))}${card("Errors logged per reviewer","Severity split · "+esc(periodLabel()),chartBox("c-qa-err","","Errors per reviewer"))}</div>`;
  const sts=[["All approved",css("--good")],["In review","#F2A93B"],["Returned for fixes",css("--bad")],["In progress",css("--fg")],["Scope not set",css("--planned")]];
  draw("c-qa-load",{type:"bar",data:{labels:R.map(o=>o.r),datasets:sts.map(([s,c])=>bars(s,R.map(o=>o.cs.filter(x=>x.status===s).length),c))},options:opts({horiz:true,stack:true,legend:true})});
  draw("c-qa-err",{type:"bar",data:{labels:R.map(o=>o.r),datasets:SEVS.map(s=>bars(s,R.map(o=>o.Y.filter(x=>x.severity===s).length),sevCol(s)))},options:opts({horiz:true,stack:true,legend:true})});
}

function logRows(){const q=S.lq.toLowerCase();return fLog().filter(x=>(!S.lst||(S.lst==="overdue"?x.open&&x.age>OLD:x.status===S.lst))&&(!S.lrep||x.rep)&&
  (!q||[x.id,x.project,x.courseName,x.stage,x.category,x.desc,x.reviewer,x.notes].join(" ").toLowerCase().includes(q)))}
function renderLog(){
  const all=fLog(),R=logRows();const c=s=>all.filter(x=>x.status===s).length;
  $("#v-log").innerHTML=`<div class="vh"><div><h2>Error log</h2><div class="sub">${R.length} of ${all.length} errors · ${esc(periodLabel())}</div></div>
   <div class="ctl"><input type="search" id="lq" placeholder="Search errors" value="${esc(S.lq)}"><button class="btn ghost" id="lcsv" type="button">Export CSV</button></div></div>
  <div class="ctl"><div class="seg" id="lst"><button data-s="" aria-pressed="${!S.lst}">All<span class="c">${all.length}</span></button>${["Open","In Progress","Done"].map(s=>`<button data-s="${s}" aria-pressed="${S.lst===s}">${s}<span class="c">${c(s)}</span></button>`).join("")}<button data-s="overdue" aria-pressed="${S.lst==="overdue"}">Open &gt; ${OLD} days<span class="c">${all.filter(x=>x.open&&x.age>OLD).length}</span></button></div>
   <label class="rem" style="display:flex;gap:6px;align-items:center;font-size:13px;font-weight:600"><input type="checkbox" id="lrep" ${S.lrep?"checked":""} style="accent-color:var(--red)"> Repeated only</label></div>
  <div class="tbl-wrap">${tableHTML("t-log",[
    {k:"id",label:"ID",v:x=>x.row,f:x=>`<b>${x.id}</b>`},{k:"d",label:"Logged",v:x=>x.date||"",def:-1,f:x=>fD(x.date)},{k:"p",label:"Project",v:x=>x.project,f:x=>nm(x.project)},{k:"c",label:"Course",v:x=>x.courseName,f:x=>`<span class="pname">${nm(x.courseName)}</span>`},
    {k:"st",label:"Stage",v:x=>x.stage},{k:"tm",label:"Team",v:x=>x.team,f:x=>teamTag(x.team)},{k:"ca",label:"Error category",v:x=>x.category,cls:"wrapc"},{k:"ds",label:"Description",v:x=>x.desc,cls:"desc"},
    {k:"sv",label:"Severity",v:x=>SEVS.indexOf(x.severity),f:x=>sevTag(x.severity)},{k:"rd",label:"Round",r:1,v:x=>x.round},{k:"ss",label:"Status",v:x=>x.status,f:x=>`<span class="st ${x.status==="Done"?"ap":x.status==="In Progress"?"ir":"rt"}">${esc(x.status||"—")}</span>`},
    {k:"ag",label:"Days",r:1,title:"Open: days since logged. Done: days it took to fix.",v:x=>x.open?x.age:x.fixDays,f:x=>x.open?(x.age==null?"—":`<span class="age ${x.age>OLD?"old":""}">${x.age} open</span>`):(x.fixDays==null?'<span class="muted">no date</span>':x.fixDays+" to fix")},
    {k:"rp",label:"Repeated",v:x=>x.rep?1:0,f:repTag},{k:"rv",label:"QA",v:x=>x.reviewer}],R,{click:x=>`data-err="${x.row}"`,limit:400})}</div>`;
}
function exportLog(){
  const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;const R=logRows();
  const lines=[["ID","Date logged","Project","Type","Course","Stage","Responsible team","QA reviewer","Error category","Description","Severity","Review round","Status","Date fixed","Days open / to fix","Occurrence #","Repeated (auto)","Repeated (override)","Repeated (final)","Notes"].map(q).join(",")]
    .concat(R.map(x=>[x.id,x.date,x.project,x.type,x.courseName,x.stage,x.team,x.reviewer,x.category,x.desc,x.severity,x.round,x.status,x.fixed,x.open?x.age:x.fixDays,x.occ,x.auto,x.ov,x.final,x.notes].map(q).join(",")));
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["﻿"+lines.join("\n")],{type:"text/csv"}));a.download=`almentor_QA_error_log_${isoLocal(now)}.csv`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}

/* ---------- alerts (data checks + things to chase) ---------- */
const ASEV={bad:{l:"Act now",o:0},warn:{l:"Needs attention",o:1},info:{l:"For information",o:2}};
function buildAlerts(){
  const out=[];const add=(sev,area,project,title,detail,where,team="")=>out.push({sev,area,project,title,detail,where,team});
  const catOK=(s,c)=>{const l=S.d.categories?.[s];return !l||!l.length||l.includes(c)};
  for(const x of L){const w=`Review Log → row ${x.row} (${x.id})`;const lab=`${x.courseName||x.course||"?"} · ${x.stage||"?"}`;
    if(x.open&&x.severity==="Critical")add("bad","Open errors",x.project,`Critical error still ${x.status==="In Progress"?"in progress":"open"}${x.age!=null?" after "+x.age+" day"+(x.age===1?"":"s"):""}`,`${lab}: ${x.category}${x.desc?" — “"+x.desc+"”":""}.`,w,x.team);
    else if(x.open&&x.age>OLD)add("warn","Open errors",x.project,`Open for ${x.age} days`,`${lab}: ${x.category} (${x.severity||"no severity"}), status ${x.status||"empty"}.`,w,x.team);
    if(x.status==="Done"&&!x.fixed)add("warn","Data quality",x.project,"Marked Done without a fix date","Days to fix can't be worked out for this error.",w+", Date fixed",x.team);
    if(x.d!=null&&x.fx!=null&&x.fx<x.d)add("bad","Data quality",x.project,"Fix date is before the date logged",`Logged ${fD(x.date)}, fixed ${fD(x.fixed)}.`,w,x.team);
    if(x.course&&!x.c)add("warn","Data quality",x.project,"Course not found on the Courses tab",`“${x.course}” isn't a course key on the Courses tab, so project and type are guessed from the name.`,w+", Course",x.team);
    if(x.c&&x.stage&&(x.c.stages[x.stage]===NI))add("warn","Data quality",x.project,"Error logged on a stage the course doesn't include",`${x.courseName}: ${x.stage} is marked “Not included” on the Courses tab.`,`${w} and Courses → row ${x.c.row}`,x.team);
    const miss=[!x.date&&"date logged",!x.stage&&"stage",!x.category&&"error category",!x.severity&&"severity",!x.status&&"status",!x.course&&"course"].filter(Boolean);
    if(miss.length)add("warn","Data quality",x.project,`Missing ${miss.join(", ")}`,"This row can't be counted fully until it's filled in.",w,x.team);
    if(x.category&&x.stage&&!catOK(x.stage,x.category))add("info","Data quality",x.project,"Category isn't in the list for this stage",`“${x.category}” isn't listed under ${x.stage} on the Lists tab.`,w,x.team);
    if(x.ov&&x.auto&&x.ov!==x.auto)add("info","QA overrides",x.project,`Repeated set to ${x.ov} by QA (automatic: ${x.auto})`,`${lab}: ${x.category}.`,w+", Repeated (override)",x.team);
  }
  const seen=new Map();
  for(const c of C){const w=`Courses → row ${c.row}`;
    if(seen.has(c.key))add("warn","Data quality",c.project,"Course listed twice",`“${c.course}” appears in rows ${seen.get(c.key)} and ${c.row}. Errors are matched to the first one.`,w);else seen.set(c.key,c.row);
    if(!c.reviewer)add("info","Courses",c.project,"No QA reviewer assigned",`${c.course}.`,w+", QA reviewer");
    if(!c.inScope.length)add("info","Courses",c.project,"Stages not set",`${c.course}: every stage is empty or Not included.`,w);
    for(const s of c.inScope){const op=L.filter(x=>x.c===c&&x.stage===s&&x.open);if(c.stages[s]==="Approved"&&op.length)add("warn","Courses",c.project,`${s} is Approved but has ${op.length} open error${op.length>1?"s":""}`,`${c.course}: ${op.map(x=>x.id).join(", ")} still ${op.length>1?"aren't":"isn't"} Done.`,w+", "+s,TEAM_OF[s])}
    if(!c.project)add("warn","Data quality","","Course without a project",`${c.course}.`,w+", Project");
  }
  return out.sort((a,b)=>ASEV[a.sev].o-ASEV[b.sev].o);
}
function renderAlerts(){
  const f=S.f;let A=ALERTS.filter(a=>(!f.project.size||f.project.has(a.project))&&(!f.team.size||!a.team||f.team.has(a.team)));
  const areas=uniq(ALERTS.map(a=>a.area));const q=S.aq.toLowerCase();
  const V=A.filter(a=>(!S.asev||a.sev===S.asev)&&(!S.aarea||a.area===S.aarea)&&(!q||[a.title,a.detail,a.project,a.where].join(" ").toLowerCase().includes(q)));
  $("#v-alerts").innerHTML=`<div class="fd-top"><div><h2 style="margin:0;font-size:18px">Alerts</h2><div class="sub muted">${V.length} of ${A.length} · worked out from the sheet on every refresh. Fix it in Excel and it disappears.</div></div></div>
  <div class="fd-sum">${Object.entries(ASEV).map(([k,v])=>`<button class="fdk ${k==="info"?"neu":k} ${S.asev===k?"on":""}" data-asev="${k}"><b class="num">${A.filter(a=>a.sev===k).length}</b><span>${v.l}</span></button>`).join("")}</div>
  <div class="fd-ctl"><select id="aarea" aria-label="Area"><option value="">All areas</option>${areas.map(a=>`<option ${S.aarea===a?"selected":""}>${esc(a)}</option>`).join("")}</select><input type="search" id="aq" placeholder="Search alerts" value="${esc(S.aq)}"></div>
  <div class="fd-list">${V.slice(0,300).map(a=>`<div class="fd ${a.sev==="info"?"neu":a.sev}"><div class="fd-h"><span class="chip ${a.sev==="info"?"neu":a.sev}">${ASEV[a.sev].l}</span><span class="fd-area">${esc(a.area)}</span>${a.project?`<span class="fd-proj">${nm(a.project)}</span>`:""}${a.team?`<span class="fd-amt">${teamTag(a.team)}</span>`:""}</div>
    <h3>${esc(a.title)}</h3><p dir="auto">${esc(a.detail)}</p><div class="fd-where"><span>Where</span>${esc(a.where)}</div></div>`).join("")||'<div class="card empty"><b>All clear</b><span>No alerts for this selection.</span></div>'}</div>`;
}

/* ---------- drawers ---------- */
function drawer(kicker,title,body){
  $("#drawerHost").innerHTML=`<div class="scrim" data-close-d></div><aside class="drawer" role="dialog" aria-label="${esc(title)}"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><div class="sl-label">${kicker}</div><h3 dir="auto" class="${isAr(title)?"ar":""}">${esc(title)}</h3></div><button class="x" data-close-d aria-label="Close">×</button></div>${body}</aside>`;
  $(".drawer .x").focus();
}
const errTable=(id,X,lim=200)=>`<div class="tbl-wrap">${tableHTML(id,[{k:"d",label:"Logged",v:x=>x.date||"",def:-1,f:x=>fD(x.date)},{k:"c",label:"Course · stage",v:x=>x.courseName,f:x=>`${nm(x.courseName)}<div class="muted" style="font-size:11.5px">${esc(x.stage)}</div>`},
  {k:"ca",label:"Error",v:x=>x.category,f:x=>`<b>${esc(x.category)}</b>${x.desc?`<div class="muted" style="font-size:11.5px;white-space:normal;max-width:300px">${esc(x.desc)}</div>`:""}`,cls:"wrapc"},{k:"sv",label:"Severity",v:x=>SEVS.indexOf(x.severity),f:x=>sevTag(x.severity)},
  {k:"ss",label:"Status",v:x=>x.status,f:x=>`<span class="st ${x.status==="Done"?"ap":x.status==="In Progress"?"ir":"rt"}">${esc(x.status||"—")}</span>`},{k:"rp",label:"",v:x=>x.rep?1:0,f:repTag}],X,{limit:lim})}</div>`;
function openCourse(key){
  const c=CK.get(key);if(!c)return;const X=L.filter(x=>x.c===c),s=stats(X);
  drawer(`${esc(c.project)} · ${esc(c.type||"—")} · QA: ${esc(c.reviewer||"not assigned")}`,c.course,`
  <div class="kpis">${kpi("Status",`<span style="font-size:17px">${stChip(c.status)}</span>`,`${c.ap} of ${c.inScope.length} stages approved`)}${kpi("Errors",fmtN(s.t),`${s.crit} critical · ${s.rep} repeated`)}${kpi("Open",fmtN(s.open),s.old?`<span class="chip warn">${s.old} over ${OLD} days</span>`:"")}</div>
  <div class="tbl-wrap"><table><thead><tr><th>Stage</th><th>Team</th><th>Status</th><th class="r">Errors</th><th class="r">Open</th><th class="r">Rounds</th></tr></thead><tbody>${STG.map(st=>{const v=c.stages[st]||"";const Y=X.filter(x=>x.stage===st);
    return `<tr style="${v===NI||!v?"opacity:.5":""}"><td>${esc(st)}</td><td>${teamTag(TEAM_OF[st])}</td><td><span class="pipe"><i class="${v===NI||!v?"ni":(ST[v]||["ns"])[0]}"></i></span> ${esc(v||"Not set")}</td><td class="r num">${Y.length||""}</td><td class="r num">${Y.filter(x=>x.open).length||""}</td><td class="r num">${Y.length?Math.max(...Y.map(x=>x.round||1)):""}</td></tr>`}).join("")}</tbody></table></div>
  ${X.length?errTable("t-dc",X):'<div class="card empty-sm">No errors logged for this course.</div>'}`);
}
function openProject(p){
  const cs=C.filter(c=>c.project===p),X=L.filter(x=>x.project===p),s=stats(X);
  drawer(`${cs.length} courses · ${uniq(cs.map(c=>c.type)).join(" + ")||"—"}`,p,`
  <div class="kpis">${kpi("Errors",fmtN(s.t),`${s.crit} critical`)}${kpi("Repeat rate",pct(s.rr),`${s.rep} repeated`)}${kpi("Open",fmtN(s.open),s.old?`${s.old} over ${OLD} days`:"")}</div>
  ${card("Errors by stage","All time, coloured by team",chartBox("c-dp","","Errors by stage"))}
  <div class="tbl-wrap"><table><thead><tr><th>Course</th><th>Stages</th><th>Status</th><th class="r">Errors</th><th class="r">Open</th></tr></thead><tbody>${cs.map(c=>`<tr class="click" data-course="${esc(c.key)}"><td class="pname">${nm(c.course)}</td><td>${pipe(c)}</td><td>${stChip(c.status)}</td><td class="r num">${X.filter(x=>x.c===c).length}</td><td class="r num">${X.filter(x=>x.c===c&&x.open).length}</td></tr>`).join("")}</tbody></table></div>
  ${X.some(x=>x.open)?`<h3 style="margin:4px 0 0;font-size:15px">Open errors</h3>${errTable("t-dpo",X.filter(x=>x.open))}`:""}`);
  draw("c-dp",{type:"bar",data:{labels:STG,datasets:[bars("Errors",STG.map(st=>X.filter(x=>x.stage===st).length),STG.map(st=>teamCol(TEAM_OF[st])))]},options:opts({maxTick:14})});
}
function openTeam(t){
  const X=fLog().filter(x=>x.team===t),s=stats(X);const cats=[...group(X,x=>x.category||null)].map(([k,v])=>({k,t:v.length,r:v.filter(x=>x.rep).length,c:v.filter(x=>x.severity==="Critical").length,o:v.filter(x=>x.open).length})).sort((a,b)=>b.t-a.t);
  drawer(`Responsible for ${esc(STG.filter(x=>TEAM_OF[x]===t).join(", "))} · ${esc(periodLabel())}`,t,`
  <div class="kpis">${kpi("Errors",fmtN(s.t),`${s.crit} critical · ${s.maj} major · ${s.min} minor`)}${kpi("Repeat rate",pct(s.rr),`${s.rep} repeated`)}${kpi("Avg days to fix",fmt1(s.fix),`${s.open} open`)}</div>
  <div class="tbl-wrap"><table><thead><tr><th>Error category</th><th class="r">Logged</th><th class="r">Repeated</th><th class="r">Critical</th><th class="r">Open</th></tr></thead><tbody>${cats.map(o=>`<tr class="click" data-pat="${esc(t+"\u0001"+o.k)}"><td class="wrapc"><b>${esc(o.k)}</b></td><td class="r num">${o.t}</td><td class="r num">${o.r?`<b style="color:var(--bad)">${o.r}</b>`:0}</td><td class="r num">${o.c}</td><td class="r num">${o.o}</td></tr>`).join("")||'<tr><td colspan="5" class="empty-sm">No errors</td></tr>'}</tbody></table></div>
  ${X.some(x=>x.open)?`<h3 style="margin:4px 0 0;font-size:15px">Open errors</h3>${errTable("t-dto",X.filter(x=>x.open))}`:""}`);
}
function openPattern(k){
  const [t,cat]=k.split("\u0001");const X=L.filter(x=>x.team===t&&x.category===cat).sort((a,b)=>(a.d??1e9)-(b.d??1e9)||a.row-b.row);
  drawer(`${esc(t)} · ${X.length} time${X.length>1?"s":""} on ${uniq(X.map(x=>x.course)).length} course(s), all time`,cat,`
  <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Logged</th><th>Project · course</th><th>Stage</th><th>Severity</th><th>Status</th><th>Repeated</th></tr></thead><tbody>${X.map(x=>`<tr class="click" data-err="${x.row}"><td><b>${x.occ||"—"}</b></td><td>${fD(x.date)}</td><td>${nm(x.project)}<div class="muted" style="font-size:11.5px">${nm(x.courseName)}</div></td><td>${esc(x.stage)}</td><td>${sevTag(x.severity)}</td><td>${esc(x.status)}</td><td>${repTag(x)||'<span class="muted">First time</span>'}</td></tr>`).join("")}</tbody></table></div>
  <p class="muted" style="margin:0;font-size:12px"># is the occurrence number for this team and category, by date logged. 1 = first time, so not a repeat.</p>`);
}
function openErr(row){
  const x=L.find(e=>e.row===+row);if(!x)return;
  drawer(`${x.id} · ${esc(x.project)} · logged ${fD(x.date)} by ${esc(x.reviewer||"—")}`,x.category||"Error",`
  <div class="kpis">${kpi("Severity",sevTag(x.severity),SEVS.length&&S.d.severity?.find(s=>s.name===x.severity)?.desc?.slice(0,90)||"")}${kpi("Status",esc(x.status||"—"),x.open?(x.age!=null?`${x.age} days open`:""):(x.fixDays!=null?`fixed in ${x.fixDays} days`:"no fix date"))}${kpi("Repeated",esc(x.final||"—"),x.ov?`Set by QA · automatic: ${esc(x.auto||"—")}`:x.occ?`Occurrence #${x.occ} for ${esc(x.team)}`:"")}</div>
  <div class="card"><div class="tbl-wrap" style="border:0"><table><tbody>
   ${[["Course",nm(x.courseName)],["Project",nm(x.project)+(x.type?` · ${esc(x.type)}`:"")],["Stage",esc(x.stage)],["Responsible team",teamTag(x.team)],["Description",`<span style="white-space:normal">${esc(x.desc||"—")}</span>`],["Review round",x.round??"—"],["Date fixed",fD(x.fixed)],["Notes",`<span style="white-space:normal">${esc(x.notes||"—")}</span>`],["In the sheet",`Review Log → row ${x.row}`]].map(([a,b])=>`<tr><th style="position:static;width:150px">${a}</th><td style="white-space:normal">${b}</td></tr>`).join("")}
  </tbody></table></div></div>${x.team&&x.category?`<button class="btn ghost" data-pat="${esc(x.team+"\u0001"+x.category)}">See every “${esc(x.category)}” for ${esc(x.team)}</button>`:""}`);
}
function openRev(r){
  const cs=C.filter(c=>c.reviewer===r),X=L.filter(x=>x.reviewer===r);
  drawer(`${cs.length} courses · ${uniq(cs.map(c=>c.project)).length} projects · ${X.length} errors logged (all time)`,r,`
  <div class="tbl-wrap"><table><thead><tr><th>Course</th><th>Project</th><th>Stages</th><th>Status</th><th class="r">Open</th></tr></thead><tbody>${cs.map(c=>`<tr class="click" data-course="${esc(c.key)}"><td class="pname">${nm(c.course)}</td><td>${nm(c.project)}</td><td>${pipe(c)}</td><td>${stChip(c.status)}</td><td class="r num">${L.filter(x=>x.c===c&&x.open).length}</td></tr>`).join("")||'<tr><td colspan="5" class="empty-sm">No courses assigned</td></tr>'}</tbody></table></div>
  ${X.length?`<h3 style="margin:4px 0 0;font-size:15px">Errors logged</h3>${errTable("t-drv",X,100)}`:""}`);
}
function closeDrawer(){$("#drawerHost").innerHTML="";if(charts["c-dp"]){charts["c-dp"].destroy();delete charts["c-dp"]}}

/* ---------- slicers, sync bar, render ---------- */
const OPEN={id:null,q:""};
function renderSlicers(){
  const ys=uniq(L.filter(x=>x.date).map(x=>x.date.slice(0,4))).sort();
  $("#years").innerHTML=["all",...ys].map(y=>`<button data-y="${y}" aria-pressed="${S.year===y}">${y==="all"?"All":y}</button>`).join("");
  const cy=S.year===String(now.getFullYear());
  $("#months").innerHTML=MON.map((m,i)=>`<button data-m="${i+1}" aria-pressed="${S.months.has(i+1)}" class="${cy&&i===now.getMonth()?"cur":""}">${m}</button>`).join("");
  const o={project:uniq([...C.map(c=>c.project),...L.map(x=>x.project)]).filter(Boolean).sort(),type:uniq(C.map(c=>c.type).filter(Boolean)).sort(),team:TEAMS,
    reviewer:reviewersAll(),stage:STG,severity:SEVS};
  const lab={project:"Projects",type:"Types",team:"Teams",reviewer:"QA reviewers",stage:"Stages",severity:"Severities"};
  const caret='<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" stroke="currentColor" fill="none" stroke-width="1.6"/></svg>';
  $("#msHost").innerHTML=Object.keys(o).map(k=>{const sel=S.f[k];const lw=lab[k].replace(/^(?!QA)\w/,c=>c.toLowerCase());const v=!sel.size?"All "+lw:sel.size===1?[...sel][0]:`${sel.size} ${lw}`;
    return `<div class="ms" data-ms="${k}"><button type="button" class="${sel.size?"on":""}" aria-expanded="${OPEN.id===k}"><span class="v ${isAr(v)?"ar":""}">${esc(v)}</span>${caret}</button>
    ${OPEN.id===k?`<div class="pop" role="dialog" aria-label="${lab[k]}"><input type="search" placeholder="Search ${lw}" id="mss-${k}" value="${esc(OPEN.q)}"><div class="list">${o[k].filter(n=>!OPEN.q||n.toLowerCase().includes(OPEN.q.toLowerCase())).map(n=>`<label><input type="checkbox" data-f="${k}" value="${esc(n)}" ${sel.has(n)?"checked":""}><span class="${isAr(n)?"ar":""}" dir="auto">${esc(n)}</span></label>`).join("")||'<div class="muted" style="padding:8px">No matches</div>'}</div>
    <div class="acts"><button class="link" data-clear="${k}">Clear</button><button class="link" data-close>Done</button></div></div>`:""}</div>`}).join("");
  if(OPEN.id&&OPEN.focus){const i=document.getElementById("mss-"+OPEN.id);if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}}
  $("#reset").hidden=!(S.months.size||S.year!=="all"||Object.values(S.f).some(s=>s.size));
}
const reviewersAll=()=>uniq([...S.d.reviewers,...C.map(c=>c.reviewer),...L.map(x=>x.reviewer)].filter(Boolean));
function renderSync(){
  const st=S.status||{};const checked=new Date(st.checkedAt||S.d.parsedAt);const age=(Date.now()-checked)/36e5;let pill;
  if(S.busy)pill=`<span class="pill stale"><span class="dot"></span>${esc(S.busyMsg||"Working…")}</span>`;
  else if(st.ok===false)pill=`<span class="pill off" title="${esc(st.message||"")}"><span class="dot"></span>Last refresh failed ${relTime(checked)} · showing data from ${fmtDT(new Date(S.d.parsedAt))}</span>`;
  else pill=`<span class="pill ${age<1.6?"live":age<6?"stale":"off"}"><span class="dot"></span>${age<1.6?"Live · ":""}Last refresh ${fmtDT(checked)} (${relTime(checked)})</span>`;
  $("#sync").innerHTML=pill+(S.d.sourceModified?` <span class="hide-sm">Excel edited ${fmtDT(new Date(S.d.sourceModified))}</span>`:"");
  const b=$("#refresh");b.disabled=!!S.busy;b.classList.toggle("spin",!!S.busy);
}
function render(){
  if(!S.d)return;
  $(".slicers").hidden=false;renderSlicers();renderSync();
  $$(".tab").forEach(t=>t.setAttribute("aria-selected",t.dataset.v===S.view));
  VIEWS.forEach(v=>$("#v-"+v).hidden=v!==S.view);$("#loading").hidden=true;
  const n=ALERTS.filter(a=>a.sev==="bad").length;$("#abadge").textContent=n;$("#abadge").hidden=!n;
  ({overview:renderOverview,teams:renderTeams,repeated:renderRepeated,projects:renderProjects,courses:renderCourses,qa:renderQA,log:renderLog,alerts:renderAlerts})[S.view]();
  const st=S.status||{};
  $("#foot").innerHTML=`<span>Source: Quality Tracking sheet (Courses, Review Log, Lists) · refreshes automatically every hour${st.ok===false?` · <b style="color:var(--bad)">Last refresh failed: ${esc(st.message)}</b>`:""}</span><span>${C.length} courses · ${L.length} errors logged</span>`;
}
function toast(msg){const d=document.createElement("div");d.className="toast";d.textContent=msg;document.body.appendChild(d);setTimeout(()=>d.remove(),2800)}

/* ---------- events ---------- */
document.addEventListener("click",ev=>{
  const t=ev.target;
  const tab=t.closest(".tab");if(tab){S.view=tab.dataset.v;try{localStorage.setItem("qa.view",S.view)}catch(e){}history.replaceState(null,"","#"+S.view);render();window.scrollTo({top:0});return}
  const msb=t.closest(".ms>button");if(msb){const k=msb.parentElement.dataset.ms;OPEN.id=OPEN.id===k?null:k;OPEN.q="";OPEN.focus=true;renderSlicers();return}
  if(t.closest("[data-close]")){OPEN.id=null;renderSlicers();return}
  const cl=t.closest("[data-clear]");if(cl){S.f[cl.dataset.clear].clear();render();return}
  if(OPEN.id&&!t.closest(".pop")){OPEN.id=null;renderSlicers()}
  if(t.closest("#reset")){S.year="all";S.months.clear();Object.values(S.f).forEach(s=>s.clear());render();return}
  const y=t.closest("[data-y]");if(y){S.year=y.dataset.y;render();return}
  const m=t.closest("#months [data-m]");if(m){const v=+m.dataset.m;S.months.has(v)?S.months.delete(v):S.months.add(v);render();return}
  const om=t.closest("#ovMode [data-m]");if(om){S.ovMode=om.dataset.m;render();return}
  const cs=t.closest("#cst [data-s]");if(cs){S.cst=cs.dataset.s;render();return}
  const lsb=t.closest("#lst [data-s]");if(lsb){S.lst=lsb.dataset.s;render();return}
  const as=t.closest("[data-asev]");if(as){S.asev=S.asev===as.dataset.asev?"":as.dataset.asev;render();return}
  if(t.closest("#lcsv")){exportLog();return}
  const th=t.closest("th[data-st]");if(th&&!t.closest(".drawer")){const id=th.dataset.st,k=th.dataset.k;const cur=S.sort[id];S.sort[id]=cur&&cur.k===k?{k,d:-cur.d}:{k,d:1};render();return}
  if(t.closest("[data-close-d]")){closeDrawer();return}
  const g=(a)=>t.closest(`[data-${a}]`);let e;
  if(e=g("course")){openCourse(e.dataset.course);return}
  if(e=g("proj")){openProject(e.dataset.proj);return}
  if(e=g("team")){openTeam(e.dataset.team);return}
  if(e=g("pat")){openPattern(e.dataset.pat);return}
  if(e=g("err")){openErr(e.dataset.err);return}
  if(e=g("rev")){openRev(e.dataset.rev);return}
});
document.addEventListener("change",ev=>{const t=ev.target;
  if(t.matches("[data-f]")){const s=S.f[t.dataset.f];t.checked?s.add(t.value):s.delete(t.value);OPEN.focus=false;render();return}
  if(t.id==="lrep"){S.lrep=t.checked;render();return}
  if(t.id==="aarea"){S.aarea=t.value;render();return}
});
const keepFocus=(id,fn)=>{fn();const i=document.getElementById(id);if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}};
document.addEventListener("input",ev=>{const t=ev.target;
  if(t.id?.startsWith("mss-")){OPEN.q=t.value;OPEN.focus=true;renderSlicers();return}
  if(t.id==="cq"){S.cq=t.value;keepFocus("cq",renderCourses);return}
  if(t.id==="lq"){S.lq=t.value;keepFocus("lq",renderLog);return}
  if(t.id==="aq"){S.aq=t.value;keepFocus("aq",renderAlerts);return}
});
document.addEventListener("keydown",ev=>{if(ev.key==="Escape"){if($("#drawerHost").innerHTML)closeDrawer();else if(OPEN.id){OPEN.id=null;renderSlicers()}}});

/* ---------- data, login, refresh ---------- */
let REPO="almentor-pmo/almentor-pmo.github.io";
const api=()=>"https://api.github.com/repos/"+REPO;
const LSK="almentor.qa.key";
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const ub64=u=>btoa(String.fromCharCode(...new Uint8Array(u)));
let DKEY=null;
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
async function sha256hex(t){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function getJSON(url,o={}){const r=await fetch(url,{cache:"no-store",...o});if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}
async function unlock(user,pass){
  const keys=await getJSON("keys.json?t="+Date.now());const ent=keys.users[await sha256hex("almentor-qa:"+user.trim().toLowerCase())];if(!ent)return null;
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pass),"PBKDF2",false,["deriveKey"]);
  const kek=await crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt:b64(ent.salt),iterations:ent.iter},base,{name:"AES-GCM",length:256},false,["decrypt"]);
  try{return await crypto.subtle.decrypt({name:"AES-GCM",iv:b64(ent.iv)},kek,b64(ent.wk))}catch(e){return null}
}
const decryptBundle=async b=>JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:b64(b.iv)},DKEY,b64(b.ct))));
function ghHeaders(raw){const h={Accept:raw?"application/vnd.github.raw+json":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};if(S.token)h.Authorization="Bearer "+S.token;return h}
async function fetchBundle(fresh){if(fresh){try{return await getJSON(`${api()}/contents/quality/data.enc?ref=main&t=${Date.now()}`,{headers:ghHeaders(true)})}catch(e){}}return getJSON("data.enc?t="+Date.now())}
async function fetchStatus(fresh){if(fresh)return getJSON(`${api()}/contents/quality/status.json?ref=main&t=${Date.now()}`,{headers:ghHeaders(true)});return getJSON("status.json?t="+Date.now())}
async function loadBundle(fresh){
  const b=await decryptBundle(await fetchBundle(fresh));
  S.d=b.data;S.status=b.status;S.token=b.token||"";if(b.repo)REPO=b.repo;build();render();
}
async function refreshNow(){
  if(S.busy)return;if(!S.token){toast("Reloading the latest published data…");loadBundle(false).catch(()=>toast("Couldn't reach the dashboard data"));return}
  const rid=Math.random().toString(36).slice(2,10)+Date.now().toString(36);S.busy=true;S.busyMsg="Pulling latest from Excel…";renderSync();const t0=Date.now();let done=false;
  try{const r=await fetch(`${api()}/actions/workflows/qa-sync.yml/dispatches`,{method:"POST",headers:{...ghHeaders(false),"Content-Type":"application/json"},body:JSON.stringify({ref:"main",inputs:{request_id:rid}})});
    if(r.status!==204)throw new Error(r.status===401||r.status===403?"The Refresh token has expired or lacks permission":"GitHub answered "+r.status);
    while(Date.now()-t0<240000){await new Promise(r=>setTimeout(r,5000));S.busyMsg="Pulling latest from Excel… "+Math.round((Date.now()-t0)/1000)+"s";renderSync();
      try{const st=await fetchStatus(true);if(st.requestId===rid){done=true;break}}catch(e){}}
  }catch(e){S.busy=false;renderSync();toast(e.message);return}
  S.busy=false;try{await loadBundle(true)}catch(e){}
  toast(!done?"GitHub is taking longer than usual. The page will update when it finishes.":S.status?.ok===false?"Refresh finished with a problem: "+S.status.message:S.status?.message||"Up to date");renderSync();
}
function setMastH(){document.documentElement.style.setProperty("--mastH",$("#mast").offsetHeight+"px")}
addEventListener("resize",setMastH);setMastH();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if(S.d)render()});
$("#refresh").addEventListener("click",refreshNow);
async function start(rawKey){
  DKEY=await crypto.subtle.importKey("raw",rawKey,"AES-GCM",false,["decrypt"]);$("#gate").hidden=true;
  $("#who").innerHTML=`<div class="avatar">${esc(initials(S.user||"QA"))}</div><span class="hide-sm">${esc(S.user||"")}</span><button class="link" id="signout" type="button">Sign out</button>`;
  $("#signout").onclick=()=>{ls.del(LSK);location.reload()};
  try{await loadBundle(false)}catch(e){if(String(e).includes("OperationError")){ls.del(LSK);location.reload();return}console.error(e);$("#loadmsg").textContent="Couldn't load the dashboard data. Check your connection and reload the page.";return}
  setMastH();
  setInterval(async()=>{if(S.busy||document.hidden)return;try{const st=await fetchStatus(false);if(st.checkedAt&&st.checkedAt!==S.status?.checkedAt)await loadBundle(false)}catch(e){}},5*60000);
  setInterval(()=>{if(S.d)renderSync()},60000);
}
$("#login").addEventListener("submit",async ev=>{ev.preventDefault();const u=$("#u").value,p=$("#pw").value;$("#lerr").textContent="";$("#lbtn").disabled=true;$("#lbtn").textContent="Signing in…";
  try{const k=await unlock(u,p);if(!k){$("#lerr").textContent="That username or password isn't right. Try again.";return}
    S.user=u.trim();if($("#keep").checked)ls.set(LSK,JSON.stringify({u:S.user,k:ub64(k)}));await start(k)}
  catch(e){$("#lerr").textContent="Couldn't reach the dashboard. Check your connection and try again."}
  finally{$("#lbtn").disabled=false;$("#lbtn").textContent="Sign in"}});
(async()=>{if(!window.crypto?.subtle){$("#loadmsg").textContent="This browser can't open the dashboard. Use a recent Chrome, Edge, Safari or Firefox.";return}
  const saved=ls.get(LSK);if(saved){try{const o=JSON.parse(saved);S.user=o.u;await start(b64(o.k));return}catch(e){ls.del(LSK)}}
  $("#gate").hidden=false;$("#u").focus()})();
