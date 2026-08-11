Set-StrictMode -Version Latest

function Get-LabR12DatabaseWiring {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Service
  )

  switch -Exact ($Service) {
    'facebook-personal' { $databaseName = 'facebook-personal.db' }
    'instagram-dm' { $databaseName = 'instagram-dm.db' }
    'google-messages' { $databaseName = 'google-messages.db' }
    'signal' { $databaseName = 'signal.db' }
    'line' { $databaseName = 'line.db' }
    default { return $null }
  }

  return [pscustomobject]@{
    Type = 'sqlite3-fk-wal'
    Uri = "file:/data/$databaseName`?_txlock=immediate"
    YqExpression = '.database.type=strenv(YANCE_DATABASE_TYPE)|.database.uri=strenv(YANCE_DATABASE_URI)'
  }
}
