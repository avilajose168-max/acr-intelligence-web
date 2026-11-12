const assert=require('node:assert/strict');
const {filterFollowupRows,followupType,followupSector}=require('../continuous-improvement.js');
const rows=[
 {key:'m',c:{area:'Área Seca',sector:'Chancado',failureType:'Mecánica'}},
 {key:'e',c:{area:'Área Seca',sector:'Chancado',failureType:'Eléctrica'}},
 {key:'o',c:{area:'Área Seca',sector:'Apilamiento',failureType:'Operacional'}},
 {key:'w',c:{area:'Área Húmeda',productionUnit:'Lixiviación',failureType:'Mecánica'}},
 {key:'old',c:{title:'Falla eléctrica'}}
];
const ids=f=>filterFollowupRows(rows,f).map(r=>r.key);
assert.deepEqual(ids({}),['m','e','o','w','old']);
assert.deepEqual(ids({area:'Área Seca',sector:'Chancado',type:'Mecánica'}),['m']);
assert.deepEqual(ids({area:'Área Seca',type:'Mecánica'}),['m']);
assert.deepEqual(ids({area:'Área Húmeda',sector:'Lixiviación'}),['w']);
assert.deepEqual(ids({area:'Área Seca',sector:'Chancado',type:'Operacional'}),[]);
assert.deepEqual(ids({type:'Sin clasificar'}),['old']);
assert.deepEqual(ids({area:'Sin clasificar'}),['old']);
assert.equal(followupType({failureType:'electrica'}),'Eléctrica');
assert.equal(followupSector({area:'Área Húmeda',productionUnit:'Lixiviación',sector:'Legacy'}),'Lixiviación');
assert.deepEqual(ids({}),rows.map(r=>r.key));
console.log('PASS: combined area/sector/type filters, wet-area units, legacy unclassified records, no title inference, reset and empty results.');
