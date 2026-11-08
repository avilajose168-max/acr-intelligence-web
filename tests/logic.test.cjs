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

const kpi=dashboardScope.weeklyIndicators(weeklyCases,'2026-11-02','__all__',24);
assert.equal(kpi.documentedCount,3,'Tres fallas con duración');
assert.equal(kpi.mttr,6.5/3,'MTTR = detención total / fallas documentadas');
assert.equal(kpi.operating,17.5,'Horas operativas = base menos detención');
assert.equal(kpi.mtbf,17.5/3,'MTBF = horas operativas / fallas');
assert.ok(Math.abs(kpi.availability-100*17.5/24)<1e-9,'Disponibilidad exacta');
assert.equal(dashboardScope.weeklyIndicators(weeklyCases,'2026-11-02','__all__',null).mtbf,null,'No inventar MTBF sin horas base');
assert.equal(dashboardScope.weeklyIndicators(weeklyCases,'2026-10-19','__all__',24).mtbf,null,'No dividir por cero');
assert.equal(dashboardScope.weeklyIndicators(weeklyCases,'2026-11-02','__all__',4).availability,null,'Horas detenidas superiores a base no validan disponibilidad');
const byAsset=dashboardScope.weeklyIndicators(weeklyCases,'2026-11-02','CT-11C',24);
assert.equal(byAsset.events,2,'Filtro por equipo evita mezclar detenciones');
assert.equal(byAsset.downtime,3,'Suma solo horas de ese equipo');
assert.equal(byAsset.operating,21,'Calcula horas operativas por equipo');
assert.equal(byAsset.mttr,1.5,'MTTR por equipo');
assert.equal(byAsset.mtbf,10.5,'MTBF por equipo');
assert.equal(byAsset.availability,87.5,'Disponibilidad por equipo');
const one=dashboardScope.weeklyIndicators([{id:'x',equipment:'CT-11C',title:'Falla',datetime:'2026-11-02T10:00',downtime:'4'}],'2026-11-02','CT-11C',24);
assert.equal(one.mttr,4,'Ejemplo 24 h base 4 h detenidas: MTTR 4');
assert.equal(one.mtbf,20,'Ejemplo 24 h base 4 h detenidas: MTBF 20');
assert.ok(Math.abs(one.availability-83.333333333)<0.0001,'Ejemplo disponibilidad 83.33%');
const incomplete=[{id:'x',equipment:'CT-11C',title:'Falla sin tiempo',datetime:'2026-11-02T10:00',downtime:''}];
assert.equal(dashboardScope.weeklyIndicators(incomplete,'2026-11-02','__all__',24).mttr,null,'La ausencia de duración no se trata como cero');
assert.equal(dashboardScope.weeklyIndicators(incomplete,'2026-11-02','__all__',24).mtbf,null,'No calcular MTBF con detenciones incompletas');
console.log('OK indicadores V28, base/operación, alcance por equipo y disponibilidad');
