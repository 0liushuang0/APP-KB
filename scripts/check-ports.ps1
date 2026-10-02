$conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 5173, 5174, 3000, 3001, 8080, 80 }
foreach ($c in $conns) {
  $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  Write-Host ("{0}:{1}  PID={2}  {3}" -f $c.LocalAddress, $c.LocalPort, $c.OwningProcess, $proc.ProcessName)
}
if (-not $conns) { Write-Host 'no listeners found' }
