# KnowPilot Cloudflare Tunnel 启动脚本
# 用法:
#   .\scripts\tunnel.ps1 quick          # 临时 *.trycloudflare.com 链接
#   .\scripts\tunnel.ps1 run            # 使用 .env 中的 CLOUDFLARE_TUNNEL_TOKEN
#   .\scripts\tunnel.ps1 run -Config cloudflare\config.yml

param(
  [Parameter(Position = 0)]
  [ValidateSet("quick", "run")]
  [string]$Mode = "quick",

  [string]$Config = "cloudflare\config.yml",
  [string]$Origin = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Find-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $wingetPath = "$env:ProgramFiles\cloudflared\cloudflared.exe"
  if (Test-Path $wingetPath) { return $wingetPath }

  $local = Join-Path $root "cloudflare\cloudflared.exe"
  if (Test-Path $local) { return $local }

  throw "未找到 cloudflared。请运行: winget install Cloudflare.cloudflared"
}

function Load-DotEnv {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return @{} }
  $map = @{}
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -le 0) { return }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    $map[$k] = $v
  }
  return $map
}

$cf = Find-Cloudflared
Write-Host "cloudflared: $cf" -ForegroundColor Cyan

if ($Mode -eq "quick") {
  Write-Host ""
  Write-Host "启动临时隧道 -> $Origin" -ForegroundColor Green
  Write-Host "请确保已运行: pnpm dev  或  pnpm dev:remote" -ForegroundColor Yellow
  Write-Host "成功后终端会显示 https://xxxx.trycloudflare.com 公网地址" -ForegroundColor Yellow
  Write-Host ""
  & $cf tunnel --url $Origin
  exit $LASTEXITCODE
}

$envMap = Load-DotEnv (Join-Path $root ".env")
$token = $envMap["CLOUDFLARE_TUNNEL_TOKEN"]
if (-not $token) { $token = $env:CLOUDFLARE_TUNNEL_TOKEN }

if ($token) {
  Write-Host "使用 CLOUDFLARE_TUNNEL_TOKEN 启动命名隧道..." -ForegroundColor Green
  & $cf tunnel run --token $token
  exit $LASTEXITCODE
}

$configPath = Join-Path $root $Config
if (Test-Path $configPath) {
  Write-Host "使用配置文件: $configPath" -ForegroundColor Green
  & $cf tunnel --config $configPath run
  exit $LASTEXITCODE
}

Write-Host "错误: 未设置 CLOUDFLARE_TUNNEL_TOKEN，且找不到 $Config" -ForegroundColor Red
Write-Host "可选方案:" -ForegroundColor Yellow
Write-Host "  1. pnpm tunnel:quick  （临时公网链接）"
Write-Host "  2. 在 Cloudflare Zero Trust 创建 Tunnel，把 Token 写入 .env"
Write-Host "  3. 复制 cloudflare/config.example.yml -> cloudflare/config.yml 并配置 ingress"
exit 1
