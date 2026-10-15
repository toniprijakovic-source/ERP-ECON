@echo off
rem ECON ERP - instalacija pomocnika za otvaranje mapa projekata i atesta materijala s diska Z: iz aplikacije.
rem Pokrece se jednom po racunalu (i ponovno kad aplikacija ponudi novu verziju). Upisuje samo za trenutnog
rem korisnika (HKEY_CURRENT_USER), ne treba administratora. Zamjenjuje stariji econ-mapa-instalacija.reg.
set "ECON_INST=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:ECON_INST,[Text.Encoding]::UTF8); $a=$t.IndexOf('#'+'#INSTALACIJA'); $b=$t.IndexOf('#'+'#POMOCNIK'); Invoke-Expression $t.Substring($a, $b-$a)"
pause
exit /b

##INSTALACIJA
$ErrorActionPreference = 'Stop'
try {
  $cilj = Join-Path $env:LOCALAPPDATA 'EconERP'
  New-Item -ItemType Directory -Force -Path $cilj | Out-Null
  $skripta = Join-Path $cilj 'econ-pomocnik.ps1'
  [IO.File]::WriteAllText($skripta, $t.Substring($t.IndexOf('#' + '#POMOCNIK')), (New-Object System.Text.UTF8Encoding $true))
  # Poveznica se skripti predaje kao argument (-File), nikad kao naredba, pa iz nje se ne moze nista pokrenuti.
  $naredba = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $skripta + '" "%1"'
  foreach ($p in @('econ-mapa', 'econ-projekt', 'econ-atest', 'econ-atesti')) {
    $k = 'HKCU:\Software\Classes\' + $p
    New-Item -Path ($k + '\shell\open\command') -Force | Out-Null
    Set-Item -Path $k -Value ('URL:ECON ERP ' + $p)
    New-ItemProperty -Path $k -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    Set-Item -Path ($k + '\shell\open\command') -Value $naredba
  }
  Write-Host ''
  Write-Host 'ECON ERP pomocnik je instaliran.'
  Write-Host 'U aplikaciji sada rade: Otvori mapu, klik na sifru projekta (mapa projekta), klik na broj atesta (PDF)'
  Write-Host 'i ZIP atesta ugradenog materijala.'
  Write-Host 'Kod prvog klika preglednik pita smije li otvoriti poveznicu - oznaci "Uvijek dopusti" i potvrdi.'
  Write-Host ''
} catch {
  Write-Host ''
  Write-Host ('Instalacija nije uspjela: ' + $_.Exception.Message)
  Write-Host ''
}

##POMOCNIK
# ECON ERP - pomocnik na racunalu: otvara mape projekata i PDF ateste materijala s mreznog diska Z: i slaze ZIP
# atesta ugradenog materijala projekta. Pokrece ga preglednik preko poveznica econ-mapa:, econ-atest: i econ-atesti:
# (registrira ih econ-pomocnik-instalacija.cmd). Sve sto stigne u poveznici se provjerava: otvaraju se samo postojece
# mape pod Z:\ECON_2026 i PDF-ovi iz mapa atesta, a brojevi atesta smiju imati samo slova, brojke, - i _.
param([string]$Poveznica = '', [switch]$Proba)

# Mape s atestima, redom prednosti: nova (po maticnom broju: 3706.pdf, dodatne stranice 3706.1.pdf), pa stara (1719-1.pdf).
$KorijenMapa = 'Z:\ECON_2026'
# Mape projekata: ime pocinje sifrom projekta, npr. "RN 01-33_Regal za limove" (i "..._ZAVRŠEN").
$MapaProjekata = 'Z:\ECON_2026\ECON_2026\Econ_2026_Projekti'
$MapeAtesta = @(
  'Z:\ECON_2026\ECON_2026\Econ_2026_Kontrola kvalitete\Atesti materijala ERP',
  'Z:\ECON_2026\ECON_2026\Econ_2026_Kontrola kvalitete\Atesti materijala'
)
$DozvoljenaOznaka = '^[A-Za-z0-9_-]{1,40}$'

