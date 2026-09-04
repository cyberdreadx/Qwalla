# Compose Qwalla App Store screenshots: dark gradient background, teal accent bar,
# headline + subtitle, and the raw screenshot in a rounded-top frame with a glow.
# Outputs 24bpp PNGs (no alpha — App Store requirement) at 6.5" and 6.9" sizes.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\frame-screenshots.ps1 -SrcDir "C:\Users\brand\Downloads\Images\screensQwalla"

param(
  [string]$SrcDir = "C:\Users\brand\Downloads\Images\screensQwalla"
)

Add-Type -AssemblyName System.Drawing

# Qwalla brand
$BG      = [System.Drawing.Color]::FromArgb(255, 10, 12, 16)   # #0A0C10
$ACCENT  = [System.Drawing.Color]::FromArgb(255, 31, 224, 197) # #1FE0C5
$WHITE   = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$MUTED   = [System.Drawing.Color]::FromArgb(160, 255, 255, 255)
$FRAMEBG = [System.Drawing.Color]::FromArgb(255, 13, 17, 23)

# order = App Store order (first shows first). headline / subtitle per screen.
$items = @(
  @{ f='IMG_0084.jpg';                      h='Your quantum-safe wallet'; s='XRGE, secured with ML-DSA-65 signatures.' },
  @{ f='IMG_0080.jpg';                      h='Keys never leave your device'; s='ML-KEM-768 + AES-256-GCM, Face ID unlock.' },
  @{ f='signal-2026-08-27-181722-6.png';    h='Send in seconds'; s='Every transfer signed post-quantum.' },
  @{ f='IMG_0085.jpg';                      h='Messages that self-destruct'; s='End-to-end encrypted with ML-KEM-768.' },
  @{ f='signal-2026-08-27-181722-2.png';    h='Encrypted on-chain mail'; s='Private mail, sealed with ML-KEM.' },
  @{ f='signal-2026-08-27-181722-3.png';    h='dApps, built in'; s='Connect to RougeChain apps from your wallet.' },
  @{ f='signal-2026-08-27-181722-5.png';    h='True self-custody'; s='Biometric lock and your recovery phrase.' },
  @{ f='signal-2026-08-27-181722.png';      h='Private messaging'; s='Post-quantum encrypted chats, built in.' },
  @{ f='signal-2026-08-27-181722-1.png';    h='Your encrypted inbox'; s='On-chain mail only you can read.' },
  @{ f='signal-2026-08-27-181722-4.png';    h='Own your network'; s='Switch between Mainnet and Testnet.' }
)

$sizes = @(
  @{ label='6.5'; w=1284; h=2778 },
  @{ label='6.9'; w=1320; h=2868 }
)

function New-RoundTopPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)            # top-left
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)  # top-right
  $p.AddLine($x + $w, $y + $r, $x + $w, $y + $h)
  $p.AddLine($x + $w, $y + $h, $x, $y + $h)
  $p.CloseFigure()
  return $p
}

function Draw-Centered([System.Drawing.Graphics]$g, [string]$text, [System.Drawing.Font]$font, [System.Drawing.Brush]$brush, [single]$x, [single]$y, [single]$w) {
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Near
  $rect = New-Object System.Drawing.RectangleF($x, $y, $w, 400)
  $g.DrawString($text, $font, $brush, $rect, $fmt)
}

foreach ($sz in $sizes) {
  $W = $sz.w; $H = $sz.h
  $outDir = Join-Path $SrcDir ("framed\" + $sz.label)
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null

  $hFont = New-Object System.Drawing.Font("Segoe UI", ($W * 0.046), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sFont = New-Object System.Drawing.Font("Segoe UI", ($W * 0.026), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

  $idx = 0
  foreach ($it in $items) {
    $idx++
    $src = Join-Path $SrcDir $it.f
    if (-not (Test-Path $src)) { Write-Warning "missing $($it.f)"; continue }

    $bmp = New-Object System.Drawing.Bitmap([int]$W, [int]$H, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # background
    $g.Clear($BG)

    # teal radial glow, top-center
    $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $cx = $W / 2; $cy = $H * 0.02; $R = $W * 1.05
    $glowPath.AddEllipse($cx - $R, $cy - $R, 2 * $R, 2 * $R)
    $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
    $pgb.CenterPoint = New-Object System.Drawing.PointF($cx, $cy)
    $pgb.CenterColor = [System.Drawing.Color]::FromArgb(48, 31, 224, 197)
    $pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 31, 224, 197))
    $g.FillRectangle($pgb, 0, 0, $W, [int]($H * 0.5))
    $pgb.Dispose(); $glowPath.Dispose()

    # headline
    $hBrush = New-Object System.Drawing.SolidBrush($WHITE)
    Draw-Centered $g $it.h $hFont $hBrush 0 ($H * 0.062) $W

    # accent bar
    $aBrush = New-Object System.Drawing.SolidBrush($ACCENT)
    $bw = $W * 0.10; $bh = [single]($H * 0.006)
    $barPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $barPath.AddArc($W/2 - $bw/2, $H*0.108, $bh, $bh, 90, 180)
    $barPath.AddArc($W/2 + $bw/2 - $bh, $H*0.108, $bh, $bh, 270, 180)
    $barPath.CloseFigure()
    $g.FillPath($aBrush, $barPath); $barPath.Dispose()

    # subtitle
    $sBrush = New-Object System.Drawing.SolidBrush($MUTED)
    Draw-Centered $g $it.s $sFont $sBrush ($W * 0.09) ($H * 0.132) ($W * 0.82)

    # screenshot frame (rounded top, bleeds off bottom)
    $fw = $W * 0.80; $fx = ($W - $fw) / 2; $fy = $H * 0.185; $r = $W * 0.052
    $fh = $H - $fy + 40
    $framePath = New-RoundTopPath $fx $fy $fw $fh $r

    # glow behind frame
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $fBrush = New-Object System.Drawing.SolidBrush($FRAMEBG)
    $g.FillPath($fBrush, $framePath)

    # draw screenshot clipped to the frame
    $shot = [System.Drawing.Image]::FromFile($src)
    $scale = $fw / $shot.Width
    $dh = $shot.Height * $scale
    $g.SetClip($framePath)
    $g.DrawImage($shot, [single]$fx, [single]$fy, [single]$fw, [single]$dh)
    $g.ResetClip()
    $shot.Dispose()

    # frame border
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(28, 255, 255, 255), [single]($W * 0.0016))
    $g.DrawPath($pen, $framePath)
    $pen.Dispose(); $framePath.Dispose()

    $slug = ('{0:D2}' -f $idx)
    $out = Join-Path $outDir ("$slug`_$($sz.label).png")
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "  -> $out"
  }
  $hFont.Dispose(); $sFont.Dispose()
  Write-Output ("Done $($sz.label): $idx images in $outDir")
}
