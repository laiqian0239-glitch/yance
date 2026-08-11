param(
  [string]$LabRoot = 'C:\Users\1\Downloads\yance-multibridge-lab',
  [string]$HomeserverUrl = 'http://127.0.0.1:8008',
  [string]$BridgeUrl = 'http://127.0.0.1:29319',
  [string]$ExpectedUserId = '@lab:yance-lab.local',
  [ValidateRange(1, 100)][int]$MessageScanLimit = 20,
  [switch]$LibraryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-YanceJsonRequest {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [object]$Body,
    [string]$AccessToken = ''
  )

  $headers = @{
    Accept = 'application/json'
  }
  if ($AccessToken) {
    $headers.Authorization = 'Bearer ' + $AccessToken
  }
  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $headers
    ErrorAction = 'Stop'
  }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
  }
  return Invoke-RestMethod @params
}

function Get-YanceRoomState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$HomeserverUrl,
    [Parameter(Mandatory = $true)][string]$RoomId,
    [Parameter(Mandatory = $true)][string]$AccessToken
  )
  $room = [Uri]::EscapeDataString($RoomId)
  $uri = $HomeserverUrl.TrimEnd('/') + '/_matrix/client/v3/rooms/' + $room + '/state'
  return @(Invoke-YanceJsonRequest -Method GET -Uri $uri -AccessToken $AccessToken)
}

function Get-YanceRoomMessages {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$HomeserverUrl,
    [Parameter(Mandatory = $true)][string]$RoomId,
    [Parameter(Mandatory = $true)][string]$AccessToken,
    [Parameter(Mandatory = $true)][int]$Limit
  )
  $room = [Uri]::EscapeDataString($RoomId)
  $uri = $HomeserverUrl.TrimEnd('/') + '/_matrix/client/v3/rooms/' + $room + '/messages?dir=b&limit=' + $Limit
  return Invoke-YanceJsonRequest -Method GET -Uri $uri -AccessToken $AccessToken
}

if ($LibraryOnly) { return }

function Write-RealRed {
  param([Parameter(Mandatory = $true)][string]$Reason)
  Write-Host ('REAL_RED: ' + $Reason)
  Write-Host 'FINAL STATUS: REAL_RED'
}

