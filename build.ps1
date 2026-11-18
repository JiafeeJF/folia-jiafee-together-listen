$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'mod.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$output = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$packageItems = @(
  'mod.json', 'index.cjs', 'client.mjs', 'overlay-ui.mjs', 'styles.mjs',
  'accountSync.mjs', 'playback-core.mjs', 'playbackSession.mjs',
  'foliumPlayerAdapter.mjs', 'queue-sync.mjs', 'vendorPlaybackCore.mjs', 'track-selection-gate.mjs',
  'lib', 'vendor', 'preview.jpg', 'LICENSE', 'README.md'
)
$files = $packageItems | ForEach-Object { Join-Path $PSScriptRoot $_ }
foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath $file)) { throw "Missing package item: $file" }
}
$archive = Join-Path $output "jiafee-together-listen-$($manifest.version).zip"
Compress-Archive -LiteralPath $files -DestinationPath $archive -Force
$stream = [IO.File]::OpenRead($archive)
try {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
  finally { $hasher.Dispose() }
} finally { $stream.Dispose() }
[pscustomobject]@{ Algorithm = 'SHA256'; Hash = $hash; Path = $archive }
