# Resize iPhone screenshots to Apple App Store screenshot slots.
#
# Produces BOTH common iPhone sizes into subfolders so you can upload to
# whichever slot App Store Connect shows:
#   6.9\  -> 1320 x 2868  (6.9" iPhone 16 Pro Max slot)
#   6.5\  -> 1284 x 2778  (6.5"/6.7" Pro Max slot; also accepts 1242x2688)
#
# Usage:
#   1. Put your raw iPhone 17 Pro screenshots (PNG) in a folder, e.g.
#        C:\Users\brand\Desktop\qwalla-shots
#   2. Run:
#        powershell -ExecutionPolicy Bypass -File scripts\resize-screenshots.ps1 -InputDir "C:\Users\brand\Desktop\qwalla-shots"
#   3. Upload the set from the subfolder matching the slot ASC asks for.
#
# The 17 Pro (1206x2622) is a near-identical aspect ratio to both targets, so a
# straight high-quality scale looks clean with no visible distortion or cropping.

param(
  [Parameter(Mandatory = $true)]
  [string]$InputDir
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $InputDir)) {
  Write-Error "Input folder not found: $InputDir"
  exit 1
}

# Target slots: label -> width x height
$targets = @(
  @{ Label = '6.9'; W = 1320; H = 2868 },
  @{ Label = '6.5'; W = 1284; H = 2778 }
)

$files = Get-ChildItem -Path $InputDir -File | Where-Object { $_.Extension -match '^\.(png|jpg|jpeg)$' }
if ($files.Count -eq 0) {
  Write-Warning "No PNG/JPG files found in $InputDir"
  exit 0
}

foreach ($t in $targets) {
  $outDir = Join-Path $InputDir $t.Label
  if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

  foreach ($f in $files) {
    $src = [System.Drawing.Image]::FromFile($f.FullName)
    # 24bpp RGB = no alpha channel (App Store rejects screenshots with transparency)
    $bmp = New-Object System.Drawing.Bitmap([int]$t.W, [int]$t.H, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Black)
    $g.DrawImage($src, 0, 0, [int]$t.W, [int]$t.H)
    $outPath = Join-Path $outDir ("{0}_{1}.png" -f [System.IO.Path]::GetFileNameWithoutExtension($f.Name), $t.Label)
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $src.Dispose()
  }
  Write-Output ("{0} file(s) -> {1} ({2}x{3})" -f $files.Count, $outDir, $t.W, $t.H)
}

Write-Output "Done. Upload the set from the subfolder matching the slot App Store Connect asks for."
