param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("codex-project", "claude-project", "claude-user")]
  [string]$Mode,

  [string]$Root = "."
)

$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path

switch ($Mode) {
  "codex-project" {
    $Target = Join-Path $Root ".agents/skills/ui-design-discipline"
  }
  "claude-project" {
    $Target = Join-Path $Root ".claude/skills/ui-design-discipline"
  }
  "claude-user" {
    $Target = Join-Path $HOME ".claude/skills/ui-design-discipline"
  }
}

$Parent = Split-Path -Parent $Target
New-Item -ItemType Directory -Force -Path $Parent | Out-Null
if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
Copy-Item -Recurse -Path $SourceDir -Destination $Target
Write-Output "Installed to $Target"
