# Optional actual Office rendering; documents already open in Office are preserved.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$output = Join-Path $projectRoot 'deliverables'
$previews = Join-Path $projectRoot '.runtime/ppt-preview'
New-Item -ItemType Directory -Path $previews -Force | Out-Null
$powerPoint = New-Object -ComObject PowerPoint.Application
$existingPresentations = $powerPoint.Presentations.Count
try {
    $deckPath = (Get-ChildItem -LiteralPath $output -Filter '*.pptx' | Select-Object -First 1).FullName
    $deck = $powerPoint.Presentations.Open($deckPath, -1, 0, 0)
    try {
        $deck.Export($previews, 'PNG', 1600, 900)
        $pdfPath = [System.IO.Path]::ChangeExtension($deckPath, '.pdf')
        $deck.SaveAs($pdfPath, 32)
        Write-Output ('Rendered PowerPoint: ' + $deck.Slides.Count + ' slides.')
    } finally { $deck.Close() }
} finally {
    if ($existingPresentations -eq 0) { $powerPoint.Quit() }
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint) | Out-Null
}
$word = New-Object -ComObject Word.Application
$existingDocuments = $word.Documents.Count
try {
    foreach ($file in Get-ChildItem -LiteralPath $output -Filter '*.docx') {
        $document = $word.Documents.Open($file.FullName, $false, $true, $false)
        try {
            $document.ExportAsFixedFormat([System.IO.Path]::ChangeExtension($file.FullName, '.pdf'), 17)
            Write-Output ('Rendered Word: ' + $file.Name + ' / ' + $document.ComputeStatistics(2) + ' pages.')
        } finally { $document.Close(0) }
    }
} finally {
    if ($existingDocuments -eq 0) { $word.Quit() }
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
}
