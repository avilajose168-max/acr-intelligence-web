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
 segment('function proposeWhys(c){','function generateWhys(){')
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
