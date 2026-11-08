const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const script=(html.match(/<script>([\s\S]*?)<\/script>/i)||[])[1];
assert.ok(script,'Debe existir el bloque principal JS');
function segment(begin,end){
 const i=script.indexOf(begin),j=script.indexOf(end,i+begin.length);
 assert.ok(i>=0&&j>i, 'Falta funcion '+begin);
 return script.slice(i,j);
}
const source=[
 'function normalizeText(value){return String(value||"").replace(/\\s+/g," ").trim()}',
 segment('function eventFocus(c){', "function improvedDescription(c){"),
  segment('function improvedDescription(c){',"$('#improveDescription').onclick"),
 segment('function proposeWhys(c){','function generateWhys(){'),
 segment('function proposeBasicCause(c){','function resizeImage(file){')
].join('\n');
const scope=vm.createContext({});
vm.runInContext(source,scope,{timeout:1000});
const examples=[
 {description:'Siendo las 23:15, equipo detiene de forma automática por señal de relé de protección. Detector de temperatura #8 (posición rodamiento lado libre del motor) indica alta temperatura. Después de relubricar, pruebas en vacío y con carga controlada, más mediciones en terreno, se determina falla definitiva de rodamiento lado libre de motor.', equipment:'CT-11C',area:'Alimentación',downtime:'4'},
 {description:'El chancador se detuvo por fuga de aceite. Se observó que faltaba el tapón del drenaje.',equipment:'MP1000',area:'Chancado terciario',downtime:'1.5'},
 {description:'Se registró una caída de presión en el circuito hidráulico de clamping.',equipment:'CH3 L1'},
 {description:'Se cortó una correa de transmisión del harnero.',equipment:'Harnero banana'},
 {description:'El motor presentó una falla eléctrica y actuó la protección.',equipment:'Motor eléctrico'}
];
for(const [i,c] of examples.entries()){
 const whys=scope.proposeWhys(c);
 assert.equal(whys.length,5,'Se esperan cinco niveles');
 whys.forEach((answer,k)=>assert.ok(typeof answer==='string'&&answer.length>30, 'Nivel '+(k+1)+' vacío en '+i));
 assert.ok(!whys.some(v=>v.includes('HIPÓTESIS:')),'No repetir etiquetas hipótesis en los cinco porqués');
 const improved=scope.improvedDescription(c);
 assert.ok(improved.length>c.description.length+150,'Debe ampliar la descripción');
 assert.ok(improved.includes('Verificación requerida:'),'Debe distinguir verificación pendiente');
 assert.equal(scope.improvedDescription({...c,description:improved}),improved,'Evitar duplicación en el botón');
 if(i===0){
    assert.ok(whys[0].includes('sensor de temperatura'),'El caso CT-11C debe tratar la señal térmica');
    assert.ok(whys[1].includes('temperatura'),'El segundo porqué debe relacionarse con la señal de temperatura');
    assert.ok(whys.join(' ').includes('sensor'),'Los porqués deben conservar el dispositivo involucrado');
    assert.ok(!/harnero|correa|polea/.test(whys.join(' ').toLowerCase()),'No introducir equipos ajenos al evento');
    assert.ok(improved.startsWith('Siendo las 23:15'),'Conservar el inicio literal de la descripción');
    assert.ok(!/según el relato|según el investigador/i.test(improved),'No atribuir el texto a un relator');
    assert.ok(improved.includes('detector de temperatura N.º 8'),'Conservar canal identificado y mejorar su redacción');
    assert.ok(improved.includes('se detuvo automáticamente'),'Debe redactar el hecho como informe técnico directo');
 }
 if(i===1){assert.ok(whys[1].includes('tapón'),'Caso de tapón ausente en segundo porqué')}
 console.log('OK caso',i+1,whys.map(x=>x.slice(0,35)));
}