$accessToken = ''
$logoutRequired = $false
$acceptanceGreen = $false
$finalError = $null
try {
  if (-not (Test-Path -LiteralPath $LabRoot -PathType Container)) {
    throw 'REAL_RED: existing Windows Lab root is missing.'
  }
  $resolvedLabRoot = (Resolve-Path -LiteralPath $LabRoot).Path
  $passwordPath = Join-Path $resolvedLabRoot '.runtime\synapse\lab-password.txt'
  if (-not (Test-Path -LiteralPath $passwordPath -PathType Leaf)) {
    throw 'REAL_RED: local Matrix Lab password file is missing.'
  }
  $password = [IO.File]::ReadAllText($passwordPath).Trim()
  if (-not $password) {
    throw 'REAL_RED: local Matrix Lab password file is empty.'
  }

  $loginUri = $HomeserverUrl.TrimEnd('/') + '/_matrix/client/v3/login'
  $loginBody = [ordered]@{
    type = 'm.login.password'
    identifier = [ordered]@{
      type = 'm.id.user'
      user = $ExpectedUserId
    }
    password = $password
  }
  $login = Invoke-YanceJsonRequest -Method POST -Uri $loginUri -Body $loginBody
  $accessToken = [string]$login.access_token
  if (-not $accessToken) {
    throw 'REAL_RED: Matrix password login did not return an access token.'
  }
  $logoutRequired = $true
  if ([string]$login.user_id -ne $ExpectedUserId) {
    throw 'REAL_RED: Matrix password login resolved an unexpected user identity.'
  }

  $whoamiUri = $HomeserverUrl.TrimEnd('/') + '/_matrix/client/v3/account/whoami'
  $matrixWhoami = Invoke-YanceJsonRequest -Method GET -Uri $whoamiUri -AccessToken $accessToken
  if ([string]$matrixWhoami.user_id -ne $ExpectedUserId) {
    throw 'REAL_RED: Matrix whoami does not match the frozen local Lab account.'
  }
  Write-Host ('MATRIX_LOCAL_LOGIN_GREEN user_id=' + $ExpectedUserId)

  $provisionUri = $BridgeUrl.TrimEnd('/') + '/_matrix/provision/v3/whoami?user_id=' + [Uri]::EscapeDataString($ExpectedUserId)
  $provision = Invoke-YanceJsonRequest -Method GET -Uri $provisionUri -AccessToken $accessToken
  $logins = @($provision.logins)
  if ($logins.Count -ne 1) {
    throw ('REAL_RED: Facebook Personal provisioning identity is ambiguous; expected exactly one login, got ' + $logins.Count + '.')
  }
  $facebookLogin = $logins[0]
  if ([string]$facebookLogin.state.state_event -ne 'CONNECTED') {
    throw ('REAL_RED: Facebook Personal provisioning login is not CONNECTED; state=' + [string]$facebookLogin.state.state_event + '.')
  }
  $spaceRoom = [string]$facebookLogin.space_room
  if (-not $spaceRoom) {
    throw 'REAL_RED: connected Facebook Personal provisioning login has no Matrix space_room.'
  }
  Write-Host 'FACEBOOK_PROVISIONING_CONNECTED_GREEN login_count=1'

  $spaceState = @(Get-YanceRoomState -HomeserverUrl $HomeserverUrl -RoomId $spaceRoom -AccessToken $accessToken)
  $createEvents = @($spaceState | Where-Object { [string]$_.type -eq 'm.room.create' -and [string]$_.state_key -eq '' })
  if ($createEvents.Count -ne 1 -or [string]$createEvents[0].content.type -ne 'm.space') {
    throw 'REAL_RED: Facebook Personal space_room is not a Matrix m.space room.'
  }
  $childEvents = @($spaceState | Where-Object {
    [string]$_.type -eq 'm.space.child' -and [string]$_.state_key
  })
  if ($childEvents.Count -lt 1) {
    throw 'REAL_RED: connected Facebook Personal Matrix space has no child rooms; initial history is not observable.'
  }
  Write-Host ('FACEBOOK_MATRIX_SPACE_GREEN child_rooms=' + $childEvents.Count)

  $roomsWithMessages = 0
  $messageEvents = 0
  foreach ($child in @($childEvents | Select-Object -First 12)) {
    $childRoomId = [string]$child.state_key
    if (-not $childRoomId) { continue }
    $messages = Get-YanceRoomMessages -HomeserverUrl $HomeserverUrl -RoomId $childRoomId -AccessToken $accessToken -Limit $MessageScanLimit
    $roomMessageEvents = @($messages.chunk | Where-Object { [string]$_.type -eq 'm.room.message' })
    if ($roomMessageEvents.Count -gt 0) {
      $roomsWithMessages++
      $messageEvents += $roomMessageEvents.Count
    }
  }
  if ($messageEvents -lt 1) {
    throw 'REAL_RED: no initial Matrix message history was observed in the Facebook Personal child rooms.'
  }
  Write-Host ('FACEBOOK_MATRIX_HISTORY_GREEN rooms_with_messages=' + $roomsWithMessages + ' message_events=' + $messageEvents)
  $acceptanceGreen = $true
}
catch {
  $finalError = $_.Exception
}
finally {
  if ($logoutRequired -and $accessToken) {
    try {
      $logoutUri = $HomeserverUrl.TrimEnd('/') + '/_matrix/client/v3/logout'
      [void](Invoke-YanceJsonRequest -Method POST -Uri $logoutUri -Body @{} -AccessToken $accessToken)
      Write-Host 'MATRIX_EPHEMERAL_LOGOUT_GREEN'
    }
    catch {
      $acceptanceGreen = $false
      $finalError = New-Object System.Exception('REAL_RED: temporary Matrix acceptance token could not be invalidated.')
    }
  }
}

if ($acceptanceGreen -and $null -eq $finalError) {
  Write-Host 'FINAL STATUS: FACEBOOK_PERSONAL_MATRIX_ACCEPTANCE_GREEN'
  exit 0
}

$message = if ($null -ne $finalError) { [string]$finalError.Message } else { 'REAL_RED: Facebook Personal Matrix acceptance did not complete.' }
if ($message.StartsWith('REAL_RED:')) {
  Write-Host $message
  Write-Host 'FINAL STATUS: REAL_RED'
}
else {
  Write-RealRed -Reason 'Facebook Personal Matrix acceptance gate failed unexpectedly.'
}
exit 1
