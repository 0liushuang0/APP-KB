$conns = Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue
if ($conns) {
    $procIds = $conns.OwningProcess | Select-Object -Unique
    foreach ($targetPid in $procIds) {
        Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
        Write-Host ("Stopped PID " + $targetPid)
    }
} else {
    Write-Host 'No listener on 3001'
}
Start-Sleep -Seconds 2
$left = Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue
if ($left) { Write-Host 'Port 3001 still in use' } else { Write-Host 'Port 3001 is free' }
