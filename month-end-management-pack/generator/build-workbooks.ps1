# Builds the finance workbooks in ..\finance from the CSV files in .\workbooks. Needs Excel.
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'workbooks'
$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'finance'
New-Item -ItemType Directory -Force $target | Out-Null

$months = 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'

function Write-Table($sheet, $csv, $name, $columns) {
    $rows = @(Import-Csv -Path (Join-Path $source $csv) -Encoding UTF8)
    $headers = @($rows[0].PSObject.Properties.Name)
    $values = New-Object 'object[,]' ($rows.Count + 1), $headers.Count
    for ($c = 0; $c -lt $headers.Count; $c++) {
        $values[0, $c] = $headers[$c]
        $kind = $columns[$headers[$c]]
        for ($r = 0; $r -lt $rows.Count; $r++) {
            $v = $rows[$r].($headers[$c])
            $values[($r + 1), $c] = switch ($kind) {
                'date' { [datetime]::ParseExact($v, 'yyyy-MM-dd', $null).ToOADate() }
                'text' { $v }
                default { [double]$v }
            }
        }
    }
    for ($c = 0; $c -lt $headers.Count; $c++) {
        if ($columns[$headers[$c]] -eq 'text') { $sheet.Columns($c + 1).NumberFormat = '@' }
    }
    $range = $sheet.Range($sheet.Cells(1, 1), $sheet.Cells($rows.Count + 1, $headers.Count))
    $range.Value2 = $values
    $table = $sheet.ListObjects.Add(1, $range, $null, 1)
    $table.Name = $name
    $table.TableStyle = 'TableStyleLight1'
    return $table
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
    foreach ($year in 2025, 2026) {
        $book = $excel.Workbooks.Add()
        while ($book.Worksheets.Count -gt 1) { $book.Worksheets.Item($book.Worksheets.Count).Delete() }

        $sheet = $book.Worksheets.Item(1)
        $sheet.Name = 'Budget'
        $columns = @{ 'Company' = 'text'; 'Service line' = 'text'; 'Account' = 'text'; 'Account name' = 'text' }
        $table = Write-Table $sheet "budget_$year.csv" 'Budget' $columns
        $total = $table.ListColumns.Add()
        $total.Name = 'Total'
        $total.DataBodyRange.Formula = '=SUM(Budget[@[Jan]:[Dec]])'
        foreach ($m in $months + 'Total') { $table.ListColumns.Item($m).DataBodyRange.NumberFormat = '#,##0' }

        $sheet = $book.Worksheets.Add([Type]::Missing, $sheet)
        $sheet.Name = 'Assumptions'
        $table = Write-Table $sheet "assumptions_$year.csv" 'Assumptions' @{ 'Company' = 'text'; 'Service line' = 'text' }
        $table.ListColumns.Item('Target utilisation').DataBodyRange.NumberFormat = '0%'
        foreach ($m in $months) { $table.ListColumns.Item($m).DataBodyRange.NumberFormat = '#,##0' }

        foreach ($s in 1..2) { $book.Worksheets.Item($s).UsedRange.Columns.AutoFit() | Out-Null }
        $book.Worksheets.Item(1).Activate()
        $book.SaveAs((Join-Path $target "Budget $year.xlsx"), 51)
        $book.Close($false)
    }

    $book = $excel.Workbooks.Add()
    while ($book.Worksheets.Count -gt 1) { $book.Worksheets.Item($book.Worksheets.Count).Delete() }
    $sheet = $book.Worksheets.Item(1)
    $sheet.Name = 'Commentary'
    $table = Write-Table $sheet 'commentary.csv' 'Commentary' @{ 'Month' = 'date'; 'Topic' = 'text'; 'Comment' = 'text' }
    $table.ListColumns.Item('Month').DataBodyRange.NumberFormat = 'mmm yyyy'
    $sheet.Columns(1).ColumnWidth = 12
    $sheet.Columns(2).ColumnWidth = 12
    $sheet.Columns(3).ColumnWidth = 110
    $sheet.Columns(3).WrapText = $true
    $sheet.UsedRange.VerticalAlignment = -4160
    $book.SaveAs((Join-Path $target 'Close commentary.xlsx'), 51)
    $book.Close($false)
}
finally {
    $excel.Quit()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
}
