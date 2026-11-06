/** Conservative evidence check: status codes and Netlify server headers alone
 * cannot distinguish platform authentication from an application error.
 */
export function platformLogin(response:{status:number;headers:Headers},origin:string){
 const location=response.headers.get('location');let login=false;
 if(location){try{const target=new URL(location,origin);login=target.protocol==='https:'&&target.hostname==='app.netlify.com'&&/login|auth/i.test(target.pathname);}catch{/* Unknown locations are not proof. */}}
 const application=response.headers.has('x-quota-verification')||response.headers.has('x-clinical-mode');
 return [302,303,307,308].includes(response.status)&&login&&!application;
}
