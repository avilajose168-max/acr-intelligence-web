/* Subtle SVG-only login motion; no network or per-frame JavaScript. */
(function(){
 'use strict';
 const wall=document.getElementById('authWall');
 if(!wall)return;
 const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
 function sync(){wall.dataset.waveMotion=!wall.hidden&&!document.hidden&&!preference.matches?'running':'paused'}
 document.addEventListener('visibilitychange',sync);
 if(preference.addEventListener)preference.addEventListener('change',sync);else if(preference.addListener)preference.addListener(sync);
 new MutationObserver(sync).observe(wall,{attributes:true,attributeFilter:['hidden']});
 sync();
})();