function Poruka([string]$tekst) {
  if ($Proba) { Write-Output ('PORUKA: ' + $tekst); return }
  Add-Type -AssemblyName System.Windows.Forms
  $vlasnik = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
  [void][System.Windows.Forms.MessageBox]::Show($vlasnik, $tekst, 'ECON ERP')
  $vlasnik.Dispose()
}
function Otvori([string]$putanja) {
  if ($Proba) { Write-Output ('OTVORI: ' + $putanja); return }
  Invoke-Item -LiteralPath $putanja
}
# Svi PDF-ovi iz mapa atesta - po jedan popis za svaku dostupnu mapu.
function PopisAtesta {
  $r = @()
  foreach ($m in $MapeAtesta) {
    if (Test-Path -LiteralPath $m -PathType Container) { $r += , @(Get-ChildItem -LiteralPath $m -File -Filter '*.pdf' -ErrorAction SilentlyContinue) }
  }
  return , $r
}
# Datoteke atesta za oznaku (maticni broj ili broj atesta): <oznaka>.pdf, <oznaka>.1.pdf, <oznaka>-1.pdf ... iz prve mape koja ih ima.
function DatotekeAtesta([string]$oznaka, $popisi) {
  $uzorak = '^' + [regex]::Escape($oznaka) + '([.-]\d+)?\.pdf$'
  foreach ($popis in $popisi) {
    $nadeno = @($popis | Where-Object { $_.Name -match $uzorak } | Sort-Object Name)
    if ($nadeno.Count -gt 0) { return , $nadeno }
  }
  return , @()
}
function Oznake([string]$tekst, [string]$razdjelnik) {
  $r = @()
  foreach ($o in ($tekst -split $razdjelnik)) { $o = $o.Trim(); if ($o -match $DozvoljenaOznaka -and $r -notcontains $o) { $r += $o } }
  return , $r
}

$u = $Poveznica.Trim().TrimEnd('/')

