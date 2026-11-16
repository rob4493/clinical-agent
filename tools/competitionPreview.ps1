# Operator-only configuration management. No probe POST, IBM call or Blobs writes.
[CmdletBinding(SupportsShouldProcess)]
param(
 [Parameter(Mandatory)][ValidateSet('Activate','Disable','Status')][string]$Action,
 [ValidateRange(1,240)][int]$DurationMinutes=240,
 [ValidateRange(1,1000)][int]$DailyCalls=50,
 [ValidateRange(1,200)][int]$DailySessions=20,
 [switch]$Authorized,
 [switch]$AcceptResidualRisks,
 [switch]$EditableDiscussion
)
$ErrorActionPreference='Stop'
$siteId='b1f36feb-3225-4a27-9dff-de780d166161'
if($Action -eq 'Activate' -and (!$Authorized -or !$AcceptResidualRisks)){throw 'Activation requires explicit session authorization and residual-risk acceptance.'}
if($WhatIfPreference){Write-Output "Dry run: $Action, clinicalagent Deploy Preview overrides; existing scopes preserved. No network or settings operations.";return}
if(!$PSCmdlet.ShouldProcess('clinicalagent Deploy Preview value overrides', $Action)){return}
if(!(Get-Command netlify -ErrorAction SilentlyContinue)){throw 'Existing Netlify CLI is required; no install or login is attempted.'}
function Invoke-Netlify([string]$method,[hashtable]$data){
 $raw=& netlify api $method --data ($data|ConvertTo-Json -Depth 12 -Compress) 2>&1
 if($LASTEXITCODE -ne 0){$code=if(($raw -join "`n") -match '403|Forbidden'){'HTTP403'}elseif(($raw -join "`n") -match '422|Unprocessable'){'HTTP422'}else{'unavailable'};throw ('Netlify operation failed: '+$method+' / '+$code)}
 try{return (($raw -join "`n")|ConvertFrom-Json -DateKind String)}catch{throw 'Netlify returned invalid configuration metadata.'}
}
function Read-Environment([string]$context){
 $raw=& netlify env:list --site clinicalagent --context $context --scope functions --json 2>$null
 if($LASTEXITCODE -ne 0){throw 'Environment metadata unavailable.'}
 try{return (($raw -join "`n")|ConvertFrom-Json -DateKind String)}catch{throw 'Netlify returned invalid configuration metadata.'}
}
function Environment-Hash($envMap){
 $ordered=[ordered]@{};foreach($key in ($envMap.PSObject.Properties.Name|Sort-Object)){$ordered[$key]=$envMap.$key}
 return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($ordered|ConvertTo-Json -Depth 12 -Compress))))
}
$site=Invoke-Netlify 'getSite' @{site_id=$siteId}
if($site.name -cne 'clinicalagent' -or !$site.sso_login -or $site.sso_login_context -cne 'non_production'){throw 'Protected project identity or SSO mismatch.'}
$productionCommit=$site.published_deploy.commit_ref
$productionHash=Environment-Hash (Read-Environment 'production')
$preview=Read-Environment 'deploy-preview'
if($Action -eq 'Status'){
 $until=[DateTimeOffset]::MinValue;$valid=[DateTimeOffset]::TryParse([string]$preview.ORCHESTRATE_COMPETITION_UNTIL,[ref]$until)
 [pscustomobject]@{Source='Management configuration, not trusted runtime identity';CompetitionEnabled=($preview.ORCHESTRATE_COMPETITION_ENABLED -ceq 'true');KillSwitchEngaged=($preview.ORCHESTRATE_PROBE_KILL_SWITCH -ceq 'true');WindowUnexpired=($valid -and $until -gt [DateTimeOffset]::UtcNow)}
 return
}
function Configuration-Hash($records,[string[]]$keys){
 $items=@($records|Where-Object {$_.key -in $keys}|Sort-Object key|ForEach-Object {
  $entry=$_;$values=@($entry.values);$normalized=@()
  # Netlify materializes All into its built-in contexts when adding an override.
  # Compare the preserved values, not that equivalent storage representation.
  foreach($context in @('dev','branch-deploy','production')){
   $selected=@($values|Where-Object {$_.context -ceq $context})
   if(!$selected.Count){$selected=@($values|Where-Object {$_.context -ceq 'all'})}
   foreach($value in $selected){$normalized+=[ordered]@{context=$context;context_parameter=$null;value=$value.value}}
  }
  foreach($value in @($values|Where-Object {$_.context -cnotin @('all','deploy-preview','dev','branch-deploy','production')})){$normalized+=[ordered]@{context=$value.context;context_parameter=$value.context_parameter;value=$value.value}}
  [ordered]@{key=$entry.key;scopes=@($entry.scopes|Sort-Object);values=@($normalized|Sort-Object context,context_parameter)}
 })
 return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $items -Depth 12 -Compress))))
}
$records=@(Invoke-Netlify 'getEnvVars' @{account_id=$site.account_id;site_id=$siteId})
$originalKeys=@($records.key);$originalConfigurationHash=Configuration-Hash $records $originalKeys
$existing=@{};foreach($entry in $records){$existing[$entry.key]=$entry.scopes}
function Set-Preview([string]$key,[string]$value){
 if($key -notmatch '^ORCHESTRATE_(?:DISCUSSION_AUTHORIZED|COMPETITION_(?:ENABLED|STARTED_AT|UNTIL|DAILY_CALL_LIMIT|DAILY_SESSION_LIMIT)|PROBE_(?:ENABLED|KILL_SWITCH|EXCEPTION_ENABLED|TEST_UNTIL|EXCEPTION_APPROVAL))$'){throw 'Configuration key not permitted.'}
 if($existing.ContainsKey($key)){
  if('functions' -notin @($existing[$key]) -and 'all' -notin @($existing[$key])){throw 'Existing variable does not include Functions; no scope is changed.'}
  $null=Invoke-Netlify 'setEnvVarValue' @{account_id=$site.account_id;site_id=$siteId;key=$key;body=@{context='deploy-preview';value=$value}}
 }else{
  $null=Invoke-Netlify 'createEnvVars' @{account_id=$site.account_id;site_id=$siteId;body=@(@{key=$key;scopes=@('functions');values=@(@{context='deploy-preview';value=$value})})}
  $existing[$key]=@('functions')
 }
}
$closed=[ordered]@{ORCHESTRATE_COMPETITION_ENABLED='false';ORCHESTRATE_PROBE_KILL_SWITCH='true';ORCHESTRATE_COMPETITION_STARTED_AT='';ORCHESTRATE_COMPETITION_UNTIL='';ORCHESTRATE_PROBE_ENABLED='false';ORCHESTRATE_PROBE_EXCEPTION_ENABLED='false';ORCHESTRATE_PROBE_TEST_UNTIL='';ORCHESTRATE_PROBE_EXCEPTION_APPROVAL=''}
if($existing.ContainsKey('ORCHESTRATE_DISCUSSION_AUTHORIZED')){$closed['ORCHESTRATE_DISCUSSION_AUTHORIZED']='false'}
try{
 if($Action -eq 'Activate'){
  if($EditableDiscussion -and !$existing.ContainsKey('ORCHESTRATE_DISCUSSION_AUTHORIZED')){throw 'Existing editable discussion authorization setting is required.'}
  foreach($pair in @(@('ORCHESTRATE_ENABLED','false'),@('ENDO_DEMO_INFERENCE_ENABLED','false'),@('ENDO_DEMO_KILL_SWITCH','true'),@('ORCHESTRATE_EMBED_PREVIEW_ENABLED','false'),@('ORCHESTRATE_EMBED_KILL_SWITCH','true'),@('OTEL_SDK_DISABLED','true'))){if($preview.($pair[0]) -cne $pair[1]){throw 'Existing public/embedded inference or privacy gates are not safely closed.'}}
  if($preview.ORCHESTRATE_AGENT_ID -cne 'c6698d4e-a08d-4b77-bf05-139ff3b4c695' -or $preview.ORCHESTRATE_ENVIRONMENT -cne 'live' -or $preview.WATSONX_AI_AUTH_TYPE -cne 'iam' -or $preview.ORCHESTRATE_API_URL -cnotmatch '^https://api\.eu-de\.watson-orchestrate\.cloud\.ibm\.com/instances/[A-Za-z0-9][A-Za-z0-9-]{0,127}$' -or $preview.ORCHESTRATE_EMBED_PREVIEW_ID -cne '4' -or $preview.ORCHESTRATE_EMBED_PREVIEW_ORIGIN -cne 'https://deploy-preview-4--clinicalagent.netlify.app' -or [string]::IsNullOrWhiteSpace($preview.ORCHESTRATE_EMBED_OPERATOR_IDS)){throw 'Existing target or Preview #4/operator pins are invalid.'}
  # Close first, then configure the session, then enable last. No old quota is touched.
  foreach($key in $closed.Keys){Set-Preview $key $closed[$key]}
  $now=[DateTimeOffset]::UtcNow;$expires=$now.AddMinutes($DurationMinutes).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $desired=[ordered]@{ORCHESTRATE_COMPETITION_STARTED_AT=$now.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');ORCHESTRATE_COMPETITION_UNTIL=$expires;ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT=[string]$DailyCalls;ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT=[string]$DailySessions;ORCHESTRATE_PROBE_KILL_SWITCH='false';ORCHESTRATE_COMPETITION_ENABLED='true'}
  if($EditableDiscussion){$desired['ORCHESTRATE_DISCUSSION_AUTHORIZED']='true'}
 }else{
  $desired=[ordered]@{};foreach($key in $closed.Keys){$desired[$key]=$closed[$key]}
  # Verify write access to both limit keys without changing the effective limits.
  $desired['ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT']=if($null -ne $preview.ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT){[string]$preview.ORCHESTRATE_COMPETITION_DAILY_CALL_LIMIT}else{[string]$DailyCalls}
  $desired['ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT']=if($null -ne $preview.ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT){[string]$preview.ORCHESTRATE_COMPETITION_DAILY_SESSION_LIMIT}else{[string]$DailySessions}
 }
 foreach($key in $desired.Keys){Set-Preview $key $desired[$key]}
 $saved=Read-Environment 'deploy-preview'
 foreach($key in $desired.Keys){if($saved.$key -cne $desired[$key]){throw 'Configuration readback mismatch.'}}
 $finalRecords=@(Invoke-Netlify 'getEnvVars' @{account_id=$site.account_id;site_id=$siteId})
 if((Configuration-Hash $finalRecords $originalKeys) -cne $originalConfigurationHash){throw 'Variable scopes or non-preview values changed; stop and review.'}
 $finalSite=Invoke-Netlify 'getSite' @{site_id=$siteId}
 if($finalSite.published_deploy.commit_ref -cne $productionCommit -or (Environment-Hash (Read-Environment 'production')) -cne $productionHash){throw 'Production baseline changed; stop and review.'}
 Write-Output 'Preview overrides saved and read back; Production, global values and scopes unchanged.'
 if($Action -eq 'Activate'){Write-Output ('Session expiry UTC: '+$expires);if($EditableDiscussion){Write-Output 'MANUAL REBUILD REQUIRED: protected Preview #4. Require trusted operator conversation GET version 2 / available before explicitly sending synthetic messages.'}else{Write-Output 'MANUAL REBUILD REQUIRED: protected Preview #4. Require trusted operator GET 400/inputRejected before any separately authorized POST.'}}
 else{Write-Output 'MANUAL REBUILD REQUIRED: protected Preview #4. Confirm authenticated GET 404/disabled. Configuration cleanup is not runtime shutdown proof.'}
}catch{
 $failure=if($_.Exception.Message -cmatch '^Netlify operation failed: [A-Za-z]+ / (?:HTTP403|HTTP422|unavailable)$' -or $_.Exception.Message -cin @('Variable scopes or non-preview values changed; stop and review.','Production baseline changed; stop and review.')){$_.Exception.Message}else{'Competition configuration validation failed.'}
 $cleanupComplete=$true
 foreach($key in $closed.Keys){try{Set-Preview $key $closed[$key]}catch{$cleanupComplete=$false}}
 try{$checked=Read-Environment 'deploy-preview';foreach($key in $closed.Keys){if($checked.$key -cne $closed[$key]){$cleanupComplete=$false}}}catch{$cleanupComplete=$false}
 Write-Output ('Fail-closed configuration cleanup completed: '+$cleanupComplete)
 Write-Output 'MANUAL REBUILD REQUIRED: Preview #4; verify authenticated 404/disabled. Never retry IBM automatically.'
 throw $failure
}finally{Remove-Variable preview,saved,existing,site,finalSite,productionHash,records,finalRecords,originalConfigurationHash,desired -ErrorAction SilentlyContinue}
