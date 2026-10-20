# 효성 전주공장(Q.HUB) 발전량을 국내 PC 에서 수집해 GitHub 에 올린다.
#   Q.HUB(qhub.qcells.com)는 해외 IP 를 차단해 GitHub Actions 에서 받을 수 없으므로, 이 스크립트를 Windows 작업 스케줄러로
#   매시(06~20시) 실행한다. 저장소 작업 폴더와 분리된 별도 클론(_private\qhub-runner)에서 돌아 로컬 작업을 건드리지 않는다.
#
# 준비: 저장소 폴더의 _private\qhub.env 에 두 줄 (이 파일은 .gitignore 로 올라가지 않는다)
#   QHUB_USER_ID=아이디
#   QHUB_PASSWORD=비밀번호
# 실행: powershell -NoProfile -ExecutionPolicy Bypass -File tools\qhub_local.ps1
# 로그: _private\qhub-runner\run.log
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $repoRoot '_private\qhub.env'
$runner = Join-Path $repoRoot '_private\qhub-runner'
$clone = Join-Path $runner 'sr-website'
$log = Join-Path $runner 'run.log'
New-Item -ItemType Directory -Force $runner | Out-Null
function Log($m) { $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m; Add-Content -Path $log -Value $line -Encoding utf8; Write-Host $line }

if (-not (Test-Path $envFile)) { Log "qhub.env 없음: $envFile"; exit 2 }
foreach ($line in Get-Content $envFile -Encoding utf8) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)\s*$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim(), 'Process') }
}
if (-not $env:QHUB_USER_ID -or -not $env:QHUB_PASSWORD) { Log 'qhub.env 에 QHUB_USER_ID / QHUB_PASSWORD 가 없음'; exit 2 }
if ($env:QHUB_USER_ID -like '*여기에*' -or $env:QHUB_PASSWORD -like '*여기에*') { Log 'qhub.env 가 아직 자리표시 값 — 실제 아이디·비밀번호로 바꿔야 함'; exit 2 }

$remote = 'https://github.com/nyahahat1-debug/sr-website.git'
try {
  if (-not (Test-Path (Join-Path $clone '.git'))) { git clone -q --depth 50 $remote $clone 2>&1 | Out-Null; Log '클론 생성' }
  Set-Location $clone
  git fetch -q origin main; git reset -q --hard origin/main
  $py = (Get-Command python -ErrorAction SilentlyContinue).Source; if (-not $py) { $py = (Get-Command py).Source }
  $out = & $py -X utf8 tools\qhub_collect.py --out assets\data\hyosung-generation.json --status-file assets\data\qhub-status.json 2>&1
  Log ("수집기: " + ($out -join ' / '))
  git add assets/data/hyosung-generation.json assets/data/qhub-status.json
  $changed = git diff --cached --quiet; $rc = $LASTEXITCODE
  if ($rc -eq 0) { Log '변경 없음'; exit 0 }
  git -c user.name="qhub-local" -c user.email="qhub-local@users.noreply.github.com" commit -q -m ("효성 발전 현황 갱신 " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + " KST")
  git push -q origin HEAD:main 2>&1 | Out-Null
  Log '푸시 완료'
} catch {
  Log ("오류: " + $_.Exception.Message)
  exit 1
}