const doc=html;
assert.ok(doc.includes('name="safetyChoice" value="si"')&&doc.includes('name="safetyChoice" value="no"'),'Debe permitir declaración Sí/No de seguridad');
assert.ok(doc.includes('id="safetyPhotoInput"'),'Debe incluir fotografía específica de seguridad');
assert.ok(doc.includes('data-k="basicCause"'),'El campo causa básica debe ser editable');
assert.ok(!doc.includes('id="hypothesisFields"'),'Se eliminaron los tres campos de hipótesis');
assert.ok(doc.includes('data-k="causeConsequence"'),'Debe existir consecuencia de la causa');
assert.ok(doc.includes('data-k="basicCause"'),'Debe existir causa básica');
assert.ok(doc.indexOf('data-k="basicCause"')<doc.indexOf('data-k="causeConsequence"'),'Causa básica debe estar antes de consecuencia');
assert.ok(!/(?<!\$)\$\('[^']+'\)\.forEach/.test(script),'Nunca usar selector singular con forEach');
assert.ok(!doc.includes('Cronología / condiciones de operación (opcional)'),'La cronología antigua no debe mostrarse');
const incident={description:'Siendo las 23:15, equipo detiene de forma automática por señal de relé de protección. Detector de temperatura #8 (posición rodamiento lado libre del motor) indica alta temperatura.', equipment:'CT-11C'};
const basic=scope.proposeBasicCause(incident);
assert.ok(basic.length>35&&basic.length<170,'Causa básica breve y descriptiva');
assert.ok(/t[eé]rmica|temperatura|rodamiento/.test(basic),'Causa básica ligada al sensor de rodamiento');
const consequence=scope.proposeCauseConsequence({...incident,downtime:'4.03'});
assert.ok(consequence.includes('temperatura')&&consequence.includes('4,03'),'La consecuencia debe vincularse al evento y horas');
console.log('OK seguridad, causa básica, consecuencia y selectores múltiples');


const dashboardSource=segment('function dateKeyUTC(date){','function drawDashboard(){');
const dashboardScope=vm.createContext({normalizeText(value){return String(value||'').replace(/\s+/g,' ').trim()},Date,Map,Set,Number,String,Math,Array});
vm.runInContext(dashboardSource,dashboardScope,{timeout:1000});
assert.equal(dashboardScope.isoWeekStart('2026-11-08'),'2026-11-02','La semana del domingo comienza el lunes');
assert.equal(dashboardScope.isoWeekStart('2026-11-09'),'2026-11-09','La semana siguiente inicia el lunes');
assert.equal(dashboardScope.isoWeekStart('2027-01-01'),'2026-12-28','Cambio de año conserva semana ISO');
assert.equal(dashboardScope.isoWeekNumber('2026-12-28').week,53,'La semana de fin de año es ISO 53');
const weeklyCases=[
 {id:'a',equipment:'CT-11C',title:'Rodamiento motor',datetime:'2026-11-02T08:00',stopStart:'2026-11-02T08:00',downtime:'2'},
 {id:'b',equipment:'CT-11C',title:'Rodamiento motor',datetime:'2026-11-04T08:00',stopStart:'2026-11-04T08:00',downtime:'1'},
 {id:'c',equipment:'MP1000',title:'Fuga de aceite',datetime:'2026-11-08T22:00',downtime:'3.5'},
 {id:'d',equipment:'MP1000',title:'Fuga de aceite',datetime:'2026-11-09T01:00',downtime:'4'},
 {id:'empty',datetime:'2026-11-08T10:00',equipment:'',title:'',description:''}
];
const weeklyResult=dashboardScope.weeklyPareto(weeklyCases,'2026-11-02','events','equipment');
assert.equal(weeklyResult.records.length,3,'Solo eventos de lunes a domingo, ignorando borradores vacíos');
assert.equal(weeklyResult.rows.length,2,'Agrupa por equipo');
assert.equal(weeklyResult.rows[0].label,'CT-11C','Ordena Pareto por frecuencia');
assert.equal(weeklyResult.rows[0].events,2,'Agrupa fallas repetidas');
assert.equal(weeklyResult.rows[0].cumulative,200/3,'Pareto muestra porcentaje acumulado');
assert.equal(weeklyResult.hours,6.5,'Acumula horas detenidas');
const hourPareto=dashboardScope.weeklyPareto(weeklyCases,'2026-11-02','hours','equipment');
assert.equal(hourPareto.rows[0].label,'MP1000','Pareto por horas usa los tiempos de detención');
assert.equal(dashboardScope.casesInWeek(weeklyCases,'2026-11-09').length,1,'No mezcla semanas distintas');
assert.equal(dashboardScope.weeklyPareto(weeklyCases,'2026-10-19','events','equipment').records.length,0,'Semana sin eventos');
console.log('OK calendario ISO, Pareto por equipos, frecuencia, duración y archivos semanales');

const past=new Date(2026,10,9,0,0);
const weekFull=dashboardScope.weekTimeBounds('2026-11-02',past);
assert.equal(weekFull.baseHours,168,'Semana completa contabiliza 168 horas');
const wednesday=new Date(2026,10,4,12,0);
assert.equal(dashboardScope.weekTimeBounds('2026-11-02',wednesday).baseHours,60,'Miércoles 12:00 acumula 60 horas desde lunes 00:00');
const twoStops=[
 {id:'a',equipment:'CT-11C',title:'Falla lunes',stopStart:'2026-11-02T10:00',stopEnd:'2026-11-02T12:00',downtime:'2'},
 {id:'b',equipment:'CT-11C',title:'Falla martes',stopStart:'2026-11-03T15:00',stopEnd:'2026-11-03T17:00',downtime:'2'}
];
const kpi=dashboardScope.weeklyIndicators(twoStops,'2026-11-02','CT-11C',wednesday);
assert.equal(kpi.events,2,'Dos fallas hasta miércoles');
assert.equal(kpi.downtime,4,'Acumula las cuatro horas detenidas hasta miércoles');
assert.equal(kpi.baseHours,60,'Base autocalculada por reloj');
assert.equal(kpi.operating,56,'Descuenta fallas de la base automáticamente');
assert.equal(kpi.mttr,2,'MTTR 4h / 2 fallas');
assert.equal(kpi.mtbf,28,'MTBF 56h / 2 fallas');
assert.ok(Math.abs(kpi.availability-93.3333333333)<1e-7,'Disponibilidad parcial correcta');
const one=dashboardScope.weeklyIndicators([{id:'c',equipment:'CT-11C',title:'Falla',stopStart:'2026-11-02T08:00',stopEnd:'2026-11-02T12:00',downtime:'4'}],'2026-11-02','CT-11C',new Date(2026,10,3,0,0));
assert.equal(one.baseHours,24,'24 horas desde lunes a martes 00:00');
assert.equal(one.operating,20,'Ejemplo 24 h base menos 4 de falla');
assert.equal(one.mttr,4,'MTTR del ejemplo');
assert.equal(one.mtbf,20,'MTBF del ejemplo');
assert.ok(Math.abs(one.availability-83.3333333)<1e-6,'Disponibilidad ejemplo');
const unfinished=[{id:'x',equipment:'CT-11C',title:'Sin duración',stopStart:'2026-11-02T10:00',downtime:''}];
assert.equal(dashboardScope.weeklyIndicators(unfinished,'2026-11-02','CT-11C',wednesday).operating,null,'Falta de detención no se considera cero');
assert.equal(dashboardScope.weeklyIndicators(unfinished,'2026-11-02','CT-11C',wednesday).mtbf,null,'MTBF pendiente si falta fecha de término');
const nextWeek=dashboardScope.weeklyIndicators(twoStops,'2026-11-09','CT-11C',wednesday);
assert.equal(nextWeek.baseHours,0,'Semanas futuras no anticipan horas');
const carried=[{id:'d',equipment:'CT-11C',title:'Larga',stopStart:'2026-11-02T20:00',stopEnd:'2026-11-03T08:00',downtime:'12'}];
assert.equal(dashboardScope.weeklyIndicators(carried,'2026-11-02','CT-11C',new Date(2026,10,3,0,0)).downtime,4,'Las paradas abiertas solo se cuentan hasta el corte');
console.log('OK MTTR/MTBF en tiempo real, cierre semanal, ejemplo 24h/4h y recortes');