if ($u -match '^econ-mapa:(.+)$') {
  $p = [uri]::UnescapeDataString($Matches[1]).TrimEnd('/')
  if ($p -like ($KorijenMapa + '*') -and $p -notmatch '\.\.') {
    if (Test-Path -LiteralPath $p -PathType Container) { Otvori $p }
    else { Poruka ("Mapa nije pronađena (je li spojen disk Z:?):`n" + $p) }
  }
}
elseif ($u -match '^econ-projekt:(.+)$') {
  $sifra = [uri]::UnescapeDataString($Matches[1]).Trim()
  if ($sifra -notmatch '^[\p{L}\p{Nd} ._-]{1,40}$') { exit }
  if (-not (Test-Path -LiteralPath $MapaProjekata -PathType Container)) { Poruka ("Mapa projekata nije dostupna (je li spojen disk Z:?):`n" + $MapaProjekata); exit }
  # Ime mape je sifra ili sifra pa "_" / razmak (RN 170-28 ne smije pogoditi RN 170-282_...); od vise mapa otvara se zadnja mijenjana.
  $mape = @(Get-ChildItem -LiteralPath $MapaProjekata -Directory -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq $sifra -or $_.Name.StartsWith($sifra + '_', [StringComparison]::OrdinalIgnoreCase) -or $_.Name.StartsWith($sifra + ' ', [StringComparison]::OrdinalIgnoreCase)
  } | Sort-Object LastWriteTime -Descending)
  if ($mape.Count -gt 0) { Otvori $mape[0].FullName }
  else { Poruka ("Mapa projekta " + $sifra + " nije pronađena u`n" + $MapaProjekata + "`n`nIme mape mora počinjati šifrom projekta, npr. " + $sifra + "_Naziv.") }
}
elseif ($u -match '^econ-atest:(.+)$') {
  $oznake = Oznake ([uri]::UnescapeDataString($Matches[1])) ','
  if ($oznake.Count -eq 0) { exit }
  $popisi = PopisAtesta
  if ($popisi.Count -eq 0) { Poruka ("Mapa atesta nije dostupna (je li spojen disk Z:?):`n" + $MapeAtesta[0]); exit }
  foreach ($o in $oznake) {
    $d = DatotekeAtesta $o $popisi
    if ($d.Count -gt 0) { foreach ($f in $d) { Otvori $f.FullName }; exit }
  }
  Poruka ("Atest nije pronađen: " + ($oznake -join ', ') + "`n`nPDF atesta spremi u mapu`n" + $MapeAtesta[0] + "`npod imenom matičnog broja, npr. " + $oznake[-1] + ".pdf (dodatne stranice " + $oznake[-1] + ".1.pdf).")
}
elseif ($u -match '^econ-atesti:([^/]*)/(.+)$') {
  $nazivDio = $Matches[1]; $popisDio = $Matches[2]
  $naziv = ([uri]::UnescapeDataString($nazivDio) -replace '[^\p{L}\p{Nd} ._-]', '_').Trim(' ', '.')
  if (-not $naziv) { $naziv = 'projekt' }
  if ($naziv.Length -gt 60) { $naziv = $naziv.Substring(0, 60) }
  # Skupine po maticnom broju: "3740~3714" = maticni broj 3740 s atestom spremljenim pod 3714.
  $skupine = @()
  foreach ($dio in ([uri]::UnescapeDataString($popisDio) -split ',')) {
    $o = Oznake $dio '~'
    if ($o.Count -gt 0) { $skupine += , $o }
  }
  if ($skupine.Count -eq 0) { exit }
  $popisi = PopisAtesta
  if ($popisi.Count -eq 0) { Poruka ("Mapa atesta nije dostupna (je li spojen disk Z:?):`n" + $MapeAtesta[0]); exit }
  $datoteke = @{}
  $nedostaju = @()
  foreach ($s in $skupine) {
    $ima = $false
    foreach ($o in $s) { foreach ($f in (DatotekeAtesta $o $popisi)) { $datoteke[$f.Name] = $f.FullName; $ima = $true } }
    if (-not $ima) { $nedostaju += $s[0] }
  }
  if ($datoteke.Count -eq 0) { Poruka ("Za ovaj projekt nije pronađen nijedan atest u mapama:`n" + ($MapeAtesta -join "`n")); exit }
  if ($Proba) { $izlaz = Join-Path $env:TEMP 'econ-proba' }
  else {
    $izlaz = $null
    try { $izlaz = (New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path } catch { }
    if (-not $izlaz) { $izlaz = Join-Path $env:USERPROFILE 'Downloads' }
  }
  New-Item -ItemType Directory -Force -Path $izlaz | Out-Null
  $zip = Join-Path $izlaz ('Ugrađeni materijal - atesti ' + $naziv + '.zip')
  $privremena = Join-Path $env:TEMP ('econ-atesti-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $privremena | Out-Null
  try {
    foreach ($k in $datoteke.Keys) { Copy-Item -LiteralPath $datoteke[$k] -Destination (Join-Path $privremena $k) }
    if ($nedostaju.Count -gt 0) {
      $tekst = "Za ove matične brojeve atest nije pronađen u mapama atesta:`r`n" + ($nedostaju -join "`r`n")
      [IO.File]::WriteAllText((Join-Path $privremena 'NEDOSTAJU ATESTI.txt'), $tekst, (New-Object System.Text.UTF8Encoding $true))
    }
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    Compress-Archive -Path (Join-Path $privremena '*') -DestinationPath $zip
  } finally {
    Remove-Item -LiteralPath $privremena -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($Proba) { Write-Output ('ZIP: ' + $zip) } else { Start-Process explorer.exe -ArgumentList ('/select,"' + $zip + '"') }
  if ($nedostaju.Count -gt 0) { Poruka ("ZIP je spremljen:`n" + $zip + "`n`nNema atesta za matične brojeve: " + ($nedostaju -join ', ')) }
}
