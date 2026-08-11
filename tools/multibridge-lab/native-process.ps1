Set-StrictMode -Version Latest

function ConvertTo-LabNativeArgument {
  [CmdletBinding()]
  param([AllowEmptyString()][string]$Value)

  if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }

  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') {
      $slashes += 1
      continue
    }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * (($slashes * 2) + 1)))
      [void]$builder.Append('"')
      $slashes = 0
      continue
    }
    if ($slashes -gt 0) {
      [void]$builder.Append(('\' * $slashes))
      $slashes = 0
    }
    [void]$builder.Append($character)
  }
  if ($slashes -gt 0) { [void]$builder.Append(('\' * ($slashes * 2))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Invoke-LabNativeProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = ''
  )

  $resolvedFile = [IO.Path]::GetFullPath($FilePath)
  if (-not (Test-Path -LiteralPath $resolvedFile -PathType Leaf)) {
    throw "Native executable does not exist: $resolvedFile"
  }

  $isCmd = [IO.Path]::GetExtension($resolvedFile).Equals('.cmd', [StringComparison]::OrdinalIgnoreCase)
  $processInfo = New-Object System.Diagnostics.ProcessStartInfo

  if ($isCmd) {
    foreach ($argument in $Arguments) {
      if ([string]$argument -match '[&|<>^\r\n]') {
        throw 'Unsafe CMD argument rejected.'
      }
    }
    $processInfo.FileName = $env:ComSpec
    $inner = '"' + $resolvedFile + '"'
    if ($Arguments.Count -gt 0) {
      $inner += ' ' + (($Arguments | ForEach-Object { ConvertTo-LabNativeArgument ([string]$_) }) -join ' ')
    }
    $processInfo.Arguments = '/d /s /c "' + $inner + '"'
  } else {
    $processInfo.FileName = $resolvedFile
    $processInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-LabNativeArgument ([string]$_) }) -join ' ')
  }

  if ($WorkingDirectory) {
    $processInfo.WorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)
  }
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $processInfo
  $stdout = ''
  $stderr = ''
  $exitCode = $null

  try {
    if (-not $process.Start()) {
      throw "Native executable failed to start: $resolvedFile"
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $process.ExitCode
  } finally {
    $process.Dispose()
  }

  return [pscustomobject]@{
    ExitCode = [int]$exitCode
    StdOut = [string]$stdout
    StdErr = [string]$stderr
    FilePath = $resolvedFile
  }
}
