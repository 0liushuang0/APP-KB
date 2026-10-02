$ErrorActionPreference = 'Stop'
$src = Get-ChildItem 'd:\New-Project\AI_ML_Project\08AI-Knowledge-Base\docs' -Filter '*.docx' | Where-Object { $_.Name -like '01*' } | Select-Object -First 1
$tmp = 'd:\New-Project\AI_ML_Project\08AI-Knowledge-Base\backend\tmp-docx'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
if (Test-Path "$tmp.zip") { Remove-Item "$tmp.zip" -Force }
Copy-Item $src.FullName "$tmp.zip"
Expand-Archive "$tmp.zip" -DestinationPath $tmp
Write-Output "=== word 目录内容 ==="
Get-ChildItem "$tmp\word" | Select-Object Name

# 提取 XML 中的文本：按段落分组，表格单元格之间用 | 分隔
Add-Type -AssemblyName System.Xml
function Extract-Text($path) {
  if (-not (Test-Path $path)) { return $null }
  [xml]$x = Get-Content $path -Raw -Encoding UTF8
  $ns = New-Object System.Xml.XmlNamespaceManager($x.NameTable)
  $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
  $sb = New-Object System.Text.StringBuilder
  foreach ($p in $x.SelectNodes('//w:p', $ns)) {
    $line = ''
    foreach ($t in $p.SelectNodes('.//w:t', $ns)) { $line += $t.InnerText }
    # 表格单元格边界
    $cells = $p.SelectNodes('.//w:tc', $ns)
    [void]$sb.AppendLine($line)
  }
  return $sb.ToString()
}

Write-Output "`n=== 页眉 ==="
foreach ($h in (Get-ChildItem "$tmp\word" -Filter 'header*.xml' -ErrorAction SilentlyContinue)) {
  Write-Output "--- $($h.Name) ---"
  Write-Output (Extract-Text $h.FullName)
}
Write-Output "`n=== 页脚 ==="
foreach ($f in (Get-ChildItem "$tmp\word" -Filter 'footer*.xml' -ErrorAction SilentlyContinue)) {
  Write-Output "--- $($f.Name) ---"
  Write-Output (Extract-Text $f.FullName)
}
Write-Output "`n=== 正文（段落文本） ==="
$body = Extract-Text "$tmp\word\document.xml"
$body | Out-File 'd:\New-Project\AI_ML_Project\08AI-Knowledge-Base\backend\tmp-docx-body.txt' -Encoding UTF8
Write-Output $body
