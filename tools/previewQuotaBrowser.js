// Paste only into the authenticated, access-verified Deploy Preview console.
// Uses the browser's existing login; never reads, prints or exports cookies.
(async()=>{
 if(!/^deploy-preview-[1-9]\d*--clinicalagent\.netlify\.app$/.test(location.hostname)||location.protocol!=='https:')throw new Error('Deploy Preview required.');
 const route='/.netlify/functions/verifyQuota';
 const abort=new AbortController();let observedAdmissions=0,limitExceeded=false;
 async function post(payload){const response=await fetch(route,{method:'POST',signal:abort.signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result={status:response.status,payload:await response.json()};if(result.status===200&&result.payload.outcome==='admitted'&&++observedAdmissions>3){limitExceeded=true;abort.abort();}return result;}
 const started=await post({action:'start'});
 if(started.status!==200||started.payload.status!=='freshStoreCreated')throw new Error('Operator harness unavailable.');
 const attempts=await Promise.allSettled(Array.from({length:40},()=>post({action:'reserve',runId:started.payload.runId})));
 const admitted=attempts.filter(result=>result.status==='fulfilled'&&result.value.status===200&&result.value.payload.outcome==='admitted').length;
 const exhausted=attempts.filter(result=>result.status==='fulfilled'&&result.value.status===429&&result.value.payload.outcome==='exhausted').length;
 const workers=new Set(attempts.flatMap(result=>result.status==='fulfilled'&&typeof result.value.payload.workerId==='string'?[result.value.payload.workerId]:[])).size;
 console.log(JSON.stringify({execution:'hostedQuotaOnly',attempted:40,limit:3,admitted,exhausted,errors:40-admitted-exhausted,observedWorkers:workers,capacityPassed:!limitExceeded&&admitted===3&&exhausted===37,crossWorkerObserved:workers>1,limitExceeded,ibm:'notInvoked'}));
 if(limitExceeded)throw new Error('STOP: capacity exceeded. Pending requests were aborted; already accepted storage operations cannot be undone. Disable preview verification and do not run further tests.');
})();
