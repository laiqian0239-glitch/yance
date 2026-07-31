[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][string]$CertificatePath,
  [Parameter(Mandatory = $true)][string]$SignToolPath,
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { throw "file to sign is missing: $FilePath" }
if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) { throw "PFX certificate is missing: $CertificatePath" }
if (-not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) { throw "signtool.exe is missing: $SignToolPath" }
if ([IO.Path]::GetExtension($SignToolPath).ToLowerInvariant() -ne '.exe') { throw 'SignToolPath must point to a native .exe' }
if ([string]::IsNullOrWhiteSpace($env:YANCE_WINDOWS_CERTIFICATE_PASSWORD)) { throw 'YANCE_WINDOWS_CERTIFICATE_PASSWORD is required' }

$securePassword = ConvertTo-SecureString $env:YANCE_WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
$imported = $null
$removeAfter = $false
try {
  $pfx = Get-PfxData -FilePath $CertificatePath -Password $securePassword
  $thumbprint = [string]$pfx.EndEntityCertificates[0].Thumbprint
  if ([string]::IsNullOrWhiteSpace($thumbprint)) { throw 'PFX does not contain an end-entity signing certificate' }
  $existing = Get-Item -LiteralPath ("Cert:\CurrentUser\My\{0}" -f $thumbprint) -ErrorAction SilentlyContinue
  if ($null -eq $existing) {
    $imported = Import-PfxCertificate -FilePath $CertificatePath -CertStoreLocation 'Cert:\CurrentUser\My' -Password $securePassword -Exportable:$false
    $removeAfter = $true
  }

  $arguments = @(
    'sign', '/fd', 'SHA256', '/td', 'SHA256', '/tr', $TimestampUrl,
    '/sha1', $thumbprint, '/s', 'My', $FilePath
  )
  & $SignToolPath @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "signtool failed with exit code $LASTEXITCODE" }

  $signature = Get-AuthenticodeSignature -FilePath $FilePath
  if ($null -eq $signature -or $signature.Status -ne 'Valid') {
    $status = if ($null -eq $signature) { 'Missing' } else { [string]$signature.Status }
    throw "Authenticode verification failed: $status"
  }
  [ordered]@{
    status = 'PASS'
    signatureStatus = [string]$signature.Status
    signerSubject = [string]$signature.SignerCertificate.Subject
    signerThumbprint = [string]$signature.SignerCertificate.Thumbprint
    timestampSubject = if ($signature.TimeStamperCertificate) { [string]$signature.TimeStamperCertificate.Subject } else { '' }
    filePath = [IO.Path]::GetFullPath($FilePath)
  } | ConvertTo-Json -Compress
}
finally {
  if ($removeAfter -and $null -ne $imported) {
    foreach ($certificate in @($imported)) {
      $candidate = "Cert:\CurrentUser\My\$($certificate.Thumbprint)"
      if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Force }
    }
  }
}
