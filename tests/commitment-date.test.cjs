const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
function section(start,end){const i=html.indexOf(start),j=html.indexOf(end,i+start.length);assert.ok(i>=0&&j>i);return html.slice(i,j)}
function fixture(){
 const field={dataset:{ai:'0',ak:'due'},type:'date',tagName:'INPUT',value:'',events:{},addEventListener(name,fn){this.events[name]=fn}};
 const app={hidden:false},elements={'#actionFields':{innerHTML:''}},saved=[];let options,navigated=0;
 const c={id:'case-one',title:'Prueba fecha',whys:[],photos:[],actions:[{description:'MEJORAR PLAN MATRIZ',owner:'Responsable de prueba',due:''}]};
 const ctx=vm.createContext({console,JSON,Object,Array,String,Date,db:{cases:[c],settings:{companyName:'',logo:''}},selected:c.id,page:'analisis',syncClientId:'tab',localStorage:{},window:{fetch(){}},SUPABASE_URL:'https://test.invalid',PUBLIC_KEY:'public',personalAccessToken(){},ACRWorkspaceSync:function(o){options=o},document:{getElementById:()=>app,createElement:()=>({}),head:{appendChild(){}}},COMMIT_STATES:{Pendiente:'Pendiente'},esc:v=>String(v??''),text:v=>String(v??''),$:key=>elements[key]||(elements[key]={}),$$:selector=>selector==='[data-ai]'?[field]:[],navigate(){navigated++},drawActions:undefined});
 ctx.current=()=>ctx.db.cases.find(c=>c.id===ctx.selected);ctx.persist=()=>saved.push(JSON.parse(JSON.stringify(ctx.db)));
 if(html.includes('function workspaceSignature('))vm.runInContext(section('function workspaceSignature(', 'const personalSync='),ctx);
 vm.runInContext(section('const personalSync=new ACRWorkspaceSync(', "document.getElementById('cloudRetry')"),ctx);
 vm.runInContext(section('function drawActions(){',"$('#addAction').onclick"),ctx);
 vm.runInContext(section('function renderCaseReport(', 'function download('),ctx);
 ctx.reportBox=(title,content)=>'<h3>'+title+'</h3>'+content;
 return {ctx,field,saved,get options(){return options},get navigated(){return navigated}};
}
test('Editing the date after an unchanged cloud refresh updates the live investigation and persisted copy',()=>{
 const x=fixture();x.ctx.drawActions();const original=x.ctx.db;
 x.options.apply(JSON.parse(JSON.stringify(x.ctx.db)));
 assert.equal(x.ctx.db,original,'Unchanged cloud data must preserve references used by visible form handlers');
 x.field.value='2026-11-20';x.field.events.input();
 assert.equal(x.ctx.db.cases[0].actions[0].due,'2026-11-20');assert.equal(x.saved.at(-1).cases[0].actions[0].due,'2026-11-20');
});
test('Equivalent JSON key ordering does not replace the workspace or redraw an active date picker',()=>{
 const x=fixture(),original=x.ctx.db;const reordered={settings:{logo:'',companyName:''},cases:[{actions:original.cases[0].actions,photos:[],whys:[],title:'Prueba fecha',id:'case-one'}]};x.options.apply(reordered);assert.equal(x.ctx.db,original);assert.equal(x.navigated,0);
});
test('A browser date change event is saved even when no input event is emitted',()=>{
 const x=fixture();x.ctx.drawActions();assert.equal(typeof x.field.events.change,'function');x.field.value='2026-12-05';x.field.events.change();assert.equal(x.ctx.db.cases[0].actions[0].due,'2026-12-05');
});
test('Date edits resolve the current case rather than a previous object',()=>{
 const x=fixture();x.ctx.drawActions();x.ctx.db=JSON.parse(JSON.stringify(x.ctx.db));x.field.value='2027-01-03';x.field.events.input();assert.equal(x.ctx.db.cases[0].actions[0].due,'2027-01-03');
});
test('The saved commitment date survives serialization and appears in all three report formats',()=>{
 const x=fixture();x.ctx.drawActions();x.field.value='2026-11-20';x.field.events.input();x.ctx.db=JSON.parse(JSON.stringify(x.saved.at(-1)));
 for(const format of ['5why','acr','a3']){const box={};x.ctx.renderCaseReport(x.ctx.current(),box,format,{name:'Prueba',logo:''});assert.ok(box.innerHTML.includes('Fecha de compromiso'));assert.ok(box.innerHTML.includes('<td>2026-11-20</td>'),format)}
});
