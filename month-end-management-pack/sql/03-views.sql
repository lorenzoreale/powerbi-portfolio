-- The reporting views: the only objects the semantic model reads.
CREATE VIEW rpt.Entity AS
SELECT
    entity_code AS [Entity Code],
    entity_name AS [Company]
FROM erp.Entity;
GO

CREATE VIEW rpt.ServiceLine AS
SELECT
    service_line      AS [Service Line],
    service_line_code AS [Service Line Code],
    client_facing     AS [Client Facing],
    sort_order        AS [Sort Order]
FROM erp.ServiceLine;
GO

CREATE VIEW rpt.Account AS
SELECT
    account_code AS [Account Code],
    account_name AS [Account],
    account_type AS [Account Type],
    sort_order   AS [Sort Order],
    CASE WHEN account_type = 'Revenue' THEN 1 ELSE -1 END AS [Sign]
FROM erp.Account;
GO

CREATE VIEW rpt.Client AS
SELECT
    client_code  AS [Client Code],
    client_name  AS [Client],
    client_since AS [Client Since],
    CAST(1 AS BIT) AS [Is Client]
FROM erp.Client
UNION ALL
SELECT 'UNALLOC', 'Unallocated', NULL, CAST(0 AS BIT);
GO

CREATE VIEW rpt.JournalLine AS
WITH numbered AS (
    SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY journal_no, line_no ORDER BY extracted_at) AS copy_no
    FROM erp.JournalLine
)
SELECT
    n.journal_no   AS [Journal No],
    n.line_no      AS [Line No],
    CASE n.journal_type
        WHEN 'SI'  THEN 'Sales invoice'
        WHEN 'PI'  THEN 'Purchase invoice'
        WHEN 'PAY' THEN 'Payroll'
        WHEN 'DEP' THEN 'Depreciation'
        WHEN 'MJ'  THEN 'Manual journal'
    END            AS [Journal Type],
    n.posting_date AS [Posting Date],
    n.entity_code  AS [Entity Code],
    n.account_code AS [Account Code],
    sl.service_line AS [Service Line],
    COALESCE(NULLIF(n.client_code, ''), 'UNALLOC') AS [Client Code],
    n.description  AS [Description],
    n.credit - n.debit AS [Amount]
FROM numbered AS n
JOIN erp.ServiceLine AS sl ON sl.service_line_code = n.service_line_code
WHERE n.copy_no = 1;
GO

CREATE VIEW rpt.DuplicateLine AS
WITH numbered AS (
    SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY journal_no, line_no ORDER BY extracted_at) AS copy_no
    FROM erp.JournalLine
)
SELECT
    journal_no     AS [Journal No],
    line_no        AS [Line No],
    posting_date   AS [Posting Date],
    entity_code    AS [Entity Code],
    account_code   AS [Account Code],
    description    AS [Description],
    credit - debit AS [Amount],
    extracted_at   AS [Extracted At]
FROM numbered
WHERE copy_no > 1;
GO

CREATE VIEW rpt.TrialBalance AS
SELECT
    month        AS [Month Start],
    entity_code  AS [Entity Code],
    account_code AS [Account Code],
    -movement    AS [Amount]
FROM erp.TrialBalance;
GO

CREATE VIEW rpt.Hours AS
SELECT
    h.month           AS [Month Start],
    h.entity_code     AS [Entity Code],
    sl.service_line   AS [Service Line],
    h.available_hours AS [Available],
    h.billable_hours  AS [Billable]
FROM ts.Hours AS h
JOIN erp.ServiceLine AS sl ON sl.service_line_code = h.service_line_code;
GO
