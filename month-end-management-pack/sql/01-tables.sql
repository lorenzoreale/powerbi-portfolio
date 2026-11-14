-- Tables as extracted from the ERP (erp) and the timesheet system (ts), and the reporting schema (rpt).
CREATE SCHEMA erp;
GO
CREATE SCHEMA ts;
GO
CREATE SCHEMA rpt;
GO

CREATE TABLE erp.Entity (
    entity_code       VARCHAR(3)     NOT NULL PRIMARY KEY,
    entity_name       VARCHAR(60)    NOT NULL
);

CREATE TABLE erp.ServiceLine (
    service_line_code VARCHAR(3)     NOT NULL PRIMARY KEY,
    service_line      VARCHAR(30)    NOT NULL,
    client_facing     BIT            NOT NULL,
    sort_order        TINYINT        NOT NULL
);

CREATE TABLE erp.Account (
    account_code      VARCHAR(4)     NOT NULL PRIMARY KEY,
    account_name      VARCHAR(40)    NOT NULL,
    account_type      VARCHAR(20)    NOT NULL,
    sort_order        TINYINT        NOT NULL
);

CREATE TABLE erp.Client (
    client_code       VARCHAR(6)     NOT NULL PRIMARY KEY,
    client_name       VARCHAR(60)    NOT NULL,
    client_since      SMALLINT       NOT NULL
);

CREATE TABLE erp.JournalLine (
    journal_no        INT            NOT NULL,
    line_no           SMALLINT       NOT NULL,
    journal_type      VARCHAR(3)     NOT NULL,
    posting_date      DATE           NOT NULL,
    entity_code       VARCHAR(3)     NOT NULL,
    account_code      VARCHAR(4)     NOT NULL,
    service_line_code VARCHAR(3)     NOT NULL,
    client_code       VARCHAR(6)     NULL,
    description       NVARCHAR(120)  NOT NULL,
    debit             DECIMAL(12, 2) NOT NULL,
    credit            DECIMAL(12, 2) NOT NULL,
    extracted_at      DATETIME2(0)   NOT NULL
);

CREATE TABLE erp.TrialBalance (
    month             DATE           NOT NULL,
    entity_code       VARCHAR(3)     NOT NULL,
    account_code      VARCHAR(4)     NOT NULL,
    movement          DECIMAL(12, 2) NOT NULL,
    CONSTRAINT PK_TrialBalance PRIMARY KEY (month, entity_code, account_code)
);

CREATE TABLE ts.Hours (
    month             DATE           NOT NULL,
    entity_code       VARCHAR(3)     NOT NULL,
    service_line_code VARCHAR(3)     NOT NULL,
    available_hours   INT            NOT NULL,
    billable_hours    INT            NOT NULL,
    CONSTRAINT PK_Hours PRIMARY KEY (month, service_line_code)
);
