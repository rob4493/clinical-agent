/** Nonsecret configuration copied from the existing agent's Live channel by the
 * operator. Keep it distinct from the server API target and do not derive missing
 * environment/CRN identifiers from either. Importing this file starts no SDK.
 */
export const LiveConfiguration=Object.freeze({
 orchestrationID:'20261008-1704-4803-601b-bfaa1d6452f2_20261008-1709-1183-109d-fb3a93d7ee36',
 hostURL:'https://dl.watson-orchestrate.ibm.com',
 rootElementID:'root',
 chatOptions:Object.freeze({agentId:'cc37937e-983f-45d8-b0ff-e703c9ee20a1'})
});
export const EmbeddedLoaderUrl=LiveConfiguration.hostURL+'/wxochat/wxoLoader.js?embed=true';
export const LiveAgent=Object.freeze({name:'Endo Clinical Assistant',deployment:'Live',version:'1.3.0',verification:'operatorSuppliedLiveSnippet'});
