# 检查 dsh-turn-report 的安装是否为 junction（改源码即时生效）
#
# 背景：用 `dsh plugin add file:<dir>` 安装时，pnpm 可能把源码目录【拷贝】进
# profile，而不是建立链接。拷贝一旦发生，之后所有源码改动都不会生效，
# 表现为「改了代码、重启了、界面没变」，而且单测照常通过，极难排查。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-install.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-install.ps1 -Fix
#
# 兼容 Windows PowerShell 5.1（不使用三元、语句赋值、PS7 专有语法）。

param([switch]$Fix)

$ErrorActionPreference = 'Stop'

$srcDir = 'D:\Agent\Agent Workspace\DSH\projects\dev\dsh-turn-report'
$dshHome = $env:DSH_HOME
if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome 'profiles\desktop'
$installDir = Join-Path $profileDir 'node_modules\@nethiel\dsh-turn-report'

if (-not (Test-Path $installDir)) {
    Write-Host "未安装：$installDir" -ForegroundColor Yellow
    Write-Host ('安装命令：dsh plugin --profile desktop add file:"' + $srcDir + '"')
    exit 1
}

$installed = Get-Item $installDir -Force
$isLink = $null -ne $installed.LinkType

if ($isLink) {
    Write-Host ('OK   安装是 ' + $installed.LinkType + '，指向 ' + $installed.Target) -ForegroundColor Green
} else {
    Write-Host 'FAIL 安装是实目录（拷贝），源码改动不会生效' -ForegroundColor Red
    foreach ($name in @('index.js', 'client.js')) {
        $instFile = Join-Path $installDir $name
        $srcFile = Join-Path $srcDir $name
        if ((Test-Path $instFile) -and (Test-Path $srcFile)) {
            $hashInst = (Get-FileHash $instFile -Algorithm SHA256).Hash.Substring(0, 12)
            $hashSrc = (Get-FileHash $srcFile -Algorithm SHA256).Hash.Substring(0, 12)
            if ($hashInst -eq $hashSrc) {
                Write-Host ('     ' + $name + ' : 一致')
            } else {
                Write-Host ('     ' + $name + ' : 不一致（安装目录落后）')
            }
        }
    }

    if (-not $Fix) {
        Write-Host ''
        Write-Host '修复：加 -Fix 参数重跑' -ForegroundColor Yellow
        exit 2
    }

    # 备份后删除实目录，改建成 junction
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupDir = 'D:\Agent\Agent Workspace\DSH\artifacts\backups\turn-report-copy-' + $stamp
    Copy-Item $installDir $backupDir -Recurse -Force
    Write-Host ('已备份：' + $backupDir)
    Remove-Item $installDir -Recurse -Force
    $mk = 'mklink /J "' + $installDir + '" "' + $srcDir + '"'
    & cmd /c $mk | Out-Null

    $installed = Get-Item $installDir -Force
    if ($null -ne $installed.LinkType) {
        Write-Host ('已修复：junction -> ' + $installed.Target) -ForegroundColor Green
    } else {
        Write-Host '修复失败，请手动执行：' -ForegroundColor Red
        Write-Host ('  rmdir "' + $installDir + '"')
        Write-Host ('  ' + $mk)
        exit 3
    }
}

# 顺带校验四处名字是否一致（不一致会导致 client bundle 加载失败）
$pkgJson = Get-Content -Raw (Join-Path $installDir 'package.json') | ConvertFrom-Json
$pkgName = $pkgJson.name

$bundleMatch = Select-String -Path (Join-Path $installDir 'client.js') -Pattern "^  id: '([^']+)'" |
    Select-Object -First 1
$bundleId = $bundleMatch.Matches[0].Groups[1].Value

$patchMatch = Select-String -Path (Join-Path $installDir 'cordis.patch.yml') -Pattern "      name: '([^']+)'" |
    Select-Object -First 1
$patchName = $patchMatch.Matches[0].Groups[1].Value

$profilePkg = Get-Content -Raw (Join-Path $profileDir 'package.json') | ConvertFrom-Json
$depName = ''
foreach ($prop in $profilePkg.dependencies.PSObject.Properties) {
    if ($prop.Name -like '*turn-report*') { $depName = $prop.Name }
}

Write-Host ''
Write-Host '名字一致性：'
Write-Host ('  package.json name : ' + $pkgName)
Write-Host ('  bundle id         : ' + $bundleId)
Write-Host ('  patch 行 name     : ' + $patchName)
Write-Host ('  profile 依赖名    : ' + $depName)

if ($pkgName -eq $bundleId -and $bundleId -eq $patchName -and $patchName -eq $depName) {
    Write-Host '  OK   四处一致' -ForegroundColor Green
    exit 0
} else {
    Write-Host '  FAIL 不一致，client bundle 会加载失败' -ForegroundColor Red
    exit 4
}