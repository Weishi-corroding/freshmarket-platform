# Render deliverables with the installed Microsoft Office: update the table of contents and page fields in each
# Word document, save it, and export a PDF next to it. A PowerPoint deck is exported too when one exists.
# Documents already open in Office are left untouched.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$output = Join-Path $projectRoot 'deliverables'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$existingDocuments = $word.Documents.Count
try {
    foreach ($file in Get-ChildItem -LiteralPath $output -Filter '*.docx') {
        $document = $word.Documents.Open($file.FullName, $false, $false, $false)
        try {
            foreach ($toc in $document.TablesOfContents) { $toc.Update() }
            # TOC entries are hyperlinks; keep them black and not underlined like the rest of the text (wdStyleHyperlink = -86, wdStyleHyperlinkFollowed = -87).
            foreach ($styleId in @(-86, -87)) { $style = $document.Styles.Item($styleId); $style.Font.Color = 0; $style.Font.Underline = 0 }
            $document.Fields.Update() | Out-Null
            $document.Save()
            $document.ExportAsFixedFormat([System.IO.Path]::ChangeExtension($file.FullName, '.pdf'), 17)
            Write-Output ('Rendered Word: ' + $file.Name + ' / ' + $document.ComputeStatistics(2) + ' pages.')
        } finally { $document.Close(0) }
    }
} finally {
    if ($existingDocuments -eq 0) { $word.Quit() }
    [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
}
$deck = Get-ChildItem -LiteralPath $output -Filter '*.pptx' | Select-Object -First 1
if ($deck) {
    $previews = Join-Path $projectRoot '.runtime/ppt-preview'
    New-Item -ItemType Directory -Path $previews -Force | Out-Null
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $existingPresentations = $powerPoint.Presentations.Count
    try {
        $presentation = $powerPoint.Presentations.Open($deck.FullName, -1, 0, 0)
        try {
            $presentation.Export($previews, 'PNG', 1600, 900)
            $presentation.SaveAs([System.IO.Path]::ChangeExtension($deck.FullName, '.pdf'), 32)
            Write-Output ('Rendered PowerPoint: ' + $presentation.Slides.Count + ' slides.')
        } finally { $presentation.Close() }
    } finally {
        if ($existingPresentations -eq 0) { $powerPoint.Quit() }
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint) | Out-Null
    }
}
