const ALLOWED_ORIGINS=new Set(["https://avilajose168-max.github.io","https://acrintegrity.cl","https://acr-integrity.vercel.app"]);
const hits=new Map();
Deno.serve(async req=>{
 const origin=req.headers.get("origin")||"";
 if(!ALLOWED_ORIGINS.has(origin))return new Response("Forbidden",{status:403});
 const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","access-control-allow-origin":origin,"vary":"Origin","cache-control":"no-store"}});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":origin,"access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"authorization,apikey,content-type"}});
 if(req.method!=="POST")return json(405,{error:"Método no permitido"});
 const bearer=req.headers.get("authorization")||"";
 if(!/^Bearer [A-Za-z0-9._-]+$/.test(bearer))return json(401,{error:"Debes iniciar sesión."});
 try {
  const apiUrl=Deno.env.get("SUPABASE_URL")||"";
  let apiKey="";
  try{apiKey=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}").default||""}catch(_){}
  apiKey ||= Deno.env.get("SUPABASE_ANON_KEY")||"";
  const check=await fetch(apiUrl+"/auth/v1/user",{headers:{"authorization":bearer,"apikey":apiKey},signal:AbortSignal.timeout(10000)});
  if(!check.ok)return json(401,{error:"La sesión de usuario no es válida."});
  const user=await check.json();
  if(!user?.id)return json(401,{error:"La sesión de usuario no es válida."});
  const now=Date.now(),counter=hits.get(user.id)||{count:0,start:now};
  if(now-counter.start>60000){counter.count=0;counter.start=now}
  counter.count++;
  hits.set(user.id,counter);
  if(counter.count>6)return json(429,{error:"Demasiadas solicitudes. Intenta nuevamente en un minuto."});
  const body=await req.text();
  if(body.length>16000)return json(413,{error:"El texto es demasiado extenso."});
  const input=JSON.parse(body);
  if(!["rewrite","whys","causes"].includes(input.mode)||typeof input.description!=="string"||input.description.trim().length<12)return json(400,{error:"Describe primero la falla con suficiente detalle."});
  const geminiKey=Deno.env.get("GEMINI_API_KEY");
  const openaiKey=Deno.env.get("OPENAI_API_KEY");
  if(!geminiKey&&!openaiKey)return json(503,{code:"AI_NOT_CONFIGURED",error:"La IA generativa aún no está configurada. El análisis local continúa disponible."});
  const context={
    mode:input.mode,
    equipment:String(input.equipment||"").slice(0,150),
    area:String(input.area||"").slice(0,120),
    title:String(input.title||"").slice(0,180),
    downtime:String(input.downtime||"").slice(0,60),
    timeline:String(input.timeline||"").slice(0,2500),
    description:input.description.slice(0,8500),
    evidence:String(input.validation||"").slice(0,1500),
    whys:[] // Regenerar desde los hechos, sin reutilizar cadenas previas no verificadas.
  };
  const instructions=[
    "Eres ingeniero senior de confiabilidad industrial y facilitador de ACR. Produce español técnico, natural, preciso y profesional sin repeticiones ni relleno.",
    "Usa exclusivamente hechos expresados en el caso. No inventes mediciones, alarmas, intervenciones, piezas o pruebas realizadas. Si faltan antecedentes, usa expresiones condicionales sin presentar inferencias como hechos.",
    "Genera JSON estrictamente según el esquema; no expongas información ajena al caso.",
    "Modo rewrite: escribe en voz técnica directa como autor del parte de mantenimiento, sin frases según el relato, según el investigador, el relator dijo, se reportó el siguiente comportamiento o este documento organiza. Comienza directamente con la primera frase y hora del usuario, por ejemplo Siendo las 23:15, el equipo..., conservando equipo, síntomas, sensor, ubicación y secuencia de acciones tal como aparecen. Mejora sintaxis, precisión terminológica y coherencia: no devuelvas una copia literal del texto de entrada. Para relatos breves usa uno o dos párrafos concisos; no alargues con información inventada. Por ejemplo, una sospecha debe quedar como hipótesis inicial pendiente de verificación y una detención por baja presión puede describirse como detención asociada a una condición de baja presión en el sistema hidráulico. No agregues procedimientos ejecutados no presentes. Diferencia hechos de verificaciones propuestas y evita texto burocrático o autorreferencial.",
    "Modo whys: exactamente cinco respuestas que formen una CADENA causal basada estrictamente en la descripción de qué ocurrió: nivel 1 causa inmediata, nivel 2 por qué ocurrió 1, nivel 3 por qué ocurrió 2, nivel 4 por qué ocurrió 3, nivel 5 por qué ocurrió 4. Cada nivel debe abordar el mismo componente, protección y síntoma del relato; no cambiar a otro subsistema por palabras aisladas. Si el caso habla de sensor de temperatura de rodamiento del motor, no introduzcas correas, harneros, poleas ni vibraciones no documentadas. Distingue una señal de alta temperatura de la confirmación de sobretemperatura real. No rotules cada respuesta HIPÓTESIS. Las inferencias no constatadas usan podría o por verificar. No repitas el problema.",
    "Las respuestas previas de 5 Porqués son borradores, no evidencia. No conviertas sus inferencias en hechos. Baja presión no demuestra bajo nivel de aceite, bajo caudal, fuga ni una maniobra específica.",
    "En modo whys, cada nivel debe explicar causalmente al anterior y no repetirlo con otras palabras. Detente en el primer salto sin evidencia: deja ese nivel y los restantes como Pendiente de verificar, indicando el antecedente concreto necesario sin inventar causas. No fuerces cinco causas, no deduzcas fallos de procedimiento, capacitación o mantenimiento sin antecedentes. Una sospecha de mala posición de válvula no explica por sí sola por qué quedó en esa posición.",
    "Si el único dato es una detención por baja presión y una sospecha sobre la posición de la válvula, no añadas un descenso de nivel de fluido ni de caudal como hecho. El nivel 2 puede expresar la sospecha de la válvula como posibilidad; en el nivel 3 debe indicarse que no se conoce por qué habría estado en esa posición, y los niveles restantes deben quedar pendientes de evidencia. No cierres una cadena repitiendo que la válvula estaba mal posicionada.",
    "Modo causes: todas las hipótesis deben explicar específicamente el síntoma y componente del texto qué ocurrió. No inventes causas de otro subsistema. Enumera dos a cuatro alternativas plausibles con evidencia de verificación pertinente, no listas genéricas. Redacta conclusión ejecutiva directamente desde el evento y sus acciones, sin decir según el investigador ni atribuciones al relator. Separa determinaciones registradas de causas verificadas; no confirmes una causa raíz sin pruebas suficientes.",
    "En modo causes devuelve además basicCause: causa básica preliminar breve, vinculada al evento y marcada como hipótesis cuando no hay evidencia; si no puede establecerse, indica Causa no determinada y qué verificar. No atribuyas deficiencias de inspección o procedimientos sin evidencia. causeConsequence describe solo la consecuencia operacional documentada; no inventes daños ni horas de detención.",
    "En cada modo, los campos que no apliquen van vacíos y whys siempre tiene 5 strings."
  ].join(" ");
  const schema={type:"object",additionalProperties:false,required:["description","whys","causes","conclusion","basicCause","causeConsequence"],properties:{
    description:{type:"string"},whys:{type:"array",items:{type:"string"},minItems:5,maxItems:5},
    causes:{type:"string"},conclusion:{type:"string"},basicCause:{type:"string"},causeConsequence:{type:"string"}
  }};
  if(geminiKey){
    const configuredModel=Deno.env.get("GEMINI_MODEL")||"";
    let model=!configuredModel||configuredModel.startsWith("gemini-2.5-")?"gemini-3.5-flash-lite":configuredModel;
    const generationDeadline=Date.now()+36000;
    const generate=()=>fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
      method:"POST",headers:{"content-type":"application/json","x-goog-api-key":geminiKey},
      body:JSON.stringify({systemInstruction:{parts:[{text:instructions}]},contents:[{role:"user",parts:[{text:JSON.stringify(context)}]}],generationConfig:{responseMimeType:"application/json",responseJsonSchema:schema,maxOutputTokens:3000}}),
      signal:AbortSignal.timeout(Math.min(18000,Math.max(1000,generationDeadline-Date.now())))
    });
    let ai=await generate();
    if(ai.status===404){
      const catalogResponse=await fetch("https://generativelanguage.googleapis.com/v1beta/models",{headers:{"x-goog-api-key":geminiKey},signal:AbortSignal.timeout(10000)});
      const catalog=await catalogResponse.json().catch(()=>({}));
      const available=new Set((catalog.models||[]).filter(x=>(x.supportedGenerationMethods||[]).includes("generateContent")).map(x=>String(x.name||"").replace(/^models\//,"")));
      const compatible=["gemini-3.5-flash-lite","gemini-3.1-flash-lite","gemini-2.5-flash-lite","gemini-2.5-flash"].find(name=>available.has(name)&&name!==model);
      console.info("acr-assistant model availability",JSON.stringify({requested:model,compatible:compatible||null,catalog_status:catalogResponse.status}));
      if(compatible){model=compatible;ai=await generate()}
    }
    if([500,502,503,504].includes(ai.status)&&generationDeadline-Date.now()>1500){
      console.info("acr-assistant transient retry",JSON.stringify({model,status:ai.status,mode:input.mode}));
      await new Promise(resolve=>setTimeout(resolve,600));ai=await generate();
    }
    if(!ai.ok){const failure=await ai.json().catch(()=>({}));console.error("gemini status",ai.status,String(failure?.error?.status||"UNKNOWN").slice(0,60));return json(ai.status===429?429:502,{error:ai.status===429?"Límite de consultas de IA alcanzado. Utiliza el análisis local.":"La IA no pudo completar la solicitud. Utiliza el análisis local."})}
    const payload=await ai.json();
    const result=(payload.candidates||[]).flatMap(x=>x.content?.parts||[]).map(x=>x.text||"").join("");
    try{
      const data=JSON.parse(result);
      if(typeof data.description!=="string"||!Array.isArray(data.whys)||data.whys.length!==5||typeof data.causes!=="string"||typeof data.conclusion!=="string"||typeof data.basicCause!=="string"||typeof data.causeConsequence!=="string")throw new Error("schema");
      console.info("acr-assistant success",JSON.stringify({provider:"gemini",model,mode:input.mode}));
      return json(200,{data,provider:"gemini"});
    }catch(_){console.warn("acr-assistant invalid response",JSON.stringify({model,finish_reason:payload.candidates?.[0]?.finishReason||null,output_length:result.length}));return json(502,{error:"La IA devolvió una respuesta incompleta. Utiliza el análisis local."})}
  }
  const ai=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+openaiKey},
    body:JSON.stringify({model:"gpt-4o-mini",instructions,input:JSON.stringify(context),max_output_tokens:2200,text:{format:{type:"json_schema",name:"acr_analysis",schema,strict:true}}}),
    signal:AbortSignal.timeout(45000)
  });
  if(!ai.ok){console.error("openai status",ai.status);return json(502,{error:"La IA no pudo completar la solicitud. Utiliza el análisis local."})}
  const payload=await ai.json();
  const result=(payload.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text||"").join("");
  try{return json(200,{data:JSON.parse(result),provider:"openai"})}
  catch(_){return json(502,{error:"La IA devolvió una respuesta incompleta."})}
 }catch(e){
  console.error("acr-assistant",String(e).slice(0,180));
  return json(503,{error:"El servicio de IA no está disponible en este momento."});
 }
});