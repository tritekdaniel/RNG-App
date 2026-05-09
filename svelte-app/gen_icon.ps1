# Create a minimal valid 24x24 ICO file (3.00 format)
$iconHeader = [byte[]]@(0, 0, 1, 0, 1, 0)

# Single image entry: 24x24, 24-bit color BGR
$imgW = [Convert]::ToByte(24)
$imgH = [Convert]::ToByte(24)
$colors = [byte[]](0) 
$reserved = [byte[]](0)
$planes = [BitConverter]::GetBytes([UInt16]1)
[Array]::Reverse($planes)  # little-endian
$bpp = [byte[]](24)

# Create a simple 24x24 blue pixel BMP data (with padding)
$bmpRowSize = [Math]::Ceiling((24 * 3) / 4.0) * 4
$bmpDataLen = $bmpRowSize * 24
$bmpHeader = [byte[]](54, 0, 0, 0) + [BitConverter]::GetBytes([UInt32]$bmpDataLen + 54)
[Array]::Reverse($bmpHeader[4..7])

# Fill image data with blue pixels (BGR format)
$imgData = New-Object byte[] $bmpDataLen
for ($i = 0; $i -lt $imgData.Length; $i++) {
    if ($i % 3 -eq 0) { $imgData[$i] = 192 }      # Blue
    elseif ($i % 3 -eq 1) { $imgData[$i] = 56 }     # Green
    else { $imgData[$i] = 67 }                        # Red
}

$iconEntry = [byte[]]@($imgW, $imgH, $colors[0], $reserved[0]) + $planes + $bpp + [BitConverter]::GetBytes([UInt32]$bmpDataLen) + [BitConverter]::GetBytes(22)
[Array]::Reverse($iconEntry[8..15])

# Combine: icon dir entry (16 bytes) + BMP header (40 bytes) + pixel data
$output = New-Object byte[] ($iconHeader.Length + $imgData.Length + 40 + $bmpDataLen - $bmpDataLen + 22)

# Write icon directory entry
$iconHeader.CopyTo($output, 0)

# Write image dir entry at offset 6
for ($i = 0; $i -lt $iconEntry.Length; $i++) {
    $output[6 + $i] = $iconEntry[$i]
}

# Write BMP header at offset 22
$output[22] = 66   # 'B'
$output[23] = 77   # 'M'
for ($i = 0; $i -lt 4; $i++) { $output[24 + $i] = $bmpHeader[$i] }

# Write BMP info header (40 bytes of zeros)
for ($i = 28; $i -lt 68; $i++) { $output[$i] = 0 }

# Write pixel data
for ($i = 0; $i -lt $imgData.Length; $i++) {
    $output[70 + $i] = $imgData[$i]
}

[System.IO.File]::WriteAllBytes("src-tauri/icons/icon.ico", $output)
Write-Host "Created $($output.Length)-byte ICO file"
